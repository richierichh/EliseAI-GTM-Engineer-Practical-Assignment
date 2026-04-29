/**
 * Core types for the EliseAI lead enrichment pipeline.
 *
 * A `Lead` is the raw input from a sales rep / lead-gen source.
 * An `EnrichedLead` adds the data we pulled from public APIs, the score,
 * the human-readable insights, and the drafted email.
 */

export type Lead = {
  name: string;
  email: string;
  company: string;
  property_address: string;
  city: string;
  state: string;
  country: string;
};

export type GeocodeData = {
  matchedAddress: string;
  latitude: number;
  longitude: number;
  stateFips: string;
  countyFips: string;
  tractFips: string;
  blockGroupFips?: string;
};

export type CensusData = {
  /** Total population for the tract. */
  population: number | null;
  /** Median household income (B19013). */
  medianHouseholdIncome: number | null;
  /** Median gross rent (B25064). */
  medianGrossRent: number | null;
  /** % of occupied housing units that are renter-occupied (B25003). */
  renterSharePct: number | null;
  /** Approx. 5-year population growth (current vs 5-year prior ACS). */
  populationGrowth5yrPct: number | null;
  /** Geography label, e.g. "Census Tract 12.34, Kings County, NY". */
  geographyLabel: string | null;
};

export type WalkScoreData = {
  walkScore: number | null;
  walkDescription: string | null;
  transitScore: number | null;
  bikeScore: number | null;
};

export type GeoapifyCounts = {
  transit: number;
  grocery: number;
  dining: number;
  parks: number;
  fitness: number;
  healthcare: number;
  education: number;
};

export type GeoapifyData = {
  /** 0-100 derived access score from POI density inside the radius. */
  accessScore: number;
  radiusMeters: number;
  counts: GeoapifyCounts;
  totalPois: number;
  /** Up to 3 named POIs (closest first) for color in emails / cards. */
  topPois: Array<{ name: string; category: string; distanceMeters: number | null }>;
};

export type NewsArticle = {
  title: string;
  description: string | null;
  url: string;
  source: string;
  publishedAt: string;
};

export type NewsQueryAttempt = {
  query: string;
  rawCount: number;
  totalResults: number;
  candidateCount: number;
};

export type NewsData = {
  articleCount: number;
  topArticles: NewsArticle[];
  /** True if any title/description matched a "momentum" keyword. */
  hasMomentumSignal: boolean;
  matchedKeywords: string[];
  /** `empty` means NewsAPI succeeded, but no article survived quality checks. */
  status?: "ok" | "empty";
  rawArticleCount?: number;
  queryAttempts?: NewsQueryAttempt[];
};

export type WikipediaData = {
  /** Wikipedia summary for the company (preferred) or city (fallback). */
  source: "company" | "city" | "none";
  title: string | null;
  extract: string | null;
  url: string | null;
};

export type EnrichmentBundle = {
  geocode: GeocodeData | null;
  census: CensusData | null;
  walkScore: WalkScoreData | null;
  geoapify: GeoapifyData | null;
  news: NewsData | null;
  wikipedia: WikipediaData | null;
  /** Per-source error messages for debugging in the UI. */
  errors: Record<string, string>;
};

export type Tier = "A" | "B" | "C";

export type ScoreBreakdown = {
  marketFit: number;
  propertyFit: number;
  companyMomentum: number;
};

export type ScoreResult = {
  total: number;
  tier: Tier;
  breakdown: ScoreBreakdown;
  reasons: string[];
};

/**
 * Non-scoring data-quality annotations surfaced on the lead card. These flag
 * intake/enrichment hygiene issues (personal email domain, geocoding failure,
 * sparse enrichment) so the SDR can verify before outreach — without
 * penalizing the lead's tier for things outside their control.
 */
export type QualityFlag = {
  severity: "info" | "warn";
  message: string;
};

export type DraftEmail = {
  subject: string;
  body: string;
  source: "gpt" | "claude" | "fallback";
};

export type EnrichedLead = {
  lead: Lead;
  enrichment: EnrichmentBundle;
  score: ScoreResult;
  insights: string[];
  qualityFlags: QualityFlag[];
  email: DraftEmail;
  enrichedAt: string;
};
