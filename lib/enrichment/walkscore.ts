import type { GeocodeData, Lead, WalkScoreData } from "../types";

/**
 * WalkScore API.
 *
 * Free key tier (signup at https://www.walkscore.com/professional/api-sign-up.php)
 * returns walk/transit/bike scores for a lat/lng + address.
 *
 * Docs: https://www.walkscore.com/professional/api.php
 */
const WALKSCORE_URL = "https://api.walkscore.com/score";

type WalkScoreResponse = {
  status: number;
  walkscore?: number;
  description?: string;
  ws_link?: string;
  transit?: { score?: number };
  bike?: { score?: number };
};

export async function fetchWalkScore(
  lead: Lead,
  geo: GeocodeData
): Promise<WalkScoreData | null> {
  const apiKey = process.env.WALKSCORE_API_KEY;
  if (!apiKey) return null;

  const fullAddress = [
    lead.property_address,
    lead.city,
    lead.state,
  ]
    .filter(Boolean)
    .join(", ");

  const params = new URLSearchParams({
    format: "json",
    address: fullAddress,
    lat: String(geo.latitude),
    lon: String(geo.longitude),
    transit: "1",
    bike: "1",
    wsapikey: apiKey,
  });

  const res = await fetch(`${WALKSCORE_URL}?${params.toString()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`WalkScore ${res.status}`);
  }
  const data = (await res.json()) as WalkScoreResponse;

  // status 1 = success, 2 = score is being calculated, others are errors.
  if (data.status !== 1 && data.status !== 2) {
    throw new Error(`WalkScore status=${data.status}`);
  }

  return {
    walkScore: typeof data.walkscore === "number" ? data.walkscore : null,
    walkDescription: data.description ?? null,
    transitScore:
      typeof data.transit?.score === "number" ? data.transit.score : null,
    bikeScore: typeof data.bike?.score === "number" ? data.bike.score : null,
  };
}
