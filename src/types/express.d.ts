import type { DecodedIdToken } from "firebase-admin/auth";

declare global {
  namespace Express {
    interface FirebaseUser {
      uid: string;
      email?: string | null;
      token: DecodedIdToken;
    }

    interface Request {
      firebaseUser?: FirebaseUser;
    }
  }
}

export {};

