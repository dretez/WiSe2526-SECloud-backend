import { Router, type Request } from "express";
import { z } from "zod";
import admin from "firebase-admin";
import { firestore } from "../config/firebase";
import { requireAuth } from "../middleware/auth";
import { env } from "../config/env";
import { isUrlSafe } from "../services/safeBrowsing";

const router = Router();
const linksCollection = firestore.collection("links");

const createLinkSchema = z.object({
  longUrl: z
    .string()
    .url("Invalid URL")
    .transform((url) => {
      const parsed = new URL(url);
      if (!parsed.protocol) {
        parsed.protocol = "https:";
      }
      return parsed.toString();
    }),
  alias: z
    .string()
    .trim()
    .min(3, "Alias must be at least 3 characters long")
    .max(50, "Alias must be at most 50 characters long")
    .regex(/^[a-zA-Z0-9_-]+$/, "Alias may only contain letters, numbers, underscores and hyphens")
    .transform((val) => val.toLowerCase())
    .optional(),
});

const toggleSchema = z.object({
  isActive: z.boolean(),
});

/**
 * Generates a short random code for URL shortening
 * Uses alphanumeric characters (a-z, 0-9) for URL-safe codes
 * @param length - Length of the code (default: 6)
 * @returns A random short code
 */
function generateShortCode(length: number = 6): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Generates a unique short code by checking for collisions
 * Retries up to 10 times if code already exists
 * @param linksCollection - Firestore collection reference
 * @param length - Length of the code (default: 6)
 * @returns A unique short code
 */
async function generateUniqueShortCode(
  linksCollection: admin.firestore.CollectionReference,
  length: number = 6,
): Promise<string> {
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generateShortCode(length);
    const snapshot = await linksCollection.where("shortCode", "==", code).limit(1).get();
    if (snapshot.empty) {
      if (attempt > 0) {
        console.log(`🔗 Generated unique short code after ${attempt + 1} attempt(s): ${code}`);
      }
      return code;
    }
    // If collision detected, log and retry
    if (attempt === 0) {
      console.log(`⚠️ Short code collision detected, generating new code...`);
    }
    // If collision, try again with slightly longer code on last attempts
    if (attempt >= maxAttempts - 3) {
      length++;
    }
  }
  // Fallback: use longer code if all attempts fail (very unlikely)
  const fallbackCode = generateShortCode(length + 2);
  console.warn(`⚠️ Used fallback code generation after ${maxAttempts} attempts: ${fallbackCode}`);
  return fallbackCode;
}

function resolveBaseUrl(req: Request) {
  if (env.baseUrl) {
    return env.baseUrl.replace(/\/$/, "");
  }
  const host = req.get("host");
  const protocol = req.secure || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  return `${protocol}://${host}`;
}

router.post("/links", requireAuth, async (req, res) => {
  const parseResult = createLinkSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid URL or alias taken" });
    return;
  }

  const { longUrl, alias } = parseResult.data;

  // 🛡️ SECURITY CHECK: Check if URL is malicious
  const safe = await isUrlSafe(longUrl);
  if (!safe) {
    res.status(400).json({ 
      error: "This URL has been flagged as malicious/unsafe and cannot be shortened." 
    });
    return;
  }

  const shortCode = alias;

  try {
    if (shortCode) {
      const aliasSnapshot = await linksCollection
        .where("shortCode", "==", shortCode)
        .limit(1)
        .get();
      if (!aliasSnapshot.empty) {
        res.status(400).json({ error: "Invalid URL or alias taken" });
        return;
      }
    }

    const docRef = linksCollection.doc();
    // Generate a unique short code if no alias provided
    // Use a short random code (6 chars) instead of long document ID for better UX
    const resolvedShortCode = shortCode ?? (await generateUniqueShortCode(linksCollection, 6));

    await docRef.set({
      uid: req.firebaseUser!.uid,
      longUrl,
      alias: shortCode ?? null,
      shortCode: resolvedShortCode,
      isActive: true,
      hitCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(201).json({
      id: docRef.id,
      shortUrl: `${resolveBaseUrl(req)}/${resolvedShortCode}`,
    });
  } catch (error) {
    console.error("Failed to create link", error);
    res.status(500).json({ error: "Failed to create link" });
  }
});

router.get("/links/mine", requireAuth, async (req, res) => {
  try {
    const baseUrl = resolveBaseUrl(req);
    const snapshot = await linksCollection.where("uid", "==", req.firebaseUser!.uid).get();
    const items = snapshot.docs
      .map((doc) => {
        const data = doc.data();
        const shortCode = data.shortCode as string;
        return {
          id: doc.id,
          longUrl: data.longUrl as string,
          isActive: Boolean(data.isActive),
          hitCount: Number(data.hitCount ?? 0),
          shortUrl: `${baseUrl}/${shortCode}`,
          lastHitAt: data.lastHitAt
            ? (data.lastHitAt as admin.firestore.Timestamp).toDate().toISOString()
            : undefined,
          createdAt: data.createdAt
            ? (data.createdAt as admin.firestore.Timestamp).toDate().toISOString()
            : undefined,
        };
      })
      .sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

    res.status(200).json({ items });
  } catch (error) {
    console.error("Failed to list links", error);
    res.status(500).json({ error: "Failed to fetch links" });
  }
});

router.get("/links/:id/meta", requireAuth, async (req, res) => {
  try {
    const docRef = linksCollection.doc(req.params.id);
    const docSnapshot = await docRef.get();
    if (!docSnapshot.exists) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const data = docSnapshot.data()!;
    if (data.uid !== req.firebaseUser!.uid) {
      res.status(403).json({ error: "Not owner" });
      return;
    }

    const baseUrl = resolveBaseUrl(req);

    res.status(200).json({
      id: docSnapshot.id,
      longUrl: data.longUrl,
      isActive: data.isActive,
      hitCount: data.hitCount,
      lastHitAt: data.lastHitAt
        ? (data.lastHitAt as admin.firestore.Timestamp).toDate().toISOString()
        : null,
      createdAt: data.createdAt
        ? (data.createdAt as admin.firestore.Timestamp).toDate().toISOString()
        : null,
      shortUrl: `${baseUrl}/${data.shortCode}`,
    });
  } catch (error) {
    console.error("Failed to fetch link metadata", error);
    res.status(500).json({ error: "Failed to fetch link metadata" });
  }
});

router.patch("/links/:id", requireAuth, async (req, res) => {
  const parseResult = toggleSchema.safeParse(req.body);
  if (!parseResult.success) {
    res
      .status(400)
      .json({ error: `Bad body, expected: boolean, received: ${typeof req.body.isActive}` });
    return;
  }

  try {
    const docRef = linksCollection.doc(req.params.id);
    const docSnapshot = await docRef.get();
    if (!docSnapshot.exists) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const data = docSnapshot.data()!;
    if (data.uid !== req.firebaseUser!.uid) {
      res.status(403).json({ error: "Not owner" });
      return;
    }

    await docRef.update({
      isActive: parseResult.data.isActive,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Failed to toggle link state", error);
    res.status(500).json({ error: "Failed to update link" });
  }
});

export default router;

