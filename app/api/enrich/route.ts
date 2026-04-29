import { NextRequest, NextResponse } from "next/server";
import type { Lead } from "@/lib/types";
import { enrichLeads } from "@/lib/pipeline";
import {
  authConfigured,
  getSessionCookieName,
  verifySessionToken,
} from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

const REQUIRED_FIELDS: Array<keyof Lead> = [
  "name",
  "email",
  "company",
  "property_address",
  "city",
  "state",
];

async function isAuthorized(req: NextRequest): Promise<boolean> {
  if (!authConfigured()) return true;
  const token = req.cookies.get(getSessionCookieName())?.value;
  const session = await verifySessionToken(token);
  return Boolean(session);
}

function normalizeLead(raw: unknown): Lead | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const get = (k: string): string =>
    typeof r[k] === "string" ? (r[k] as string).trim() : "";
  const lead: Lead = {
    name: get("name"),
    email: get("email"),
    company: get("company"),
    property_address: get("property_address") || get("address"),
    city: get("city"),
    state: get("state"),
    country: get("country") || "US",
  };
  const hasMinimum = REQUIRED_FIELDS.every((f) => lead[f] !== "");
  if (!hasMinimum) return null;
  return lead;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const rawLeads = Array.isArray((body as { leads?: unknown })?.leads)
    ? ((body as { leads: unknown[] }).leads)
    : Array.isArray(body)
    ? (body as unknown[])
    : null;

  if (!rawLeads) {
    return NextResponse.json(
      {
        error:
          "Body must be { leads: Lead[] } or a Lead[] array. Required Lead fields: name, email, company, property_address, city, state.",
      },
      { status: 400 }
    );
  }

  if (rawLeads.length === 0) {
    return NextResponse.json({ leads: [] });
  }
  if (rawLeads.length > 25) {
    return NextResponse.json(
      { error: "Max 25 leads per request" },
      { status: 400 }
    );
  }

  const leads: Lead[] = [];
  const rejected: { index: number; reason: string }[] = [];
  rawLeads.forEach((r, i) => {
    const normalized = normalizeLead(r);
    if (normalized) leads.push(normalized);
    else rejected.push({ index: i, reason: "Missing required fields" });
  });

  if (leads.length === 0) {
    return NextResponse.json(
      { error: "No valid leads after normalization", rejected },
      { status: 400 }
    );
  }

  const results = await enrichLeads(leads, 3);
  return NextResponse.json({ leads: results, rejected });
}
