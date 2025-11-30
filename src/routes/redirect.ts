import { Router, Response } from "express";
import { readFile } from "fs/promises";
import { join } from "path";
import admin from "firebase-admin";
import { firestore } from "../config/firebase";

const router = Router();
const linksCollection = firestore.collection("links");
const clickEventsCollection = firestore.collection("clickEvents");

/**
 * Serve a friendly 404 page with defensive logging instead of falling back to JSON immediately.
 */
async function serveNotFoundPage(res: Response): Promise<void> {
  try {
    const notFoundPath = join(process.cwd(), "../frontend/public/not-found.html");
    const html = await readFile(notFoundPath, "utf-8");
    res.status(404).type("text/html").send(html);
  } catch (error) {
    console.warn("🚧 Failed to serve not-found.html, falling back to JSON", error);
    res.status(404).json({ error: "URL not found" });
  }
}

/**
 * Sehr einfache Device-Erkennung anhand des User-Agent.
 */
function detectDeviceType(userAgent: string | undefined): "mobile" | "desktop" | "tablet" {
  if (!userAgent) return "desktop";
  const ua = userAgent.toLowerCase();

  if (/tablet|ipad/.test(ua)) return "tablet";
  if (/mobi|android|iphone/.test(ua)) return "mobile";
  return "desktop";
}

/**
 * Country grob aus dem Accept-Language Header ableiten.
 * z.B. "de-DE,de;q=0.9,en-US;q=0.8" -> "DE"
 */
function detectCountry(acceptLanguage: string | undefined): string {
  if (!acceptLanguage) return "UNKNOWN";

  const first = acceptLanguage.split(",")[0]; // "de-DE"
  const parts = first.split("-");
  if (parts.length === 2) {
    return parts[1].toUpperCase(); // "DE"
  }
  // manchmal nur "de" -> dann Sprach-Code groß
  return parts[0].toUpperCase();
}

/**
 * Klick-Ereignis asynchron in Firestore speichern.
 */
async function logClickEvent(params: {
  linkDocId: string;
  shortCode: string;
  longUrl: string;
  deviceType: string;
  country: string;
  source: string;
  referrer: string | null;
  userAgent: string | undefined;
  ip: string | undefined;
}): Promise<void> {
  const {
    linkDocId,
    shortCode,
    longUrl,
    deviceType,
    country,
    source,
    referrer,
    userAgent,
    ip,
  } = params;

  try {
    await clickEventsCollection.add({
      linkId: linkDocId,
      shortCode,
      longUrl,
      deviceType,
      country,
      source,
      referrer,
      userAgent,
      ip,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.warn("⚠️  Failed to log click event", error);
  }
}

router.get("/:code", async (req, res) => {
  const originalCode = req.params.code?.trim();
  const code = originalCode?.toLowerCase();
  console.info("🧭 redirect:request", { originalCode, normalizedCode: code });

  if (!code || !originalCode) {
    console.info("🚫 redirect:missing-code", { originalCode });
    await serveNotFoundPage(res);
    return;
  }

  try {
    // Try lowercase first (new links are stored lowercase)
    let snapshot = await linksCollection.where("shortCode", "==", code).limit(1).get();

    // If not found and original code differs, try original case (for backward compatibility)
    if (snapshot.empty && originalCode !== code) {
      snapshot = await linksCollection.where("shortCode", "==", originalCode).limit(1).get();
    }

    if (snapshot.empty) {
      console.info("🔍 redirect:not-found", { attemptedCode: code, originalCode });
      await serveNotFoundPage(res);
      return;
    }

    const doc = snapshot.docs[0];
    const data = doc.data();
    console.log("DEBUG Firestore link document", {
      id: doc.id,
      data,
    });

    if (!data.isActive) {
      console.info("⛔ redirect:inactive-link", { docId: doc.id });
      await serveNotFoundPage(res);
      return;
    }

    console.info("🚀 redirect:success", { docId: doc.id, destination: data.longUrl });

    // --- Metadaten für das Click-Event einsammeln ---
    const userAgent = req.get("user-agent");
    const acceptLanguage = req.get("accept-language");
    const referrer = req.get("referer") || req.get("referrer") || null;
    const ip = req.ip;
    const deviceType = detectDeviceType(userAgent);
    const country = detectCountry(acceptLanguage);

    // Quelle (z.B. ?src=qr-hbf, ?src=newsletter) -> sonst "direct"
    const srcParam = (req.query.src as string | undefined)?.trim();
    const source = srcParam && srcParam.length > 0 ? srcParam : "direct";

    res.redirect(302, data.longUrl as string);

    void linksCollection.doc(doc.id).update({
      hitCount: admin.firestore.FieldValue.increment(1),
      lastHitAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    void logClickEvent({
      linkDocId: doc.id,
      shortCode: data.shortCode ?? code,
      longUrl: data.longUrl,
      deviceType,
      country,
      source,
      referrer,
      userAgent,
      ip,
    });

  } catch (error) {
    console.error("🔥 redirect:error", error);
    res.status(500).json({ error: "Failed to redirect" });
  }
});

export default router;

