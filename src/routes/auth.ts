import { Router, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import admin from "firebase-admin";
import { auth, firestore, storageBucket } from "../config/firebase";
import { env } from "../config/env";
import { requireAuth } from "../middleware/auth";
import { signInWithPassword, FirebaseAuthRestError } from "../services/firebaseAuthRest";

const router = Router();

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters long"),
});

const profileImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

function setSessionCookie(res: Response, cookie: string) {
  // 🔐 For cross-origin requests (production), use "none" with secure: true
  // For same-origin (development), "lax" is sufficient
  const sameSite = env.cookieSecure ? ("none" as const) : ("lax" as const);

  res.cookie(env.sessionCookieName, cookie, {
    maxAge: env.sessionCookieMaxAgeMs,
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite,
  });
}

router.post("/register", async (req, res) => {
  const parseResult = credentialsSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid credentials payload" });
    return;
  }

  const { email, password } = parseResult.data;

  try {
    const userRecord = await auth.createUser({ email, password });

    await firestore.collection("users").doc(userRecord.uid).set(
      {
        email,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const signInData = await signInWithPassword(email, password);
    const sessionCookie = await auth.createSessionCookie(signInData.idToken, {
      expiresIn: env.sessionCookieMaxAgeMs,
    });

    setSessionCookie(res, sessionCookie);

    res.status(200).json({ uid: userRecord.uid, email: userRecord.email });
  } catch (error) {
    console.error("Failed to register user", error);
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "auth/email-already-exists"
    ) {
      res.status(400).json({ error: "Registration failed" });
      return;
    }
    res.status(500).json({ error: "Registration failed" });
  }
});

router.post("/login", async (req, res) => {
  const parseResult = credentialsSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid credentials payload" });
    return;
  }

  const { email, password } = parseResult.data;

  try {
    const signInData = await signInWithPassword(email, password);
    const sessionCookie = await auth.createSessionCookie(signInData.idToken, {
      expiresIn: env.sessionCookieMaxAgeMs,
    });

    await firestore.collection("users").doc(signInData.localId).set(
      {
        email,
        lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    setSessionCookie(res, sessionCookie);

    res.status(200).json({ uid: signInData.localId, email: signInData.email });
  } catch (error) {
    if (error instanceof FirebaseAuthRestError && error.status === 400) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    console.error("Failed to login user", error);
    res.status(500).json({ error: "Login failed" });
  }
});

router.post("/logout", requireAuth, async (req, res) => {
  const sessionCookie = req.cookies?.[env.sessionCookieName];
  // 🔐 Use same sameSite setting as when setting the cookie
  const sameSite = env.cookieSecure ? ("none" as const) : ("lax" as const);
  res.clearCookie(env.sessionCookieName, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite,
  });

  if (!sessionCookie) {
    res.status(200).json({ ok: true });
    return;
  }

  try {
    await auth.verifySessionCookie(sessionCookie, true);
    await auth.revokeRefreshTokens(req.firebaseUser!.uid);
  } catch (error) {
    console.warn("Failed to revoke session cookie", error);
  }

  res.status(200).json({ ok: true });
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    const userDoc = await firestore.collection("users").doc(req.firebaseUser!.uid).get();
    const userData = userDoc.data() ?? {};
    res.status(200).json({
      uid: req.firebaseUser!.uid,
      email: userData.email ?? req.firebaseUser!.email,
      profileImageUrl: userData.profileImageUrl ?? null,
    });
  } catch (error) {
    console.error("Failed to fetch user profile", error);
    res.status(500).json({ error: "Failed to fetch user profile" });
  }
});

router.post(
  "/profile-image",
  requireAuth,
  profileImageUpload.single("profileImage"),
  async (req, res) => {
    if (!storageBucket) {
      res.status(503).json({
        error: "Storage service not configured. Please set FIREBASE_STORAGE_BUCKET in your .env file.",
      });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "No profile image uploaded" });
      return;
    }

    const file = req.file;

    if (!file.mimetype.startsWith("image/")) {
      res.status(400).json({ error: "Only image uploads are allowed" });
      return;
    }

    const userId = req.firebaseUser!.uid;
    const fileExtension = file.originalname.split(".").pop() ?? "jpg";
    const objectPath = `profile-images/${userId}/${Date.now()}.${fileExtension}`;

    try {
      const userDocRef = firestore.collection("users").doc(userId);
      const userDoc = await userDocRef.get();
      const previousImagePath = userDoc.data()?.profileImagePath as string | undefined;

      const storageFile = storageBucket.file(objectPath);

      await storageFile.save(file.buffer, {
        metadata: {
          contentType: file.mimetype,
          cacheControl: "public, max-age=3600",
        },
      });

      const [signedUrl] = await storageFile.getSignedUrl({
        action: "read",
        expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      });

      await userDocRef.set(
        {
          profileImagePath: objectPath,
          profileImageUrl: signedUrl,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      if (previousImagePath && previousImagePath !== objectPath && storageBucket) {
        await storageBucket
          .file(previousImagePath)
          .delete()
          .catch((error: unknown) => {
            console.warn("Failed to delete previous profile image", error);
          });
      }

      res.status(200).json({ downloadUrl: signedUrl });
    } catch (error: unknown) {
      console.error("Failed to upload profile image", error);

      // Provide more helpful error messages
      let errorMessage = "Failed to upload profile image";
      if (error && typeof error === "object" && "response" in error) {
        const response = (error as { response?: { data?: { error?: { message?: string } }; status?: number } }).response;
        if (response?.data?.error?.message?.includes("bucket does not exist")) {
          errorMessage = "Storage bucket not configured. Please set FIREBASE_STORAGE_BUCKET in your .env file to your Firebase Storage bucket name (e.g., 'your-project-id.firebasestorage.app' or 'your-project-id.appspot.com')";
        } else if (response?.status === 404) {
          errorMessage = "Storage bucket not found. Please verify FIREBASE_STORAGE_BUCKET in your .env file matches your Firebase project's storage bucket.";
        }
      }
      res.status(500).json({ error: errorMessage });
    }
  },
);

export default router;

