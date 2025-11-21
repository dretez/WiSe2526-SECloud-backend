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

/**
 * Standard shape for any optional payloads we attach to test results.
 * Avoiding `any` here keeps downstream consumers honest about the shape.
 */
type TestResultData = Record<string, unknown>;

interface TestResult {
  test: string;
  passed: boolean;
  message?: string;
  data?: TestResultData;
  timestamp: string;
}

const logTestEvent = (context: string, details: TestResultData = {}) => {
  console.info(`🧪 [testing:${context}]`, details);
};

router.post("/test/auth/register", async (req: Request, res: Response) => {
  const results: TestResult[] = [];
  const parseResult = testCredentialsSchema.safeParse(req.body);
  logTestEvent("auth-register:request", { hasBody: Boolean(req.body) });

  if (!parseResult.success) {
    logTestEvent("auth-register:validation-error", { issues: parseResult.error.issues });
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
    logTestEvent("auth-register:user-created", { uid: userRecord.uid });
    results.push({
      test: "create-user",
      passed: true,
      message: "User created successfully",
      data: { uid: userRecord.uid },
      timestamp: new Date().toISOString(),
    });

    await auth.deleteUser(userRecord.uid);
    logTestEvent("auth-register:user-cleanup", { uid: userRecord.uid });
    results.push({
      test: "cleanup",
      passed: true,
      message: "Test user deleted",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logTestEvent("auth-register:error", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
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
  logTestEvent("auth-login:request", { hasBody: Boolean(req.body) });

  if (!parseResult.success) {
    logTestEvent("auth-login:validation-error", { issues: parseResult.error.issues });
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
    logTestEvent("auth-login:sign-in-success", { localId: signInData.localId });
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
    logTestEvent("auth-login:session-cookie-created", { expiresIn: env.sessionCookieMaxAgeMs });
    results.push({
      test: "create-session-cookie",
      passed: true,
      message: "Session cookie created",
      timestamp: new Date().toISOString(),
    });

    const decodedToken = await auth.verifySessionCookie(sessionCookie);
    logTestEvent("auth-login:session-cookie-verified", { uid: decodedToken.uid });
    results.push({
      test: "verify-session-cookie",
      passed: true,
      message: "Session cookie verified",
      data: { uid: decodedToken.uid },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof FirebaseAuthRestError) {
      logTestEvent("auth-login:firebase-auth-error", { code: error.code, message: error.message });
      results.push({
        test: "sign-in",
        passed: false,
        message: `Authentication failed: ${error.message}`,
        timestamp: new Date().toISOString(),
      });
    } else {
      logTestEvent("auth-login:unexpected-error", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
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
  logTestEvent("links-create:request", { hasEmail: Boolean(email), hasPassword: Boolean(password) });

  if (!email || !password) {
    logTestEvent("links-create:validation-error", { reason: "missing-email-or-password" });
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
    logTestEvent("links-create:sign-in-success", { localId: signInData.localId });
    const sessionCookie = await auth.createSessionCookie(signInData.idToken, {
      expiresIn: env.sessionCookieMaxAgeMs,
    });
    logTestEvent("links-create:session-cookie-created", { expiresIn: env.sessionCookieMaxAgeMs });

    const testUrl = `https://example.com/test-${Date.now()}`;
    const linkDoc = await firestore.collection("links").add({
      uid: signInData.localId,
      longUrl: testUrl,
      isActive: true,
      hitCount: 0,
      createdAt: new Date(),
    });
    logTestEvent("links-create:link-created", { linkId: linkDoc.id, longUrl: testUrl });

    results.push({
      test: "create-link",
      passed: true,
      message: "Link created successfully",
      data: { id: linkDoc.id, longUrl: testUrl },
      timestamp: new Date().toISOString(),
    });

    await linkDoc.delete();
    logTestEvent("links-create:link-cleaned-up", { linkId: linkDoc.id });
    results.push({
      test: "cleanup",
      passed: true,
      message: "Test link deleted",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logTestEvent("links-create:error", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
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

    logTestEvent("summary:success", {
      users: usersCount.data().count,
      links: linksCount.data().count,
    });
    res.status(200).json({
      summary: {
        users: usersCount.data().count,
        links: linksCount.data().count,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("⚠️ testing:summary:error", error);
    res.status(500).json({ error: "Failed to get test summary" });
  }
});

export default router;




