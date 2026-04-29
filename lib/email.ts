import Anthropic from "@anthropic-ai/sdk";
import type {
  DraftEmail,
  EnrichmentBundle,
  Lead,
  ScoreResult,
} from "./types";

/**
 * LLM-drafted intro email.
 *
 * The prompt is intentionally tight:
 *   - 90-130 words, conversational, no marketing-speak
 *   - must reference EXACTLY ONE concrete fact from the enrichment
 *   - no fabrications: only data we explicitly pass in
 *   - return strict JSON: { "subject": ..., "body": ... }
 *
 * OpenAI GPT is preferred when OPENAI_API_KEY is present. Claude remains as a
 * fallback provider when ANTHROPIC_API_KEY is present. If both are missing or
 * fail, we use a deterministic template so the pipeline always returns copy.
 */

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

const SYSTEM_PROMPT = `You are an SDR at EliseAI writing a first-touch outbound email to a multifamily property-management lead.

EliseAI builds AI leasing assistants that handle prospect inquiries 24/7 over SMS, email, and chat — qualifying leads, answering questions, and booking tours automatically.

Rules for the email:
- 90 to 130 words, plain text, no markdown, no emojis.
- Conversational and specific. Sound like a human SDR, not a marketing template.
- Reference EXACTLY ONE concrete data point from the enrichment block (a stat, a news headline, or a city/property fact). Do not invent numbers — if you reference one, it must come from the data provided.
- One soft CTA at the end (a 15-min call next week).
- Sign off as "Alex from EliseAI".
- Do NOT mention that the data was AI-generated, scraped, or pulled from APIs.

Return ONLY valid JSON of the form: {"subject": "...", "body": "..."} — no prose, no code fences.`;

function buildUserPayload(
  lead: Lead,
  enrichment: EnrichmentBundle,
  score: ScoreResult,
  insights: string[]
): string {
  const c = enrichment.census;
  const w = enrichment.walkScore;
  const g = enrichment.geoapify;
  const n = enrichment.news;
  const wiki = enrichment.wikipedia;

  const payload = {
    contact: {
      name: lead.name,
      company: lead.company,
      city: lead.city,
      state: lead.state,
      property_address: lead.property_address,
    },
    score: {
      total: score.total,
      tier: score.tier,
    },
    insights,
    raw_data: {
      market: c
        ? {
            renter_share_pct: c.renterSharePct,
            median_gross_rent_usd: c.medianGrossRent,
            median_household_income_usd: c.medianHouseholdIncome,
            population_growth_5yr_pct: c.populationGrowth5yrPct,
            geography: c.geographyLabel,
          }
        : null,
      walkability: w
        ? {
            walk_score: w.walkScore,
            walk_description: w.walkDescription,
            transit_score: w.transitScore,
          }
        : null,
      neighborhood: g
        ? {
            radius_meters: g.radiusMeters,
            access_score: g.accessScore,
            counts: g.counts,
            top_nearby: g.topPois.map((p) => ({
              name: p.name,
              category: p.category,
              distance_m: p.distanceMeters,
            })),
          }
        : null,
      news: n
        ? {
            article_count: n.articleCount,
            momentum_keywords: n.matchedKeywords,
            top_headline: n.topArticles[0]
              ? {
                  title: n.topArticles[0].title,
                  source: n.topArticles[0].source,
                }
              : null,
          }
        : null,
      wikipedia:
        wiki && wiki.source !== "none"
          ? { source: wiki.source, title: wiki.title, extract: wiki.extract }
          : null,
    },
  };

  return `Draft an intro email for the following lead. Use ONLY the data below; do not invent anything.\n\n${JSON.stringify(payload, null, 2)}`;
}

const firstName = (full: string): string => {
  const t = full.trim().split(/\s+/)[0] ?? "there";
  return t || "there";
};

function fallbackEmail(
  lead: Lead,
  enrichment: EnrichmentBundle
): DraftEmail {
  const c = enrichment.census;
  const n = enrichment.news;
  const w = enrichment.walkScore;
  const g = enrichment.geoapify;

  let hook = "";
  if (n?.topArticles?.[0]?.title) {
    hook = `Saw the recent piece — "${n.topArticles[0].title}" — congrats on the momentum.`;
  } else if (c?.renterSharePct !== null && c?.renterSharePct !== undefined) {
    hook = `Noticed the area around ${lead.property_address || lead.city} runs about ${c.renterSharePct.toFixed(0)}% renters, which is exactly the segment we work with.`;
  } else if (w?.walkScore) {
    hook = `Noticed your property pulls a WalkScore of ${w.walkScore} — strong urban renter pool.`;
  } else if (g && g.counts.transit + g.counts.grocery + g.counts.dining > 0) {
    hook =
      `The block around ${lead.property_address || lead.city} has ` +
      `${g.counts.transit} transit stops, ${g.counts.grocery} grocery, and ` +
      `${g.counts.dining} dining options within a 15-min walk — exactly ` +
      `the kind of dense renter pocket we work with.`;
  } else {
    hook = `Came across ${lead.company} while looking at multifamily operators in ${lead.city}, ${lead.state}.`;
  }

  const body = [
    `Hi ${firstName(lead.name)},`,
    "",
    hook,
    "",
    `EliseAI runs an AI leasing assistant that handles prospect inquiries 24/7 over SMS, email, and chat — qualifying renters, answering questions, and booking tours so your team can focus on the hot leads. Properties similar to yours typically see ~30% more tours booked in the first 60 days.`,
    "",
    `Worth a 15-minute call next week to see if it'd fit ${lead.company}? Happy to share a couple of customer examples in ${lead.state}.`,
    "",
    "Best,",
    "Alex",
    "EliseAI",
  ].join("\n");

  return {
    subject: `Quick idea for ${lead.company}'s leasing team`,
    body,
    source: "fallback",
  };
}

function extractJson(text: string): { subject: string; body: string } | null {
  // Tolerate occasional code fences or stray prose around the JSON.
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (
      parsed &&
      typeof parsed.subject === "string" &&
      typeof parsed.body === "string"
    ) {
      return { subject: parsed.subject, body: parsed.body };
    }
  } catch {
    return null;
  }
  return null;
}

async function draftWithOpenAI(
  apiKey: string,
  lead: Lead,
  enrichment: EnrichmentBundle,
  score: ScoreResult,
  insights: string[]
): Promise<DraftEmail | null> {
  const res = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
      temperature: 0.4,
      max_tokens: 700,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: buildUserPayload(lead, enrichment, score, insights),
        },
      ],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) return null;

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) return null;

  const parsed = extractJson(text);
  if (!parsed) return null;

  return {
    subject: parsed.subject.trim(),
    body: parsed.body.trim(),
    source: "gpt",
  };
}

async function draftWithClaude(
  apiKey: string,
  lead: Lead,
  enrichment: EnrichmentBundle,
  score: ScoreResult,
  insights: string[]
): Promise<DraftEmail | null> {
  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 700,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: buildUserPayload(lead, enrichment, score, insights) },
    ],
  });

  const textBlock = resp.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return null;

  const parsed = extractJson(textBlock.text);
  if (!parsed) return null;

  return {
    subject: parsed.subject.trim(),
    body: parsed.body.trim(),
    source: "claude",
  };
}

export async function draftEmail(
  lead: Lead,
  enrichment: EnrichmentBundle,
  score: ScoreResult,
  insights: string[]
): Promise<DraftEmail> {
  const openAiKey = process.env.OPENAI_API_KEY;
  if (openAiKey) {
    try {
      const draft = await draftWithOpenAI(
        openAiKey,
        lead,
        enrichment,
        score,
        insights
      );
      if (draft) return draft;
    } catch {
      // Fall through to Claude/template fallback.
    }
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    try {
      const draft = await draftWithClaude(
        anthropicKey,
        lead,
        enrichment,
        score,
        insights
      );
      if (draft) return draft;
    } catch {
      // Fall through to deterministic fallback.
    }
  }

  return fallbackEmail(lead, enrichment);
}

export const __emailTest = {
  draftWithOpenAI,
  extractJson,
};
