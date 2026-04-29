import type { Lead, WikipediaData } from "../types";

/**
 * Wikipedia REST API (no key required).
 *
 * We try the company first; if there's no page (or it's a disambiguation),
 * we fall back to the city. The summary is short by design and is only used
 * as additional color for the email opener / sales-rep insights.
 *
 * Docs: https://en.wikipedia.org/api/rest_v1/
 */
const WIKI_SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/";

type WikiSummary = {
  type?: string;
  title?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
};

async function lookup(title: string): Promise<WikiSummary | null> {
  const url = `${WIKI_SUMMARY_URL}${encodeURIComponent(title)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "EliseAI-GTM-Tool/0.1 (lead enrichment)",
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Wikipedia ${res.status} for "${title}"`);
  const data = (await res.json()) as WikiSummary;
  if (data.type === "disambiguation") return null;
  if (!data.extract) return null;
  return data;
}

export async function fetchWikipedia(lead: Lead): Promise<WikipediaData> {
  const candidates: Array<{ source: "company" | "city"; title: string }> = [];
  if (lead.company?.trim()) {
    candidates.push({ source: "company", title: lead.company.trim() });
  }
  if (lead.city?.trim() && lead.state?.trim()) {
    candidates.push({
      source: "city",
      title: `${lead.city.trim()}, ${lead.state.trim()}`,
    });
    candidates.push({ source: "city", title: lead.city.trim() });
  }

  for (const { source, title } of candidates) {
    try {
      const data = await lookup(title);
      if (data) {
        return {
          source,
          title: data.title ?? title,
          extract: data.extract ?? null,
          url: data.content_urls?.desktop?.page ?? null,
        };
      }
    } catch {
      // try next candidate
    }
  }

  return { source: "none", title: null, extract: null, url: null };
}
