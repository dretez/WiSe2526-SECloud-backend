import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    PORT: z
      .string()
      .transform((val) => parseInt(val, 10))
      .optional(),
    BASE_URL: z.string().url().optional(),
    SESSION_COOKIE_NAME: z.string().default("sid"),
    SESSION_COOKIE_MAX_AGE_MS: z
      .string()
      .or(z.number())
      .transform((val) => Number(val))
      .refine(
        (val) =>
          Number.isFinite(val) &&
          val >= 5 * 60 * 1000 &&
          val <= 14 * 24 * 60 * 60 * 1000,
        "SESSION_COOKIE_MAX_AGE_MS must be between 5 minutes and 14 days in milliseconds",
      ),
    FIREBASE_API_KEY: z.string().min(1, "FIREBASE_API_KEY is required"),
    FIREBASE_PROJECT_ID: z.string().min(1, "FIREBASE_PROJECT_ID is required"),
    FIREBASE_CLIENT_EMAIL: z
      .string()
      .email("FIREBASE_CLIENT_EMAIL must be a valid email"),
    FIREBASE_PRIVATE_KEY: z.string().min(1, "FIREBASE_PRIVATE_KEY is required"),
    FIREBASE_STORAGE_BUCKET: z
      .string()
      .optional()
      .refine(
        (val) => !val || (!val.includes("your-project-id") && val.length > 0),
        "FIREBASE_STORAGE_BUCKET must be set to your actual Firebase Storage bucket name (not a placeholder)",
      ),
    CORS_ORIGIN: z.string().optional(),
    COOKIE_SECURE: z
      .string()
      .optional()
      .transform((val) => (typeof val === "string" ? val === "true" : false)),
  })
  .transform((env) => ({
    nodeEnv: env.NODE_ENV ?? "development",
    port: env.PORT ?? 8080,
    baseUrl: env.BASE_URL,
    sessionCookieName: env.SESSION_COOKIE_NAME,
    sessionCookieMaxAgeMs: env.SESSION_COOKIE_MAX_AGE_MS,
    firebase: {
      apiKey: env.FIREBASE_API_KEY,
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      storageBucket: env.FIREBASE_STORAGE_BUCKET,
    },
    corsOrigin: env.CORS_ORIGIN,
    cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === "production",
  }));

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration", parsed.error.flatten());
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;

