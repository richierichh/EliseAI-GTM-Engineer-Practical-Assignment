import type {
  GeoapifyCounts,
  GeoapifyData,
  GeocodeData,
} from "../types";

/**
 * Geoapify Places API.
 *
 * Geoapify exposes a free tier (3000 req/day) that returns nearby POIs by
 * category. We use it to derive a *transparent, explainable* access score
 * from real points of interest — useful as a stand-in for / complement to
 * WalkScore, with the bonus that we control the formula and can show the
 * underlying counts to the sales team.
 *
 * Docs: https://apidocs.geoapify.com/docs/places/
 */
const PLACES_URL = "https://api.geoapify.com/v2/places";

const RADIUS_METERS = 1200; // ~15-minute walk

const CATEGORY_GROUPS: Record<keyof GeoapifyCounts, string[]> = {
  transit: ["public_transport"],
  grocery: ["commercial.supermarket", "commercial.convenience"],
  dining: ["catering.restaurant", "catering.cafe", "catering.bar"],
  parks: ["leisure.park"],
  fitness: ["sport.fitness"],
  healthcare: ["healthcare.hospital", "healthcare.clinic_or_praxis"],
  education: ["education.school", "education.university"],
};

const ALL_CATEGORIES = Array.from(
  new Set(Object.values(CATEGORY_GROUPS).flat())
);

const ACCESS_WEIGHTS: Record<keyof GeoapifyCounts, { target: number; pts: number }> = {
  transit: { target: 5, pts: 25 },
  grocery: { target: 3, pts: 20 },
  dining: { target: 10, pts: 20 },
  parks: { target: 1, pts: 10 },
  fitness: { target: 1, pts: 10 },
  healthcare: { target: 1, pts: 10 },
  education: { target: 1, pts: 5 },
};

type GeoapifyFeature = {
  properties?: {
    name?: unknown;
    formatted?: unknown;
    categories?: string[];
    distance?: number;
  };
};

const safeString = (v: unknown): string =>
  typeof v === "string" ? v : "";

type GeoapifyResponse = {
  features?: GeoapifyFeature[];
};

const matchesGroup = (
  cats: string[] | undefined,
  group: string[]
): boolean => {
  if (!cats || cats.length === 0) return false;
  return cats.some((c) => group.some((g) => c === g || c.startsWith(`${g}.`)));
};

const computeAccessScore = (counts: GeoapifyCounts): number => {
  let total = 0;
  (Object.keys(ACCESS_WEIGHTS) as Array<keyof GeoapifyCounts>).forEach((k) => {
    const { target, pts } = ACCESS_WEIGHTS[k];
    const ratio = Math.min(counts[k] / target, 1);
    total += ratio * pts;
  });
  return Math.round(total);
};

// Ordered most-specific first; we ignore non-place attributes such as
// `dogs.*`, `wheelchair.*`, `access.*`, `internet_access.*`, `vegan.*`, etc.,
// which Geoapify includes alongside the real category.
const CATEGORY_LABELS: Array<{ match: string; label: string }> = [
  { match: "leisure.park", label: "park" },
  { match: "public_transport.subway", label: "subway" },
  { match: "public_transport.bus", label: "bus stop" },
  { match: "public_transport.train", label: "train station" },
  { match: "public_transport.tram", label: "tram stop" },
  { match: "public_transport.ferry", label: "ferry" },
  { match: "public_transport", label: "transit" },
  { match: "commercial.supermarket", label: "supermarket" },
  { match: "commercial.convenience", label: "convenience store" },
  { match: "catering.restaurant", label: "restaurant" },
  { match: "catering.cafe", label: "cafe" },
  { match: "catering.bar", label: "bar" },
  { match: "catering.fast_food", label: "fast food" },
  { match: "catering", label: "restaurant" },
  { match: "education.school", label: "school" },
  { match: "education.university", label: "university" },
  { match: "education.college", label: "college" },
  { match: "education", label: "school" },
  { match: "healthcare.hospital", label: "hospital" },
  { match: "healthcare.clinic_or_praxis", label: "clinic" },
  { match: "healthcare.pharmacy", label: "pharmacy" },
  { match: "healthcare", label: "healthcare" },
  { match: "sport.fitness", label: "gym" },
  { match: "sport", label: "sport" },
  { match: "commercial", label: "shop" },
  { match: "leisure", label: "leisure" },
];

const friendlyCategory = (cats: string[] | undefined): string => {
  if (!cats || cats.length === 0) return "place";
  for (const cat of cats) {
    for (const { match, label } of CATEGORY_LABELS) {
      if (cat === match || cat.startsWith(`${match}.`)) return label;
    }
  }
  return "place";
};

export async function fetchGeoapify(
  geo: GeocodeData
): Promise<GeoapifyData | null> {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) return null;

  const params = new URLSearchParams({
    categories: ALL_CATEGORIES.join(","),
    filter: `circle:${geo.longitude},${geo.latitude},${RADIUS_METERS}`,
    bias: `proximity:${geo.longitude},${geo.latitude}`,
    limit: "100",
    apiKey,
  });

  const res = await fetch(`${PLACES_URL}?${params.toString()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    let details = "";
    try {
      const errBody = (await res.json()) as { message?: unknown };
      details = safeString(errBody.message).trim();
    } catch {
      // ignore
    }
    throw new Error(
      details ? `Geoapify ${res.status}: ${details}` : `Geoapify ${res.status}`
    );
  }
  const data = (await res.json()) as GeoapifyResponse;
  const features = data.features ?? [];

  const counts: GeoapifyCounts = {
    transit: 0,
    grocery: 0,
    dining: 0,
    parks: 0,
    fitness: 0,
    healthcare: 0,
    education: 0,
  };

  for (const f of features) {
    const cats = f.properties?.categories;
    for (const key of Object.keys(CATEGORY_GROUPS) as Array<keyof GeoapifyCounts>) {
      if (matchesGroup(cats, CATEGORY_GROUPS[key])) {
        counts[key] += 1;
        break;
      }
    }
  }

  const namedNearby = features
    .filter((f) => safeString(f.properties?.name).trim().length > 0)
    .slice(0, 5)
    .map((f) => ({
      name: safeString(f.properties?.name).trim(),
      category: friendlyCategory(f.properties?.categories),
      distanceMeters:
        typeof f.properties?.distance === "number"
          ? Math.round(f.properties.distance)
          : null,
    }))
    .slice(0, 3);

  return {
    accessScore: computeAccessScore(counts),
    radiusMeters: RADIUS_METERS,
    counts,
    totalPois: features.length,
    topPois: namedNearby,
  };
}
