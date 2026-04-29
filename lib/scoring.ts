import type {
  EnrichmentBundle,
  Lead,
  QualityFlag,
  ScoreBreakdown,
  ScoreResult,
  Tier,
} from "./types";

/**
 * EliseAI multifamily-fit scoring rubric.
 *
 * Weights are surfaced as constants so they can be tuned (and A/B tested)
 * without touching scoring logic. Total = 100.
 *
 * Assumptions — documented and challengeable by the sales team:
 *
 *   1. EliseAI's ICP is property-management companies that operate
 *      multifamily rental buildings. The product's ROI grows with rental
 *      demand, leasing volume, and renter density.
 *
 *   2. We treat the *property's* tract as a proxy for the company's
 *      portfolio quality. Single-property signals are noisy in isolation,
 *      but at scale this captures market quality reasonably well.
 *
 *   3. "Momentum" (recent expansion / fundraising / new community openings)
 *      is a leading indicator of leasing demand AND of budget for
 *      automation tooling.
 *
 *   4. Walkability is a strong proxy for urban multifamily demand — the
 *      segment where AI leasing assistants generate the most lift.
 *
 *   5. Inbound leads opted into a conversation; we don't penalize them for
 *      intake-form gaps that are our problem, not theirs. Data-hygiene
 *      issues (personal email, geocoding miss, sparse enrichment) are
 *      surfaced as non-scoring `QualityFlag`s on the lead card instead.
 */

export const WEIGHTS = {
  marketFit: 40,
  propertyFit: 30,
  companyMomentum: 30,
} as const;

export const TIER_THRESHOLDS = { A: 75, B: 50 } as const;

const PRIORITY_STATES_DEFAULT = [
  "NY", "TX", "FL", "CA", "IL", "GA", "MA", "WA", "CO", "DC",
  "NJ", "PA", "AZ", "NC", "VA",
];

const priorityStates = (): Set<string> => {
  const env = process.env.ELISE_PRIORITY_STATES;
  const list = env
    ? env.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : PRIORITY_STATES_DEFAULT;
  return new Set(list);
};

const clamp = (n: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, n));

/** Linearly interpolate `value` from [lo, hi] into [0, max]. */
const lerpScore = (
  value: number,
  lo: number,
  hi: number,
  max: number
): number => {
  if (value <= lo) return 0;
  if (value >= hi) return max;
  return ((value - lo) / (hi - lo)) * max;
};

function scoreMarketFit(enrichment: EnrichmentBundle): number {
  const c = enrichment.census;
  if (!c) {
    return 0;
  }

  // Renter share: 20pts if >= 60%, scaled down to 0 below 20%.
  const renterPts =
    c.renterSharePct !== null
      ? lerpScore(c.renterSharePct, 20, 60, 20)
      : 0;

  // Median gross rent: 12pts if >= $2,000, 0 below $700.
  const rentPts =
    c.medianGrossRent !== null
      ? lerpScore(c.medianGrossRent, 700, 2000, 12)
      : 0;

  // 5-yr population growth: 8pts if >= 10%, 0 below -2%.
  const growthPts =
    c.populationGrowth5yrPct !== null
      ? lerpScore(c.populationGrowth5yrPct, -2, 10, 8)
      : 0;

  return clamp(renterPts + rentPts + growthPts, 0, WEIGHTS.marketFit);
}

function scorePropertyFit(
  lead: Lead,
  enrichment: EnrichmentBundle
): number {
  let pts = 0;

  // Walkability/access: 22pts. Prefer WalkScore if available; otherwise fall
  // back to a derived access score from Geoapify POI density (transit,
  // grocery, dining, parks, fitness, healthcare, education within ~15-min
  // walk). This keeps the rubric working even when WalkScore is unavailable.
  const w = enrichment.walkScore;
  const g = enrichment.geoapify;
  if (w?.walkScore !== null && w?.walkScore !== undefined) {
    const walkPts = lerpScore(w.walkScore, 30, 90, 22);
    pts += walkPts;
  } else if (g) {
    const accessPts = lerpScore(g.accessScore, 25, 85, 22);
    pts += accessPts;
  }

  // Priority state bonus: 8pts.
  const state = lead.state?.trim().toUpperCase();
  if (state && priorityStates().has(state)) {
    pts += 8;
  }

  return clamp(pts, 0, WEIGHTS.propertyFit);
}

function scoreCompanyMomentum(enrichment: EnrichmentBundle): number {
  const news = enrichment.news;
  let pts = 0;

  if (news) {
    // Article volume: 18pts if >= 4 articles, scaled to 0 at 0 articles.
    // 4 articles in the lookback window already signals a company actively
    // generating press coverage, and the threshold needs to be reachable on
    // NewsAPI's free tier (100 req/day).
    const volPts = lerpScore(news.articleCount, 0, 4, 18);
    pts += volPts;

    // Momentum keyword bonus: 12pts if any matched.
    if (news.hasMomentumSignal) {
      pts += 12;
    }
  }

  return clamp(pts, 0, WEIGHTS.companyMomentum);
}

const fmtPct = (value: number, digits = 0): string =>
  `${value.toFixed(digits)}%`;

const fmtCurrency = (value: number): string =>
  `$${value.toLocaleString()}`;

const fmtNum = (value: number): string => value.toLocaleString();

const joinNatural = (parts: string[]): string => {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
};

const band = (value: number, max: number): "strong" | "mixed" | "weak" => {
  const ratio = max === 0 ? 0 : value / max;
  if (ratio >= 0.75) return "strong";
  if (ratio >= 0.4) return "mixed";
  return "weak";
};

function buildMarketNarrative(
  enrichment: EnrichmentBundle,
  breakdown: ScoreBreakdown
): string {
  const c = enrichment.census;
  if (!c) {
    return "Market fit is unavailable because Census tract data was not returned, so this category contributes 0/40.";
  }

  const drivers: string[] = [];
  const caveats: string[] = [];

  if (c.renterSharePct !== null) {
    if (c.renterSharePct >= 60) {
      drivers.push(
        `${fmtPct(c.renterSharePct)} renter share is above the max-score threshold for renter density`
      );
    } else if (c.renterSharePct >= 40) {
      drivers.push(
        `${fmtPct(c.renterSharePct)} renter share points to a solid rental market`
      );
    } else {
      caveats.push(
        `${fmtPct(c.renterSharePct)} renter share is below EliseAI's strongest multifamily profile`
      );
    }
  } else {
    caveats.push("renter share is missing");
  }

  if (c.medianGrossRent !== null) {
    if (c.medianGrossRent >= 2000) {
      drivers.push(
        `${fmtCurrency(c.medianGrossRent)} median rent indicates a premium leasing market`
      );
    } else if (c.medianGrossRent >= 1200) {
      drivers.push(
        `${fmtCurrency(c.medianGrossRent)} median rent supports a moderate leasing-value signal`
      );
    } else {
      caveats.push(
        `${fmtCurrency(c.medianGrossRent)} median rent is below the premium-market threshold`
      );
    }
  } else {
    caveats.push("median rent is missing");
  }

  if (c.populationGrowth5yrPct !== null) {
    if (c.populationGrowth5yrPct >= 5) {
      drivers.push(
        `${fmtPct(c.populationGrowth5yrPct, 1)} five-year population growth adds demand momentum`
      );
    } else if (c.populationGrowth5yrPct >= 0) {
      drivers.push(
        `${fmtPct(c.populationGrowth5yrPct, 1)} five-year population growth is stable but not a major tailwind`
      );
    } else {
      caveats.push(
        `${fmtPct(c.populationGrowth5yrPct, 1)} five-year population growth is a drag on market momentum`
      );
    }
  } else {
    caveats.push("population growth is missing");
  }

  const headline = `Market fit is ${band(breakdown.marketFit, WEIGHTS.marketFit)} (${breakdown.marketFit}/40)`;
  const driverText =
    drivers.length > 0
      ? ` because ${joinNatural(drivers)}`
      : " because the main Census demand signals are limited";
  const caveatText =
    caveats.length > 0 ? `. Main caveat: ${joinNatural(caveats)}.` : ".";

  return `${headline}${driverText}${caveatText}`;
}

function buildPropertyNarrative(
  lead: Lead,
  enrichment: EnrichmentBundle,
  breakdown: ScoreBreakdown
): string {
  const w = enrichment.walkScore;
  const g = enrichment.geoapify;
  const state = lead.state?.trim().toUpperCase();
  const inPriorityState = Boolean(state && priorityStates().has(state));
  const drivers: string[] = [];
  const caveats: string[] = [];

  if (w?.walkScore !== null && w?.walkScore !== undefined) {
    if (w.walkScore >= 90) {
      drivers.push(`WalkScore ${w.walkScore} signals a walker's paradise`);
    } else if (w.walkScore >= 70) {
      drivers.push(`WalkScore ${w.walkScore} shows strong everyday accessibility`);
    } else if (w.walkScore >= 50) {
      drivers.push(`WalkScore ${w.walkScore} gives the property some accessibility support`);
    } else {
      caveats.push(`WalkScore ${w.walkScore} limits the accessibility signal`);
    }
  } else if (g) {
    const accessContext =
      `${g.counts.transit} transit, ${g.counts.grocery} grocery, and ` +
      `${g.counts.dining} dining POIs within ${(g.radiusMeters / 1000).toFixed(1)}km`;
    if (g.accessScore >= 85) {
      drivers.push(`access is excellent (${g.accessScore}/100, with ${accessContext})`);
    } else if (g.accessScore >= 55) {
      drivers.push(`access is useful but not elite (${g.accessScore}/100, with ${accessContext})`);
    } else {
      caveats.push(`access is thin (${g.accessScore}/100, with ${accessContext})`);
    }
  } else {
    caveats.push("walkability/access data is missing");
  }

  if (inPriorityState && state) {
    drivers.push(`${state} is one of EliseAI's priority markets`);
  } else if (state) {
    caveats.push(`${state} is not currently configured as a priority-market bonus`);
  }

  const headline = `Property fit is ${band(breakdown.propertyFit, WEIGHTS.propertyFit)} (${breakdown.propertyFit}/30)`;
  const driverText =
    drivers.length > 0
      ? ` because ${joinNatural(drivers)}`
      : " because the property-level signals are limited";
  const caveatText =
    caveats.length > 0 ? `. Caveat: ${joinNatural(caveats)}.` : ".";

  return `${headline}${driverText}${caveatText}`;
}

function buildMomentumNarrative(
  enrichment: EnrichmentBundle,
  breakdown: ScoreBreakdown
): string {
  const news = enrichment.news;
  if (!news) {
    return "Company momentum is unavailable because news enrichment did not return data, so this category contributes 0/30.";
  }

  const drivers: string[] = [];
  const caveats: string[] = [];

  if (news.articleCount >= 4) {
    drivers.push(
      `${news.articleCount} recent articles max out the press-volume signal`
    );
  } else if (news.articleCount > 0) {
    const verb = news.articleCount === 1 ? "shows" : "show";
    drivers.push(
      `${news.articleCount} recent article${news.articleCount === 1 ? "" : "s"} ${verb} some market visibility`
    );
  } else {
    caveats.push("no qualified recent articles were found");
  }

  if (news.hasMomentumSignal) {
    const keywords = news.matchedKeywords.slice(0, 3).join(", ");
    drivers.push(
      keywords
        ? `matched momentum language (${keywords}) suggests expansion, funding, openings, or similar buying triggers`
        : "matched momentum language suggests expansion, funding, openings, or similar buying triggers"
    );
  } else {
    caveats.push(
      "the articles did not include expansion, funding, opening, or similar momentum keywords"
    );
  }

  const headline = `Company momentum is ${band(breakdown.companyMomentum, WEIGHTS.companyMomentum)} (${breakdown.companyMomentum}/30)`;
  const driverText =
    drivers.length > 0
      ? ` because ${joinNatural(drivers)}`
      : " because the news signal is limited";
  const caveatText =
    caveats.length > 0 ? `. Caveat: ${joinNatural(caveats)}.` : ".";

  return `${headline}${driverText}${caveatText}`;
}

function buildContextNarrative(enrichment: EnrichmentBundle): string | null {
  const c = enrichment.census;
  if (!c) return null;

  const context: string[] = [];
  if (c.medianHouseholdIncome !== null) {
    context.push(`${fmtCurrency(c.medianHouseholdIncome)} median income`);
  }
  if (c.population !== null) {
    context.push(`${fmtNum(c.population)} population`);
  }

  if (context.length === 0) return null;

  const verb = context.length === 1 ? "is" : "are";
  return `${joinNatural(context)} ${verb} shown for SDR context, but ${context.length === 1 ? "it does" : "they do"} not directly affect the score or tier.`;
}

function buildScoreReasons(
  lead: Lead,
  enrichment: EnrichmentBundle,
  breakdown: ScoreBreakdown
): string[] {
  const reasons = [
    buildMarketNarrative(enrichment, breakdown),
    buildPropertyNarrative(lead, enrichment, breakdown),
    buildMomentumNarrative(enrichment, breakdown),
  ];
  const context = buildContextNarrative(enrichment);
  if (context) reasons.push(context);
  return reasons;
}

const tierFor = (total: number): Tier => {
  if (total >= TIER_THRESHOLDS.A) return "A";
  if (total >= TIER_THRESHOLDS.B) return "B";
  return "C";
};

export function scoreLead(
  lead: Lead,
  enrichment: EnrichmentBundle
): ScoreResult {
  const breakdown: ScoreBreakdown = {
    marketFit: Math.round(scoreMarketFit(enrichment)),
    propertyFit: Math.round(scorePropertyFit(lead, enrichment)),
    companyMomentum: Math.round(scoreCompanyMomentum(enrichment)),
  };
  const total =
    breakdown.marketFit +
    breakdown.propertyFit +
    breakdown.companyMomentum;
  return {
    total,
    tier: tierFor(total),
    breakdown,
    reasons: buildScoreReasons(lead, enrichment, breakdown),
  };
}

/**
 * Common free / personal email providers. A lead using one of these isn't
 * automatically bad — it could be a junior employee, a consultant, an admin
 * scheduling for an exec — but it's worth flagging so the SDR verifies the
 * decision-maker before outreach.
 */
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "msn.com",
  "live.com",
]);

/**
 * Non-scoring data-quality signals surfaced to the SDR. These never affect
 * tier — they're verification prompts, not penalties.
 */
export function buildQualityFlags(
  lead: Lead,
  enrichment: EnrichmentBundle
): QualityFlag[] {
  const flags: QualityFlag[] = [];

  const email = lead.email?.toLowerCase().trim() ?? "";
  const domain = email.split("@")[1] ?? "";
  const company = lead.company?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";

  if (domain && PERSONAL_EMAIL_DOMAINS.has(domain)) {
    flags.push({
      severity: "warn",
      message: `Personal email domain (${domain}) — verify decision-maker before outreach`,
    });
  } else if (domain && company.length >= 4) {
    const domainStem = domain.split(".")[0]?.replace(/[^a-z0-9]/g, "") ?? "";
    const matches =
      domainStem &&
      (domainStem.includes(company.slice(0, Math.min(6, company.length))) ||
        company.includes(domainStem.slice(0, Math.min(6, domainStem.length))));
    if (!matches) {
      flags.push({
        severity: "warn",
        message: `Email domain (${domain}) doesn't match company (${lead.company}) — confirm affiliation`,
      });
    }
  }

  if (!enrichment.geocode) {
    flags.push({
      severity: "warn",
      message:
        "Address could not be geocoded — Census + walkability signals are missing",
    });
  }

  if (!enrichment.census) {
    flags.push({
      severity: "info",
      message: "Census tract data unavailable — market-fit score is partial",
    });
  }

  if (!enrichment.walkScore && !enrichment.geoapify) {
    flags.push({
      severity: "info",
      message:
        "No walkability data — set WALKSCORE_API_KEY or GEOAPIFY_API_KEY for property-fit signal",
    });
  }

  if (!enrichment.news) {
    flags.push({
      severity: "info",
      message:
        "No news data — set NEWS_API_KEY for company-momentum signal",
    });
  }

  return flags;
}

type ScoredInsight = { weight: number; text: string };

const MAX_INSIGHTS = 5;

/**
 * Pull the most useful 3-5 bullet-style insights from the enrichment for the
 * sales rep. These are *facts*, not pitches — they go straight onto the
 * lead card.
 *
 * Each candidate is weighted by buying-signal strength so that strong signals
 * (high renter share, momentum keywords, dense neighborhood access) bubble
 * to the top. WalkScore vs. Geoapify is mutually exclusive to avoid showing
 * duplicate walkability lines.
 */
export function buildInsights(
  lead: Lead,
  enrichment: EnrichmentBundle
): string[] {
  const candidates: ScoredInsight[] = [];
  const c = enrichment.census;
  const w = enrichment.walkScore;
  const g = enrichment.geoapify;
  const n = enrichment.news;
  const wiki = enrichment.wikipedia;

  if (c?.renterSharePct !== undefined && c?.renterSharePct !== null) {
    const weight =
      c.renterSharePct >= 50 ? 95 : c.renterSharePct >= 30 ? 70 : 35;
    candidates.push({
      weight,
      text:
        `${c.renterSharePct.toFixed(0)}% of households at this address's tract are renters` +
        (c.geographyLabel ? ` (${c.geographyLabel})` : ""),
    });
  }

  if (c?.medianGrossRent) {
    const weight =
      c.medianGrossRent >= 2000 ? 88 : c.medianGrossRent >= 1200 ? 62 : 38;
    candidates.push({
      weight,
      text:
        `Median gross rent in the area is $${c.medianGrossRent.toLocaleString()}/mo` +
        (c.medianHouseholdIncome
          ? `, vs. $${c.medianHouseholdIncome.toLocaleString()} median household income`
          : ""),
    });
  }

  if (n && n.articleCount > 0) {
    const top = n.topArticles[0];
    const weight = n.hasMomentumSignal
      ? 92
      : n.articleCount >= 3
      ? 60
      : 45;
    candidates.push({
      weight,
      text:
        `${n.articleCount} recent news mentions of ${lead.company}` +
        (top ? ` — top: "${top.title}" (${top.source})` : ""),
    });
    if (n.hasMomentumSignal) {
      candidates.push({
        weight: 90,
        text: `Momentum signals: ${n.matchedKeywords.slice(0, 3).join(", ")}`,
      });
    }
  }

  if (w?.walkScore !== undefined && w?.walkScore !== null) {
    const weight = w.walkScore >= 80 ? 78 : w.walkScore >= 60 ? 60 : 40;
    candidates.push({
      weight,
      text:
        `WalkScore ${w.walkScore}${w.walkDescription ? ` — ${w.walkDescription}` : ""}` +
        (w.transitScore ? `, Transit ${w.transitScore}` : ""),
    });
  } else if (g) {
    const radiusKm = (g.radiusMeters / 1000).toFixed(1);
    const weight = g.accessScore >= 70 ? 75 : g.accessScore >= 40 ? 55 : 35;
    candidates.push({
      weight,
      text:
        `Within ${radiusKm}km: ${g.counts.transit} transit, ` +
        `${g.counts.grocery} grocery, ${g.counts.dining} dining, ` +
        `${g.counts.parks} parks (access score ${g.accessScore}/100)`,
    });
    if (g.topPois.length > 0) {
      const sample = g.topPois
        .map((p) =>
          p.distanceMeters !== null
            ? `${p.name} (${p.distanceMeters}m)`
            : p.name
        )
        .join(", ");
      candidates.push({ weight: 50, text: `Nearby: ${sample}` });
    }
  }

  if (c?.populationGrowth5yrPct !== undefined && c?.populationGrowth5yrPct !== null) {
    const sign = c.populationGrowth5yrPct >= 0 ? "+" : "";
    const weight =
      c.populationGrowth5yrPct >= 5
        ? 65
        : c.populationGrowth5yrPct >= 0
        ? 40
        : 22;
    candidates.push({
      weight,
      text: `Tract population ${sign}${c.populationGrowth5yrPct.toFixed(1)}% over the last 5 years`,
    });
  }

  if (wiki && wiki.extract && wiki.source !== "none") {
    const where = wiki.source === "company" ? "Company" : "City";
    const trimmed =
      wiki.extract.length > 220
        ? wiki.extract.slice(0, 217).trimEnd() + "..."
        : wiki.extract;
    candidates.push({ weight: 25, text: `${where} background: ${trimmed}` });
  }

  candidates.sort((a, b) => b.weight - a.weight);
  return candidates.slice(0, MAX_INSIGHTS).map((s) => s.text);
}
