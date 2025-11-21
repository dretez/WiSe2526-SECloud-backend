import { Router } from "express";
import { readFile } from "fs/promises";
import { join } from "path";
import admin from "firebase-admin";
import { firestore } from "../config/firebase";

const router = Router();
const linksCollection = firestore.collection("links");

async function serveNotFoundPage(res: any): Promise<void> {
  try {
    const notFoundPath = join(process.cwd(), "../frontend/public/not-found.html");
    const html = await readFile(notFoundPath, "utf-8");
    res.status(404).type("text/html").send(html);
  } catch (error) {
    console.warn("Failed to serve not-found.html, falling back to JSON", error);
    res.status(404).json({ error: "URL not found" });
  }
}

router.get("/:code", async (req, res) => {
  const originalCode = req.params.code?.trim();
  const code = originalCode?.toLowerCase();

  if (!code || !originalCode) {
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
      await serveNotFoundPage(res);
      return;
    }

    const doc = snapshot.docs[0];
    const data = doc.data();

    if (!data.isActive) {
      await serveNotFoundPage(res);
      return;
    }

    res.redirect(302, data.longUrl as string);

    void linksCollection.doc(doc.id).update({
      hitCount: admin.firestore.FieldValue.increment(1),
      lastHitAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error("Failed to process redirect", error);
    res.status(500).json({ error: "Failed to redirect" });
  }
});

export default router;

