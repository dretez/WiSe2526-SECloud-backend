export type StatsPayload = {
    urlId: string;
    urlName: string;
    shortCode: string;
    longUrl: string;
    period: string;
    totalClicks: number;

    dailyClicks: { date: string; clicks: number }[];
    hourlyClicks: { hour: number; clicks: number }[];
    countries: { country: string; clicks: number }[];
    devices: { type: string; clicks: number }[];
    sources: { source: string; clicks: number }[];
};

export interface AiClient {
    generateSummary(
        stats: StatsPayload,
        language?: 'de' | 'en'
    ): Promise<string>;
}

// Erstmal: Fake-AI für lokale Tests
class MockAiClient implements AiClient {
    async generateSummary(
        stats: StatsPayload,
        language: 'de' | 'en' = 'de'
    ): Promise<string> {
        if (language === 'de') {
            return `
AI-Analyse (FAKE) für "${stats.urlName}" im Zeitraum ${stats.period}:

- Insgesamt ${stats.totalClicks} Klicks
- Top-Land: ${stats.countries[0]?.country ?? 'unbekannt'}
- Meiste Zugriffe über: ${stats.devices[0]?.type ?? 'unbekannt'}

(Diese Antwort kommt noch nicht aus der Cloud, sondern ist nur ein Mock.
Sobald der Ablauf funktioniert, hängen wir hier Vertex AI / Azure OpenAI dran.)
      `.trim();
        } else {
            return `
AI analysis (FAKE) for "${stats.urlName}" in period ${stats.period}.

Total clicks: ${stats.totalClicks}.
Top country: ${stats.countries[0]?.country ?? 'unknown'}.
Main device type: ${stats.devices[0]?.type ?? 'unknown'}.
      `.trim();
        }
    }
}

let client: AiClient | null = null;

export function getAiClient(): AiClient {
    if (!client) {
        const provider = process.env.AI_PROVIDER ?? 'MOCK';

        switch (provider) {
            case 'MOCK':
            default:
                client = new MockAiClient();
                break;
        }
    }
    return client;
}
