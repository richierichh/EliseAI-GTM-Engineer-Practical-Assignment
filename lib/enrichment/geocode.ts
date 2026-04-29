import type { GeocodeData, Lead } from "../types";

/**
 * Free U.S. Census Geocoder (no API key required).
 *
 * One call returns the matched address, lat/lng AND the FIPS hierarchy
 * (state, county, tract, block group) we need to query the ACS API.
 *
 * Docs: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html
 */
const GEOCODER_URL =
  "https://geocoding.geo.census.gov/geocoder/geographies/address";

type CensusMatch = {
  matchedAddress: string;
  coordinates: { x: number; y: number };
  geographies: {
    "Census Tracts"?: Array<{
      STATE: string;
      COUNTY: string;
      TRACT: string;
    }>;
    "Census Block Groups"?: Array<{
      STATE: string;
      COUNTY: string;
      TRACT: string;
      BLKGRP: string;
    }>;
  };
};

export async function geocodeLead(lead: Lead): Promise<GeocodeData | null> {
  const street = lead.property_address?.trim();
  const city = lead.city?.trim();
  const state = lead.state?.trim();
  if (!street || !city || !state) return null;

  const params = new URLSearchParams({
    street,
    city,
    state,
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
    format: "json",
    layers: "Census Tracts,Census Block Groups",
  });

  const url = `${GEOCODER_URL}?${params.toString()}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Census Geocoder ${res.status}`);
  }
  const data = (await res.json()) as {
    result?: { addressMatches?: CensusMatch[] };
  };
  const match = data.result?.addressMatches?.[0];
  if (!match) return null;

  const tract = match.geographies["Census Tracts"]?.[0];
  if (!tract) return null;
  const blockGroup = match.geographies["Census Block Groups"]?.[0];

  return {
    matchedAddress: match.matchedAddress,
    longitude: match.coordinates.x,
    latitude: match.coordinates.y,
    stateFips: tract.STATE,
    countyFips: tract.COUNTY,
    tractFips: tract.TRACT,
    blockGroupFips: blockGroup?.BLKGRP,
  };
}
