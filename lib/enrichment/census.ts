import type { CensusData, GeocodeData } from "../types";

/**
 * U.S. Census ACS 5-year API.
 *
 * We pull tract-level rental & income signals plus 5-year population growth
 * (current ACS5 vs ACS5 from 5 years prior). API key is optional but the
 * unkeyed endpoint is heavily rate-limited.
 *
 * Docs: https://www.census.gov/data/developers/data-sets/acs-5year.html
 */

const ACS_GROWTH_WINDOW_YEARS = 5;
const ACS_RELEASE_LAG_YEARS = 1;
const ACS_CANDIDATE_COUNT = 5;
const ACS_BASE = "https://api.census.gov/data";

const VARIABLES = {
  population: "B01003_001E",
  medianHouseholdIncome: "B19013_001E",
  medianGrossRent: "B25064_001E",
  occupiedHousingTotal: "B25003_001E",
  renterOccupied: "B25003_003E",
  geographyName: "NAME",
} as const;

type AcsRow = string[];

type AcsScope = "tract" | "county";

type AcsFetchResult = {
  year: number;
  row: Record<string, string>;
};

const latestAcsYearCandidates = (): number[] => {
  const start = new Date().getFullYear() - ACS_RELEASE_LAG_YEARS;
  return Array.from({ length: ACS_CANDIDATE_COUNT }, (_, i) => start - i);
};

async function fetchAcs(
  year: number,
  variables: string[],
  geo: GeocodeData,
  scope: AcsScope = "tract"
): Promise<Record<string, string>> {
  const url = new URL(`${ACS_BASE}/${year}/acs/acs5`);
  url.searchParams.set("get", variables.join(","));
  if (scope === "tract") {
    url.searchParams.set("for", `tract:${geo.tractFips}`);
    url.searchParams.set(
      "in",
      `state:${geo.stateFips} county:${geo.countyFips}`
    );
  } else {
    url.searchParams.set("for", `county:${geo.countyFips}`);
    url.searchParams.set("in", `state:${geo.stateFips}`);
  }
  if (process.env.CENSUS_API_KEY) {
    url.searchParams.set("key", process.env.CENSUS_API_KEY);
  }

  const res = await fetch(url.toString(), {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Census ACS ${year} ${res.status}`);
  }
  const data = (await res.json()) as AcsRow[];
  if (!Array.isArray(data) || data.length < 2) {
    throw new Error(`Census ACS ${year}: empty response`);
  }
  const [headers, row] = data;
  const out: Record<string, string> = {};
  headers.forEach((h, i) => {
    out[h] = row[i];
  });
  return out;
}

async function fetchLatestAcs(
  variables: string[],
  geo: GeocodeData,
  scope: AcsScope = "tract"
): Promise<AcsFetchResult> {
  let lastError: unknown = null;

  for (const year of latestAcsYearCandidates()) {
    try {
      return {
        year,
        row: await fetchAcs(year, variables, geo, scope),
      };
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Census ACS: no available year");
}

const num = (s: string | undefined): number | null => {
  if (s === undefined || s === null || s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  // Census uses negative codes (e.g. -666666666) for missing/suppressed values.
  if (n < 0) return null;
  return n;
};

export async function fetchCensusData(
  geo: GeocodeData
): Promise<CensusData> {
  const baseVars = [
    VARIABLES.population,
    VARIABLES.medianHouseholdIncome,
    VARIABLES.medianGrossRent,
    VARIABLES.occupiedHousingTotal,
    VARIABLES.renterOccupied,
    VARIABLES.geographyName,
  ];

  const latestAcs = await fetchLatestAcs(baseVars, geo);
  const latest = latestAcs.row;
  const priorYear = latestAcs.year - ACS_GROWTH_WINDOW_YEARS;

  const population = num(latest[VARIABLES.population]);
  const medianHouseholdIncome = num(latest[VARIABLES.medianHouseholdIncome]);
  const medianGrossRent = num(latest[VARIABLES.medianGrossRent]);
  const totalHousing = num(latest[VARIABLES.occupiedHousingTotal]);
  const renterOccupied = num(latest[VARIABLES.renterOccupied]);

  const renterSharePct =
    totalHousing && totalHousing > 0 && renterOccupied !== null
      ? Math.round((renterOccupied / totalHousing) * 1000) / 10
      : null;

  // Try tract-level 5-yr growth first. Tract boundaries can shift between
  // decennial redraws (2010 vs 2020) which often makes the prior-year tract
  // lookup fail for urban addresses, so we fall back to county-level — a
  // coarser but more reliable market-dynamism signal.
  let populationGrowth5yrPct: number | null = null;
  try {
    const prior = await fetchAcs(priorYear, [VARIABLES.population], geo);
    const priorPop = num(prior[VARIABLES.population]);
    if (population && priorPop && priorPop > 0) {
      populationGrowth5yrPct =
        Math.round(((population - priorPop) / priorPop) * 1000) / 10;
    }
  } catch {
    // Prior-year tract fetch is best-effort.
  }

  if (populationGrowth5yrPct === null) {
    try {
      const [latestCounty, priorCounty] = await Promise.all([
        fetchAcs(latestAcs.year, [VARIABLES.population], geo, "county"),
        fetchAcs(priorYear, [VARIABLES.population], geo, "county"),
      ]);
      const latestPop = num(latestCounty[VARIABLES.population]);
      const priorPop = num(priorCounty[VARIABLES.population]);
      if (latestPop && priorPop && priorPop > 0) {
        populationGrowth5yrPct =
          Math.round(((latestPop - priorPop) / priorPop) * 1000) / 10;
      }
    } catch {
      // County fallback is also best-effort; leave as null if both fail.
    }
  }

  return {
    population,
    medianHouseholdIncome,
    medianGrossRent,
    renterSharePct,
    populationGrowth5yrPct,
    geographyLabel: latest[VARIABLES.geographyName] ?? null,
  };
}
