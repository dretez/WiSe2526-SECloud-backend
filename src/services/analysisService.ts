import admin from "firebase-admin";
import { firestore } from "../config/firebase";

const linksCollection = firestore.collection("links");
const clickEventsCollection = firestore.collection("clickEvents");

export interface GenerateUrlAnalysisParams {
    userId: string;
    shortId: string;   // z.B. "ltci45"
    from?: string;     // optional ISO-String
    to?: string;       // optional ISO-String
}

export interface UrlAnalysisStats {
    urlId: string;
    shortCode: string;
    longUrl: string;
    totalClicks: number;
    period: string;
    firstClick?: string | null;
    lastClick?: string | null;
    countries: Array<{ country: string; count: number }>;
    devices: Array<{ deviceType: string; count: number }>;
    sources: Array<{ source: string; count: number }>;
}

/**
 * Holt Link + ClickEvents aus Firestore und baut eine kleine Auswertung,
 * die wir später mit einem echten LLM „schöner“ formulieren können.
 */
export async function generateUrlAnalysis(
    params: GenerateUrlAnalysisParams,
): Promise<{ summary: string; stats: UrlAnalysisStats }> {
    const { shortId, from, to } = params;

    const code = shortId.trim().toLowerCase();

    // 1) Link anhand des shortCode suchen
    const linkSnap = await linksCollection
        .where("shortCode", "==", code)
        .limit(1)
        .get();

    if (linkSnap.empty) {
        throw new Error(`Link with shortCode '${code}' not found`);
    }

    const linkDoc = linkSnap.docs[0];
    const linkData = linkDoc.data() as any;

    // 2) Click-Events holen
    let eventsSnap = await clickEventsCollection
        .where("linkId", "==", linkDoc.id)
        .orderBy("timestamp", "asc")
        .get();

    let events = eventsSnap.docs.map((d) => d.data() as any);

    // 3) Optional nach Zeitraum filtern
    let fromDate: Date | null = null;
    let toDate: Date | null = null;

    if (from) {
        fromDate = new Date(from);
    }
    if (to) {
        toDate = new Date(to);
    }

    if (fromDate || toDate) {
        events = events.filter((evt) => {
            const ts = evt.timestamp as admin.firestore.Timestamp | undefined;
            if (!ts) return false;
            const date = ts.toDate();

            if (fromDate && date < fromDate) return false;
            if (toDate && date > toDate) return false;
            return true;
        });
    }

    const totalClicks = events.length || linkData.hitCount || 0;

    // 4) Erste/letzte Klickzeit ermitteln
    let firstClick: string | null = null;
    let lastClick: string | null = null;
    if (events.length > 0) {
        const firstTs = events[0].timestamp as admin.firestore.Timestamp | undefined;
        const lastTs =
            events[events.length - 1]
                .timestamp as admin.firestore.Timestamp | undefined;

        firstClick = firstTs ? firstTs.toDate().toISOString() : null;
        lastClick = lastTs ? lastTs.toDate().toISOString() : null;
    }

    // 5) Hilfsfunktion zum Zählen nach Kategorie
    function countBy<T extends string | undefined>(
        arr: any[],
        key: (item: any) => T,
    ): Array<{ value: string; count: number }> {
        const map = new Map<string, number>();
        for (const item of arr) {
            const k = key(item) || "UNKNOWN";
            map.set(k, (map.get(k) || 0) + 1);
        }
        return Array.from(map.entries()).map(([value, count]) => ({ value, count }));
    }

    const countryCounts = countBy(events, (e) => e.country).map((x) => ({
        country: x.value,
        count: x.count,
    }));

    const deviceCounts = countBy(events, (e) => e.deviceType).map((x) => ({
        deviceType: x.value,
        count: x.count,
    }));

    const sourceCounts = countBy(events, (e) => e.source).map((x) => ({
        source: x.value,
        count: x.count,
    }));

    const stats: UrlAnalysisStats = {
        urlId: linkDoc.id,
        shortCode: linkData.shortCode,
        longUrl: linkData.longUrl,
        totalClicks,
        period: from || to ? "Gefilterter Zeitraum" : "Gesamter Zeitraum",
        firstClick,
        lastClick,
        countries: countryCounts,
        devices: deviceCounts,
        sources: sourceCounts,
    };

    // 6) Einfache textuelle „AI“-Zusammenfassung (ohne echtes LLM)
    const topCountry = stats.countries[0]?.country ?? "unbekannt";
    const topDevice = stats.devices[0]?.deviceType ?? "unbekannt";

    const summary = `Der Link ${stats.shortCode} (${stats.longUrl}) wurde insgesamt ${stats.totalClicks}-mal aufgerufen. ` +
        `Die meisten Aufrufe stammen aus ${topCountry} und wurden überwiegend über ${topDevice} Geräte ausgeführt. ` +
        `Der erste Klick fand ${stats.firstClick ? "am " + stats.firstClick : "zu einem unbekannten Zeitpunkt"} statt, ` +
        `der letzte Klick ${stats.lastClick ? "am " + stats.lastClick : "zu einem unbekannten Zeitpunkt"}.`;

    return { summary, stats };
}
