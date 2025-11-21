import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import authRouter from "./routes/auth";
import linksRouter from "./routes/links";
import redirectRouter from "./routes/redirect";
import monitoringRouter from "./routes/monitoring";
import testingRouter from "./routes/testing";
import { env } from "./config/env";
import { attachFirebaseUser } from "./middleware/auth";
import { requestLogger, errorLogger } from "./middleware/logging";

const app = express();

app.set("trust proxy", 1);

app.use(
  cors({
    origin: env.corsOrigin ?? true,
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());
app.use(requestLogger);
app.use(attachFirebaseUser);

app.use("/auth", authRouter);
app.use("/api", linksRouter);
app.use("/monitoring", monitoringRouter);
app.use("/testing", testingRouter);

app.get("/", (_req, res) => {
  res.status(200).json({ service: "url-shortener-backend", status: "ok" });
});

app.use("/", redirectRouter);

app.use((req, res, next) => {
  res.status(404).json({ error: "Not found" });
  next();
});

app.use(errorLogger);

const port = env.port;

app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});

export default app;

