import type {
  EnrichedLead,
  EnrichmentBundle,
  Lead,
} from "./types";
import { geocodeLead } from "./enrichment/geocode";
import { fetchCensusData } from "./enrichment/census";
import { fetchWalkScore } from "./enrichment/walkscore";
import { fetchGeoapify } from "./enrichment/geoapify";
import { fetchCompanyNews } from "./enrichment/news";
import { fetchWikipedia } from "./enrichment/wikipedia";
import { buildInsights, buildQualityFlags, scoreLead } from "./scoring";
import { draftEmail } from "./email";
import { withRetry } from "./retry";

/**
 * The full enrichment pipeline for a single lead.
 *
 * Geocode runs first because Census + WalkScore depend on it. Then we fan
 * out the four enrichment sources in parallel with Promise.allSettled so a
 * single API hiccup never breaks the whole lead.
 */
export async function enrichLead(lead: Lead): Promise<EnrichedLead> {
  const errors: Record<string, string> = {};

  let geocode: EnrichmentBundle["geocode"] = null;
  try {
    geocode = await withRetry(() => geocodeLead(lead), { label: "geocode" });
    if (!geocode) errors.geocode = "No address match";
  } catch (e) {
    errors.geocode = (e as Error).message;
  }

  const censusTask = geocode
    ? withRetry(() => fetchCensusData(geocode), { label: "census" })
    : Promise.resolve(null);
  const walkTask = geocode
    ? withRetry(() => fetchWalkScore(lead, geocode), { label: "walkscore" })
    : Promise.resolve(null);
  const geoapifyTask = geocode
    ? withRetry(() => fetchGeoapify(geocode), { label: "geoapify" })
    : Promise.resolve(null);

  const [censusRes, walkRes, geoapifyRes, newsRes, wikiRes] =
    await Promise.allSettled([
      censusTask,
      walkTask,
      geoapifyTask,
      withRetry(() => fetchCompanyNews(lead), { label: "news" }),
      withRetry(() => fetchWikipedia(lead), { label: "wikipedia" }),
    ]);

  const census =
    censusRes.status === "fulfilled" ? censusRes.value : null;
  if (censusRes.status === "rejected") {
    errors.census = (censusRes.reason as Error).message;
  }

  const walkScore = walkRes.status === "fulfilled" ? walkRes.value : null;
  if (walkRes.status === "rejected") {
    errors.walkScore = (walkRes.reason as Error).message;
  }

  const geoapify = geoapifyRes.status === "fulfilled" ? geoapifyRes.value : null;
  if (geoapifyRes.status === "rejected") {
    errors.geoapify = (geoapifyRes.reason as Error).message;
  }

  const news = newsRes.status === "fulfilled" ? newsRes.value : null;
  if (newsRes.status === "rejected") {
    errors.news = (newsRes.reason as Error).message;
  }

  const wikipedia = wikiRes.status === "fulfilled" ? wikiRes.value : null;
  if (wikiRes.status === "rejected") {
    errors.wikipedia = (wikiRes.reason as Error).message;
  }

  const enrichment: EnrichmentBundle = {
    geocode,
    census,
    walkScore,
    geoapify,
    news,
    wikipedia,
    errors,
  };

  const score = scoreLead(lead, enrichment);
  const insights = buildInsights(lead, enrichment);
  const qualityFlags = buildQualityFlags(lead, enrichment);
  const email = await draftEmail(lead, enrichment, score, insights);

  return {
    lead,
    enrichment,
    score,
    insights,
    qualityFlags,
    email,
    enrichedAt: new Date().toISOString(),
  };
}

/**
 * Concurrency-limited batch runner. Caps parallelism to avoid hammering the
 * Census Geocoder (it's strict about rate limits).
 */
export async function enrichLeads(
  leads: Lead[],
  concurrency = 3
): Promise<EnrichedLead[]> {
  const results: EnrichedLead[] = new Array(leads.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= leads.length) return;
      try {
        results[idx] = await enrichLead(leads[idx]);
      } catch (e) {
        results[idx] = {
          lead: leads[idx],
          enrichment: {
            geocode: null,
            census: null,
            walkScore: null,
            geoapify: null,
            news: null,
            wikipedia: null,
            errors: { pipeline: (e as Error).message },
          },
          score: {
            total: 0,
            tier: "C",
            breakdown: {
              marketFit: 0,
              propertyFit: 0,
              companyMomentum: 0,
            },
            reasons: [`Pipeline error: ${(e as Error).message}`],
          },
          insights: [],
          qualityFlags: [
            {
              severity: "warn",
              message: `Pipeline error: ${(e as Error).message}`,
            },
          ],
          email: {
            subject: "(enrichment failed)",
            body: "",
            source: "fallback",
          },
          enrichedAt: new Date().toISOString(),
        };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, leads.length) }, worker)
  );
  return results;
}
