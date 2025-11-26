import { env } from "../config/env";

/**
 * Checks if a URL is safe using Google Safe Browsing API
 * @param url The URL to check
 * @returns Promise<boolean> true if safe, false if unsafe
 */
export async function isUrlSafe(url: string): Promise<boolean> {
  const endpoint = `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${env.safeBrowsingKey}`;
  
  const requestBody = {
    client: {
      clientId: "simple-url-shortener",
      clientVersion: "1.0.0"
    },
    threatInfo: {
      threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
      platformTypes: ["ANY_PLATFORM"],
      threatEntryTypes: ["URL"],
      threatEntries: [{ url }]
    }
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("Safe Browsing API error:", errorText);
        // Fail open (allow URL) to prevent blocking users if Google API is down/misconfigured
        // Log the specific error so we can investigate
        return true; 
    }

    const data = await response.json();
    // If 'matches' exists and is not empty, the URL is unsafe
    // data.matches contains an array of threat matches
    const isUnsafe = data.matches && data.matches.length > 0;
    
    if (isUnsafe) {
      console.warn(`🚫 Blocked malicious URL: ${url}`, data.matches);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Failed to check URL safety:", error);
    // Fail open on network errors
    return true; 
  }
}

