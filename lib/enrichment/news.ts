import type { Lead, NewsArticle, NewsData, NewsQueryAttempt } from "../types";
import { cacheGet, cacheSet } from "../cache";

/**
 * NewsAPI.org free tier.
 *
 * Searches the recent lookback window for the company name (default: 30 days),
 * returns up to 5 validated articles,
 * and flags "momentum" keywords (expansion, fundraising, acquisition, new
 * community openings, etc.) that we treat as buying-intent signals.
 *
 * Docs: https://newsapi.org/docs/endpoints/everything
 */
const NEWSAPI_URL = "https://newsapi.org/v2/everything";
const DEFAULT_LOOKBACK_DAYS = 30;
const MAX_LOOKBACK_DAYS = 90;
const PAGE_SIZE = 20;
const MAX_QUERY_ATTEMPTS = 3;
const TARGET_USABLE_ARTICLES = 3;
const TOP_ARTICLE_LIMIT = 5;
const LINK_VALIDATION_LIMIT = 8;

const MOMENTUM_KEYWORDS = [
  "expansion",
  "expanding",
  "expand",
  "acquired",
  "acquisition",
  "acquire",
  "merger",
  "raised",
  "funding",
  "series a",
  "series b",
  "series c",
  "ipo",
  "launch",
  "launches",
  "launched",
  "new community",
  "new property",
  "new development",
  "groundbreaking",
  "opens",
  "opening",
  "hiring",
  "growth",
  "partnership",
];

type NewsApiArticle = {
  title: string | null;
  description: string | null;
  url: string | null;
  source: { name?: string | null } | null;
  publishedAt: string | null;
};

type NewsApiResponse = {
  status: string;
  totalResults?: number;
  articles?: NewsApiArticle[];
  message?: string;
};

type BrandInfo = { brand: string; stripped: boolean };

type MatchContext = {
  brand: string;
  stripped: boolean;
  brandWords: string[];
  companyWords: string[];
  locationWords: string[];
};

type RankedArticle = {
  article: NewsApiArticle;
  score: number;
  matchedKeywords: string[];
  dedupeKey: string;
  publishedAtMs: number;
};

/**
 * Strip generic corporate suffixes so we can query NewsAPI by the
 * *brand* keyword instead of the full legal name. Searching the full
 * legal name as an exact phrase is hyper-restrictive on NewsAPI's free
 * tier (e.g. "Greystar Real Estate Partners" -> 0 results, while
 * "Greystar" -> dozens). We also use the brand for post-filtering so
 * unrelated articles still get filtered out.
 */
// Order matters: longer multi-word suffixes are matched first so we don't
// over-strip (e.g. "real estate partners" must beat the shorter "partners").
// We deliberately keep industry-identifying words like "Residential",
// "Apartments", and "Communities" intact when they're the brand identifier.
const CORPORATE_SUFFIXES = [
  "real estate partners",
  "property management",
  "property partners",
  "property services",
  "property group",
  "real estate",
  "properties",
  "property",
  "holdings",
  "communities",
  "company",
  "corporation",
  "corp",
  "trust",
  "group",
  "llc",
  "inc",
];

const STOP_WORDS = new Set([
  "and",
  "co",
  "for",
  "of",
  "the",
]);

/**
 * When the brand collapses to a single common word (e.g. "Carter Property
 * Management" -> "carter"), we need an extra real-estate context hint to
 * avoid false-positive articles about Jimmy Carter, Carter Wilson, etc.
 */
const PROP_CONTEXT_RE =
  /\b(property|properties|apartment|apartments|real estate|residential|leasing|rental|communities|reit|housing|developer|development|portfolio|multifamily|landlord|renters?|tenants?|units?|affordable housing|senior living|student housing)\b/i;

const BLOCKED_ARTICLE_HOSTS = new Set([
  "consent.yahoo.com",
  "guce.yahoo.com",
  "consent.google.com",
  "consent.youtube.com",
  "privacy-center.org",
]);

const BLOCKED_URL_PARTS = [
  "collectconsent",
  "/consent",
  "privacy/choices",
  "privacy_center",
  "gdpr",
  "cookie-consent",
];

const STATE_ABBR_TO_NAME: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas",
  ca: "california", co: "colorado", ct: "connecticut", de: "delaware",
  fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho",
  il: "illinois", in: "indiana", ia: "iowa", ks: "kansas",
  ky: "kentucky", la: "louisiana", me: "maine", md: "maryland",
  ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi",
  mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada",
  nh: "new hampshire", nj: "new jersey", nm: "new mexico", ny: "new york",
  nc: "north carolina", nd: "north dakota", oh: "ohio", ok: "oklahoma",
  or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina",
  sd: "south dakota", tn: "tennessee", tx: "texas", ut: "utah",
  vt: "vermont", va: "virginia", wa: "washington", wv: "west virginia",
  wi: "wisconsin", wy: "wyoming", dc: "district of columbia",
};

const CACHE_NS = "news-v3";
// 6h TTL for successful matches keeps demos under the NewsAPI free-tier quota.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// Empty results are much more likely to be caused by transient indexing/query
// gaps, so refresh them sooner.
const EMPTY_CACHE_TTL_MS = 45 * 60 * 1000;

const normalizeText = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const unique = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
};

// Like unique() but preserves the original string (including quotes and casing)
// so NewsAPI receives properly formatted phrase queries.
const uniqueQueries = (queries: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of queries) {
    const key = normalizeText(q);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
};

const wordsForMatching = (value: string): string[] =>
  unique(value.split(/\s+/))
    .map(normalizeText)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));

const extractBrand = (company: string): BrandInfo => {
  let s = normalizeText(company).replace(/^the\s+/, "");
  let stripped = false;
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of CORPORATE_SUFFIXES) {
      if (s === suf) continue;
      if (s.endsWith(` ${suf}`)) {
        const next = s.slice(0, s.length - suf.length - 1).trim();
        if (next.length > 0) {
          s = next;
          changed = true;
          stripped = true;
          break;
        }
      }
    }
  }
  return {
    brand: s || normalizeText(company),
    stripped,
  };
};

const buildNewsQueries = (lead: Lead, brand: string): string[] => {
  const company = lead.company?.trim() ?? "";
  const state = lead.state?.trim() ?? "";
  const city = lead.city?.trim() ?? "";

  // Wrap multi-word phrases in quotes so NewsAPI treats them as exact phrases,
  // not loose AND matches across unrelated words.
  const quote = (s: string): string =>
    s.includes(" ") && !s.startsWith('"') ? `"${s}"` : s;

  const companyQ = quote(company);
  const primaryLoc = state || city;
  const primaryLocQ = quote(primaryLoc);
  const secondaryLoc =
    city && city.toLowerCase() !== state.toLowerCase() ? city : "";
  const secondaryLocQ = quote(secondaryLoc);

  // True when the brand is a shortened form of the full legal name
  // (e.g. "greystar" from "Greystar Real Estate Partners").
  const brandIsDifferent = normalizeText(company) !== brand;

  const candidates = [
    // Most specific: exact company phrase + state
    primaryLoc ? `${companyQ} ${primaryLocQ}` : "",
    // Exact company phrase + city (when city ≠ state abbreviation)
    secondaryLoc ? `${companyQ} ${secondaryLocQ}` : "",
    // Brand shorthand + state — catches articles that use the short name
    // (e.g. "Greystar Texas") when the full legal name rarely appears in news
    brandIsDifferent && primaryLoc ? `${brand} ${primaryLocQ}` : "",
    // Exact company phrase only — broadest fallback
    companyQ,
  ];

  return uniqueQueries(candidates.filter((s) => s.length > 0)).slice(
    0,
    MAX_QUERY_ATTEMPTS
  );
};

const buildMatchContext = (lead: Lead, brandInfo: BrandInfo): MatchContext => {
  const stateAbbr = normalizeText(lead.state ?? "");
  const stateFull = STATE_ABBR_TO_NAME[stateAbbr] ?? "";
  return {
    brand: brandInfo.brand,
    stripped: brandInfo.stripped,
    brandWords: wordsForMatching(brandInfo.brand),
    companyWords: wordsForMatching(lead.company ?? ""),
    // Include the full state name alongside the abbreviation so articles that
    // write "California" instead of "CA" still register a location match.
    locationWords: wordsForMatching(
      `${lead.city ?? ""} ${lead.state ?? ""} ${stateFull}`
    ),
  };
};

const isBlockedHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  for (const blocked of BLOCKED_ARTICLE_HOSTS) {
    if (host === blocked || host.endsWith(`.${blocked}`)) return true;
  }
  return false;
};

const isUsableArticleUrl = (url: string | null): boolean => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (isBlockedHost(parsed.hostname)) return false;
    const searchableUrl = `${parsed.pathname} ${parsed.search}`.toLowerCase();
    return !BLOCKED_URL_PARTS.some((part) => searchableUrl.includes(part));
  } catch {
    return false;
  }
};

const canonicalArticleUrl = (url: string): string => {
  const parsed = new URL(url);
  parsed.hash = "";
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (
      key.startsWith("utm_") ||
      key === "fbclid" ||
      key === "gclid" ||
      key === "mc_cid" ||
      key === "mc_eid"
    ) {
      parsed.searchParams.delete(key);
    }
  }
  return parsed.toString();
};

const articleDedupeKey = (article: NewsApiArticle): string | null => {
  if (article.url && isUsableArticleUrl(article.url)) {
    try {
      return canonicalArticleUrl(article.url);
    } catch {
      return null;
    }
  }
  const title = normalizeText(article.title ?? "");
  return title ? `title:${title}` : null;
};

const getArticleText = (article: NewsApiArticle): string => {
  let urlText = "";
  if (article.url && isUsableArticleUrl(article.url)) {
    try {
      const parsed = new URL(article.url);
      urlText = `${parsed.hostname} ${parsed.pathname}`;
    } catch {
      urlText = article.url;
    }
  }
  return normalizeText(
    `${article.title ?? ""} ${article.description ?? ""} ${urlText} ${
      article.source?.name ?? ""
    }`
  );
};

// Whole-word token matching: pad with spaces so "ca" never hits inside
// "local", "across", "can", etc. normalizeText guarantees the text is
// already space-delimited alphanumeric tokens.
const countMatches = (text: string, words: string[]): number => {
  const padded = ` ${text} `;
  return words.filter((word) => padded.includes(` ${word} `)).length;
};

const getMomentumMatches = (text: string): string[] =>
  MOMENTUM_KEYWORDS.filter((kw) => text.includes(normalizeText(kw)));


const isHighConfidenceMatch = (
  text: string,
  context: MatchContext,
  brandMatchCount: number,
  hasContext: boolean,
  hasLocation: boolean,
  exactBrandMatch: boolean,
  score: number
): boolean => {
  if (context.brandWords.length === 0) return false;
  if (brandMatchCount === 0) return false;
  // Every article must mention the lead's state or city — ensures results are
  // geographically relevant and prevents national or out-of-state articles
  // from surfacing for a property in a specific state.
  if (!hasLocation) return false;

  if (context.stripped && context.brandWords.length === 1) {
    // Full company name present (e.g. both "morgan" and "properties") —
    // specific enough; location is already confirmed above.
    const fullNamePresent =
      context.companyWords.length > context.brandWords.length &&
      countMatches(text, context.companyWords) === context.companyWords.length;
    if (fullNamePresent) return true;
    // Bare common word (e.g. "morgan") also needs real-estate context to
    // avoid matching author names, place names, or unrelated people.
    return hasContext;
  }

  if (brandMatchCount === context.brandWords.length) return true;

  // Partial brand match: require real-estate context and a high score.
  const almostAllWords =
    context.brandWords.length > 1 &&
    brandMatchCount >= context.brandWords.length - 1;
  return almostAllWords && hasContext && score >= 45;
};

const rankArticle = (
  article: NewsApiArticle,
  context: MatchContext
): RankedArticle | null => {
  if (!isUsableArticleUrl(article.url)) return null;
  const dedupeKey = articleDedupeKey(article);
  if (!dedupeKey) return null;

  const text = getArticleText(article);
  const titleText = normalizeText(article.title ?? "");
  if (!titleText && !normalizeText(article.description ?? "")) return null;

  const brandMatchCount = countMatches(text, context.brandWords);
  const companyMatchCount = countMatches(text, context.companyWords);
  const locationMatchCount = countMatches(text, context.locationWords);
  const exactBrandMatch = text.includes(context.brand);
  const hasContext = PROP_CONTEXT_RE.test(text);
  const hasLocation = locationMatchCount > 0;
  const matchedKeywords = getMomentumMatches(text);
  const publishedAtMs = article.publishedAt
    ? Date.parse(article.publishedAt)
    : Number.NaN;

  let score = 0;
  if (exactBrandMatch) score += 40;
  if (context.brandWords.length > 0) {
    score += (brandMatchCount / context.brandWords.length) * 35;
  }
  if (context.brandWords.every((word) => titleText.includes(word))) score += 10;
  if (context.companyWords.length > 0) {
    score += Math.min(10, (companyMatchCount / context.companyWords.length) * 10);
  }
  if (hasContext) score += 15;
  if (hasLocation) score += 5;
  if (matchedKeywords.length > 0) score += 5;
  if (Number.isFinite(publishedAtMs)) score += 5;

  if (
    !isHighConfidenceMatch(
      text,
      context,
      brandMatchCount,
      hasContext,
      hasLocation,
      exactBrandMatch,
      score
    )
  ) {
    return null;
  }

  return {
    article,
    score,
    matchedKeywords,
    dedupeKey,
    publishedAtMs: Number.isFinite(publishedAtMs) ? publishedAtMs : 0,
  };
};

const getLookbackDays = (): number => {
  const raw = process.env.NEWS_LOOKBACK_DAYS;
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_LOOKBACK_DAYS;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LOOKBACK_DAYS;
  return Math.min(parsed, MAX_LOOKBACK_DAYS);
};

const fromDate = (): string => {
  const lookbackDays = getLookbackDays();
  const d = new Date();
  d.setDate(d.getDate() - lookbackDays);
  return d.toISOString().slice(0, 10);
};

const requestNewsApi = async (
  apiKey: string,
  queryTerm: string
): Promise<NewsApiResponse> => {
  // No quotes: NewsAPI defaults to AND-style matching across words, which gives
  // better recall than exact-phrase matching on sparse snippets.
  const params = new URLSearchParams({
    q: queryTerm,
    from: fromDate(),
    sortBy: "relevancy",
    language: "en",
    pageSize: String(PAGE_SIZE),
  });

  const res = await fetch(`${NEWSAPI_URL}?${params.toString()}`, {
    headers: { "X-Api-Key": apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    let details = "";
    try {
      const errJson = (await res.json()) as Partial<NewsApiResponse>;
      details = errJson.message?.trim() ?? "";
    } catch {
      // Ignore parse failures and keep a concise fallback error.
    }
    throw new Error(
      details ? `NewsAPI ${res.status}: ${details}` : `NewsAPI ${res.status}`
    );
  }
  const data = (await res.json()) as NewsApiResponse;
  if (data.status !== "ok") {
    throw new Error(`NewsAPI status=${data.status}: ${data.message ?? ""}`);
  }
  return data;
};

const isDefinitelyBrokenStatus = (status: number): boolean =>
  status === 404 || status === 410 || status >= 500;

const validateArticleUrl = async (
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> => {
  if (!isUsableArticleUrl(url)) return false;

  const request = async (method: "HEAD" | "GET") =>
    fetchImpl(url, {
      method,
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });

  try {
    const head = await request("HEAD");
    if (isDefinitelyBrokenStatus(head.status)) return false;
    if (head.status !== 405) return true;
  } catch {
    // Some publishers block HEAD; try a lightweight GET before deciding.
  }

  try {
    const get = await request("GET");
    return !isDefinitelyBrokenStatus(get.status);
  } catch {
    // Network policies can block server-side validation for otherwise usable
    // links. Keep syntactically clean links unless we observed a broken status.
    return true;
  }
};

const toNewsArticle = (ranked: RankedArticle): NewsArticle => ({
  title: ranked.article.title ?? "",
  description: ranked.article.description ?? null,
  url: ranked.article.url ?? "",
  source: ranked.article.source?.name ?? "",
  publishedAt: ranked.article.publishedAt ?? "",
});

const sortRankedArticles = (articles: RankedArticle[]): RankedArticle[] =>
  [...articles].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.publishedAtMs - a.publishedAtMs;
  });

const validateTopArticles = async (
  rankedArticles: RankedArticle[]
): Promise<RankedArticle[]> => {
  const candidates = rankedArticles.slice(0, LINK_VALIDATION_LIMIT);
  const validations = await Promise.all(
    candidates.map((candidate) => validateArticleUrl(candidate.article.url ?? ""))
  );
  return candidates
    .filter((_, index) => validations[index])
    .slice(0, TOP_ARTICLE_LIMIT);
};

const buildEmptyResult = (
  rawArticleCount: number,
  queryAttempts: NewsQueryAttempt[]
): NewsData => ({
  articleCount: 0,
  topArticles: [],
  hasMomentumSignal: false,
  matchedKeywords: [],
  status: "empty",
  rawArticleCount,
  queryAttempts,
});

export async function fetchCompanyNews(lead: Lead): Promise<NewsData | null> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) return null;
  const company = lead.company?.trim();
  if (!company) return null;

  const brandInfo = extractBrand(company);
  const context = buildMatchContext(lead, brandInfo);
  const queries = buildNewsQueries(lead, brandInfo.brand);
  const cacheKey = unique([
    brandInfo.brand,
    lead.city ?? "",
    lead.state ?? "",
    String(getLookbackDays()),
  ]).join("|");
  const cached = cacheGet<NewsData>(CACHE_NS, cacheKey);
  if (cached) return cached;

  const rankedByKey = new Map<string, RankedArticle>();
  const queryAttempts: NewsQueryAttempt[] = [];
  let rawArticleCount = 0;

  for (const query of queries) {
    const data = await requestNewsApi(apiKey, query);
    const rawArticles = data.articles ?? [];
    rawArticleCount += rawArticles.length;

    let candidateCount = 0;
    for (const article of rawArticles) {
      const ranked = rankArticle(article, context);
      if (!ranked) continue;
      candidateCount += 1;
      const existing = rankedByKey.get(ranked.dedupeKey);
      if (!existing || ranked.score > existing.score) {
        rankedByKey.set(ranked.dedupeKey, ranked);
      }
    }

    queryAttempts.push({
      query,
      rawCount: rawArticles.length,
      totalResults: data.totalResults ?? rawArticles.length,
      candidateCount,
    });

    if (rankedByKey.size >= TARGET_USABLE_ARTICLES) break;
  }

  const rankedArticles = sortRankedArticles(Array.from(rankedByKey.values()));
  const validated = await validateTopArticles(rankedArticles);

  if (validated.length === 0) {
    const empty = buildEmptyResult(rawArticleCount, queryAttempts);
    cacheSet(CACHE_NS, cacheKey, empty, EMPTY_CACHE_TTL_MS);
    return empty;
  }

  const matchedKeywords = new Set<string>();
  for (const article of validated) {
    for (const keyword of article.matchedKeywords) matchedKeywords.add(keyword);
  }

  const result: NewsData = {
    articleCount: validated.length,
    topArticles: validated.map(toNewsArticle),
    hasMomentumSignal: matchedKeywords.size > 0,
    matchedKeywords: Array.from(matchedKeywords),
    status: "ok",
    rawArticleCount,
    queryAttempts,
  };
  cacheSet(CACHE_NS, cacheKey, result, CACHE_TTL_MS);
  return result;
}

export const __newsTest = {
  buildNewsQueries,
  extractBrand,
  isUsableArticleUrl,
  rankArticle,
  validateArticleUrl,
};
