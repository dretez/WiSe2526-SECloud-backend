import admin from "firebase-admin";
import { env } from "./env";

const app =
  admin.apps.length > 0
    ? admin.app()
    : admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.firebase.projectId,
        clientEmail: env.firebase.clientEmail,
        privateKey: env.firebase.privateKey,
      }),
      storageBucket: env.firebase.storageBucket,
    });

const auth = admin.auth(app);
const firestore = admin.firestore(app);

// Validate storage bucket configuration
if (!env.firebase.storageBucket || env.firebase.storageBucket.includes("your-project-id")) {
  console.warn(
    "⚠️  WARNING: FIREBASE_STORAGE_BUCKET is not properly configured!",
    "\n   Current value:",
    env.firebase.storageBucket || "(not set)",
    "\n   Please set it in your .env file to your actual Firebase Storage bucket name.",
    "\n   Example: url-shortener-91406.firebasestorage.app",
  );
}

const storageBucket: admin.storage.Bucket | null = env.firebase.storageBucket
  ? admin.storage(app).bucket(env.firebase.storageBucket)
  : null;

export { app, auth, firestore, storageBucket };

