import type { Request, Response, NextFunction } from "express";
import { auth } from "../config/firebase";
import { env } from "../config/env";

export async function attachFirebaseUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const sessionCookie = req.cookies?.[env.sessionCookieName];
  if (!sessionCookie) {
    return next();
  }

  try {
    const decodedToken = await auth.verifySessionCookie(sessionCookie, true);
    req.firebaseUser = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      token: decodedToken,
    };
  } catch (error) {
    console.warn("Failed to verify session cookie", error);
    req.firebaseUser = undefined;
  }

  next();
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.firebaseUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

