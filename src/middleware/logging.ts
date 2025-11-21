import { Request, Response, NextFunction } from "express";
import { env } from "../config/env";

export interface LogEntry {
  timestamp: string;
  method: string;
  path: string;
  statusCode?: number;
  duration?: number;
  error?: string;
  userId?: string;
}

function formatLogEntry(entry: LogEntry): string {
  const parts = [
    `[${entry.timestamp}]`,
    entry.method,
    entry.path,
    entry.statusCode ? `status:${entry.statusCode}` : "",
    entry.duration ? `duration:${entry.duration}ms` : "",
    entry.userId ? `user:${entry.userId}` : "",
    entry.error ? `error:${entry.error}` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  const logEntry: LogEntry = {
    timestamp,
    method: req.method,
    path: req.path,
    userId: req.firebaseUser?.uid,
  };

  res.on("finish", () => {
    logEntry.statusCode = res.statusCode;
    logEntry.duration = Date.now() - startTime;

    if (res.statusCode >= 400) {
      logEntry.error = `HTTP ${res.statusCode}`;
      console.error("🚨 requestLogger detected error:", formatLogEntry(logEntry));
    } else {
      console.log("📝 requestLogger summary:", formatLogEntry(logEntry));
    }
  });

  next();
}

export function errorLogger(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const timestamp = new Date().toISOString();
  const logEntry: LogEntry = {
    timestamp,
    method: req.method,
    path: req.path,
    statusCode: res.statusCode || 500,
    error: error.message,
    userId: req.firebaseUser?.uid,
  };

  console.error("🔥 errorLogger captured exception:", formatLogEntry(logEntry));
  if (error.stack && env.nodeEnv === "development") {
    console.error("🧵 errorLogger stack trace:", error.stack);
  }

  next(error);
}




