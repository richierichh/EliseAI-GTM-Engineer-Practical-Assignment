import type { EnrichedLead, Lead } from "./types";

/**
 * Lightweight, dependency-free CSV parser. Handles double-quoted fields with
 * embedded commas and escaped quotes (RFC 4180-ish). Good enough for the
 * lead-list use case, where rows are short and well-behaved.
 */
export function parseCsv(input: string): Record<string, string>[] {
  const text = input.replace(/^\uFEFF/, "").trim();
  if (!text) return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return rows.slice(1)
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => {
      const obj: Record<string, string> = {};
      header.forEach((key, idx) => {
        obj[key] = (r[idx] ?? "").trim();
      });
      return obj;
    });
}

/**
 * Normalize a parsed CSV row (or arbitrary object) into a Lead. Tolerant of
 * common header variants used by SDRs / marketing forms.
 */
export function rowToLead(row: Record<string, string>): Lead {
  const get = (...keys: string[]): string => {
    for (const k of keys) {
      const v = row[k];
      if (v && v.trim() !== "") return v.trim();
    }
    return "";
  };
  return {
    name: get("name", "full_name", "contact_name", "first_name"),
    email: get("email", "email_address"),
    company: get("company", "company_name", "organization", "account"),
    property_address: get(
      "property_address",
      "address",
      "street_address",
      "street",
      "building_address"
    ),
    city: get("city"),
    state: get("state", "region"),
    country: get("country") || "US",
  };
}

export function parseLeadsCsv(input: string): Lead[] {
  return parseCsv(input).map(rowToLead).filter((l) => l.name || l.email || l.company);
}

const csvEscape = (val: unknown): string => {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

const ENRICHED_HEADERS = [
  "name",
  "email",
  "company",
  "property_address",
  "city",
  "state",
  "country",
  "score",
  "tier",
  "market_fit",
  "property_fit",
  "company_momentum",
  "quality_flags",
  "renter_share_pct",
  "median_gross_rent",
  "median_household_income",
  "population",
  "population_growth_5yr_pct",
  "walk_score",
  "transit_score",
  "geoapify_access_score",
  "geoapify_transit",
  "geoapify_grocery",
  "geoapify_dining",
  "geoapify_parks",
  "geoapify_fitness",
  "geoapify_healthcare",
  "geoapify_education",
  "geoapify_radius_m",
  "news_article_count",
  "top_news_title",
  "top_news_url",
  "insights",
  "email_subject",
  "email_body",
  "email_source",
  "enriched_at",
];

export function enrichedLeadsToCsv(leads: EnrichedLead[]): string {
  const rows: string[] = [ENRICHED_HEADERS.join(",")];
  for (const l of leads) {
    const c = l.enrichment.census;
    const w = l.enrichment.walkScore;
    const g = l.enrichment.geoapify;
    const n = l.enrichment.news;
    const top = n?.topArticles?.[0];
    rows.push(
      [
        l.lead.name,
        l.lead.email,
        l.lead.company,
        l.lead.property_address,
        l.lead.city,
        l.lead.state,
        l.lead.country,
        l.score.total,
        l.score.tier,
        l.score.breakdown.marketFit,
        l.score.breakdown.propertyFit,
        l.score.breakdown.companyMomentum,
        (l.qualityFlags ?? []).map((f) => f.message).join(" | "),
        c?.renterSharePct ?? "",
        c?.medianGrossRent ?? "",
        c?.medianHouseholdIncome ?? "",
        c?.population ?? "",
        c?.populationGrowth5yrPct ?? "",
        w?.walkScore ?? "",
        w?.transitScore ?? "",
        g?.accessScore ?? "",
        g?.counts.transit ?? "",
        g?.counts.grocery ?? "",
        g?.counts.dining ?? "",
        g?.counts.parks ?? "",
        g?.counts.fitness ?? "",
        g?.counts.healthcare ?? "",
        g?.counts.education ?? "",
        g?.radiusMeters ?? "",
        n?.articleCount ?? "",
        top?.title ?? "",
        top?.url ?? "",
        l.insights.join(" | "),
        l.email.subject,
        l.email.body,
        l.email.source,
        l.enrichedAt,
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  return rows.join("\n");
}
