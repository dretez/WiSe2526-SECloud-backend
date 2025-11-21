import { Router, Request, Response } from "express";
import { z } from "zod";
import { auth, firestore } from "../config/firebase";
import { signInWithPassword, FirebaseAuthRestError } from "../services/firebaseAuthRest";
import { env } from "../config/env";

const router = Router();

const testCredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

interface TestResult {
  test: string;
  passed: boolean;
  message?: string;
  data?: any;
  timestamp: string;
}

router.post("/test/auth/register", async (req: Request, res: Response) => {
  const results: TestResult[] = [];
  const parseResult = testCredentialsSchema.safeParse(req.body);

  if (!parseResult.success) {
    res.status(400).json({
      error: "Invalid test credentials",
      results: [
        {
          test: "validate-input",
          passed: false,
          message: "Invalid email or password format",
          timestamp: new Date().toISOString(),
        },
      ],
    });
    return;
  }

  const { email, password } = parseResult.data;
  const testEmail = `test-${Date.now()}@test.com`;

  try {
    const userRecord = await auth.createUser({
      email: testEmail,
      password: "TestPassword123!",
    });
    results.push({
      test: "create-user",
      passed: true,
      message: "User created successfully",
      data: { uid: userRecord.uid },
      timestamp: new Date().toISOString(),
    });

    await auth.deleteUser(userRecord.uid);
    results.push({
      test: "cleanup",
      passed: true,
      message: "Test user deleted",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    results.push({
      test: "create-user",
      passed: false,
      message: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    });
  }

  res.status(200).json({ results });
});

router.post("/test/auth/login", async (req: Request, res: Response) => {
  const results: TestResult[] = [];
  const parseResult = testCredentialsSchema.safeParse(req.body);

  if (!parseResult.success) {
    res.status(400).json({
      error: "Invalid test credentials",
      results: [
        {
          test: "validate-input",
          passed: false,
          message: "Invalid email or password format",
          timestamp: new Date().toISOString(),
        },
      ],
    });
    return;
  }

  const { email, password } = parseResult.data;

  try {
    const signInData = await signInWithPassword(email, password);
    results.push({
      test: "sign-in",
      passed: true,
      message: "Sign in successful",
      data: { localId: signInData.localId, email: signInData.email },
      timestamp: new Date().toISOString(),
    });

    const sessionCookie = await auth.createSessionCookie(signInData.idToken, {
      expiresIn: env.sessionCookieMaxAgeMs,
    });
    results.push({
      test: "create-session-cookie",
      passed: true,
      message: "Session cookie created",
      timestamp: new Date().toISOString(),
    });

    const decodedToken = await auth.verifySessionCookie(sessionCookie);
    results.push({
      test: "verify-session-cookie",
      passed: true,
      message: "Session cookie verified",
      data: { uid: decodedToken.uid },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof FirebaseAuthRestError) {
      results.push({
        test: "sign-in",
        passed: false,
        message: `Authentication failed: ${error.message}`,
        timestamp: new Date().toISOString(),
      });
    } else {
      results.push({
        test: "sign-in",
        passed: false,
        message: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  }

  res.status(200).json({ results });
});

router.post("/test/links/create", async (req: Request, res: Response) => {
  const results: TestResult[] = [];
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({
      error: "Email and password required for authenticated test",
      results: [
        {
          test: "validate-input",
          passed: false,
          message: "Email and password required",
          timestamp: new Date().toISOString(),
        },
      ],
    });
    return;
  }

  try {
    const signInData = await signInWithPassword(email, password);
    const sessionCookie = await auth.createSessionCookie(signInData.idToken, {
      expiresIn: env.sessionCookieMaxAgeMs,
    });

    const testUrl = `https://example.com/test-${Date.now()}`;
    const linkDoc = await firestore.collection("links").add({
      uid: signInData.localId,
      longUrl: testUrl,
      isActive: true,
      hitCount: 0,
      createdAt: new Date(),
    });

    results.push({
      test: "create-link",
      passed: true,
      message: "Link created successfully",
      data: { id: linkDoc.id, longUrl: testUrl },
      timestamp: new Date().toISOString(),
    });

    await linkDoc.delete();
    results.push({
      test: "cleanup",
      passed: true,
      message: "Test link deleted",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    results.push({
      test: "create-link",
      passed: false,
      message: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    });
  }

  res.status(200).json({ results });
});

router.get("/test/summary", async (_req: Request, res: Response) => {
  try {
    const [usersCount, linksCount] = await Promise.all([
      firestore.collection("users").count().get(),
      firestore.collection("links").count().get(),
    ]);

    res.status(200).json({
      summary: {
        users: usersCount.data().count,
        links: linksCount.data().count,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Failed to get test summary", error);
    res.status(500).json({ error: "Failed to get test summary" });
  }
});

export default router;




