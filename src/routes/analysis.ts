import { Router } from "express";
import { generateUrlAnalysis } from "../services/analysisService";

const router = Router();

/**
 * POST /api/analysis/:shortId/summary
 * Body (optional): { from: string, to: string }
 */
router.post("/:shortId/summary", async (req, res, next) => {
    try {
        // Versuche den User zu lesen – wenn keiner da ist, arbeiten wir anonym weiter.
        const user: any = (req as any).user || null;
        const userId = user?.uid ?? user?.id ?? "anonymous";

        const { shortId } = req.params;
        const { from, to } = req.body ?? {};

        const { summary, stats } = await generateUrlAnalysis({
            userId,   // wird jetzt immer gesetzt, auch wenn niemand eingeloggt ist
            shortId,
            from,
            to,
        });

        return res.json({
            shortId,
            summary,
            stats,
        });
    } catch (err) {
        next(err);
    }
});

export default router;
