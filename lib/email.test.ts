import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { EnrichmentBundle, Lead, ScoreResult } from "./types";
import { __emailTest, draftEmail } from "./email";

const lead: Lead = {
  name: "Avery Jones",
  email: "avery@example.com",
  company: "Example Management",
  property_address: "1 Main St",
  city: "Boston",
  state: "MA",
  country: "USA",
};

const enrichment: EnrichmentBundle = {
  geocode: null,
  census: null,
  walkScore: null,
  geoapify: null,
  news: null,
  wikipedia: null,
  errors: {},
};

const score: ScoreResult = {
  total: 72,
  tier: "B",
  breakdown: {
    marketFit: 28,
    propertyFit: 20,
    companyMomentum: 24,
  },
  reasons: [],
};

const originalOpenAiKey = process.env.OPENAI_API_KEY;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
const originalFetch = globalThis.fetch;

afterEach(() => {
  process.env.OPENAI_API_KEY = originalOpenAiKey;
  process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  globalThis.fetch = originalFetch;
  mock.restoreAll();
});

describe("email drafting", () => {
  it("parses JSON responses with light wrapping", () => {
    assert.deepEqual(
      __emailTest.extractJson('```json\n{"subject":"Hi","body":"Body"}\n```'),
      { subject: "Hi", body: "Body" }
    );
  });

  it("uses OpenAI GPT when OPENAI_API_KEY is configured", async () => {
    const fetchCalls: Parameters<typeof fetch>[] = [];
    const fetchMock = mock.fn(async (...args: Parameters<typeof fetch>) => {
      fetchCalls.push(args);
      return Response.json({
        choices: [
          {
            message: {
              content:
                '{"subject":"Quick idea for Example","body":"Hi Avery,\\n\\nBody"}',
            },
          },
        ],
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const draft = await __emailTest.draftWithOpenAI(
      "sk-test",
      lead,
      enrichment,
      score,
      ["Good lead"]
    );

    assert.equal(draft?.source, "gpt");
    assert.equal(draft?.subject, "Quick idea for Example");

    const request = fetchCalls[0];
    assert.equal(request[0], "https://api.openai.com/v1/chat/completions");
    assert.equal(
      request[1]?.headers &&
        (request[1].headers as Record<string, string>).Authorization,
      "Bearer sk-test"
    );
  });

  it("falls back to the deterministic template when no LLM key is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const draft = await draftEmail(lead, enrichment, score, []);

    assert.equal(draft.source, "fallback");
    assert.match(draft.subject, /Example Management/);
  });
});
