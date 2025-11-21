import { env } from "../config/env";

interface SignInResponse {
  idToken: string;
  refreshToken: string;
  expiresIn: string;
  email: string;
  localId: string;
}

export class FirebaseAuthRestError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<SignInResponse> {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.firebase.apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    },
  );

  if (!response.ok) {
    let errorMessage = "Authentication failed";
    let errorCode: string | undefined;
    try {
      const errorBody = (await response.json()) as {
        error?: { message?: string };
      };
      if (errorBody.error?.message) {
        errorCode = errorBody.error.message;
        errorMessage = errorBody.error.message.replace(/_/g, " ");
      }
    } catch {
      // ignore JSON parse errors
    }
    throw new FirebaseAuthRestError(errorMessage, response.status, errorCode);
  }

  return (await response.json()) as SignInResponse;
}

