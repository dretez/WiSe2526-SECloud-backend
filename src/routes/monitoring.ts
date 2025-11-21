import { Router, Request, Response } from "express";
import { firestore, auth } from "../config/firebase";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/healthz", (_req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    timestamp: new Date().toISOString(),
    service: "url-shortener-backend",
  });
});

router.get("/status", async (_req: Request, res: Response) => {
  try {
    const healthChecks = {
      firestore: false,
      auth: false,
      timestamp: new Date().toISOString(),
    };

    try {
      await firestore.collection("_health").doc("check").get();
      healthChecks.firestore = true;
    } catch (error) {
      console.error("Firestore health check failed", error);
    }

    try {
      await auth.listUsers(1);
      healthChecks.auth = true;
    } catch (error) {
      console.error("Auth health check failed", error);
    }

    const allHealthy = healthChecks.firestore && healthChecks.auth;
    res.status(allHealthy ? 200 : 503).json({
      ok: allHealthy,
      checks: healthChecks,
    });
  } catch (error) {
    console.error("Status check failed", error);
    res.status(500).json({
      ok: false,
      error: "Status check failed",
      timestamp: new Date().toISOString(),
    });
  }
});

router.get("/logs", requireAuth, async (req: Request, res: Response) => {
  try {
    const limit = parseInt((req.query.limit as string) || "50", 10);
    const since = req.query.since
      ? new Date(req.query.since as string)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);

    const logsRef = firestore
      .collection("logs")
      .where("timestamp", ">=", since)
      .orderBy("timestamp", "desc")
      .limit(Math.min(limit, 1000));

    const snapshot = await logsRef.get();
    const logs = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json({
      logs,
      count: logs.length,
      since: since.toISOString(),
    });
  } catch (error) {
    console.error("Failed to fetch logs", error);
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

export default router;




