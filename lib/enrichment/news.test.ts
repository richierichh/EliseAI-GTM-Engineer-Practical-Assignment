import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { Lead } from "../types";
import { __newsTest } from "./news";

const lead: Lead = {
  name: "Avery",
  email: "avery@example.com",
  company: "Equity Residential",
  property_address: "1 Main St",
  city: "Boston",
  state: "MA",
  country: "USA",
};

const article = (overrides: {
  title?: string;
  description?: string;
  url?: string;
  source?: string;
  publishedAt?: string;
}) => ({
  title: overrides.title ?? "Equity reports new apartment growth",
  description:
    overrides.description ??
    "The apartment owner is expanding its multifamily portfolio in Boston.",
  url: overrides.url ?? "https://example.com/equity-residential-growth",
  source: { name: overrides.source ?? "Example News" },
  publishedAt: overrides.publishedAt ?? "2026-04-01T12:00:00Z",
});

describe("news enrichment helpers", () => {
  it("builds exact-phrase NewsAPI queries scoped to state and city", () => {
    const brand = __newsTest.extractBrand("Greystar Real Estate Partners");

    assert.deepEqual(brand, { brand: "greystar", stripped: true });
    assert.deepEqual(
      __newsTest.buildNewsQueries(
        { ...lead, company: "Greystar Real Estate Partners", city: "Austin" },
        brand.brand
      ),
      // state="MA" (from lead fixture), city="Austin"
      // Primary: quoted full name + state; secondary: + city; fallback: brand + state
      [
        '"Greystar Real Estate Partners" MA',
        '"Greystar Real Estate Partners" Austin',
        "greystar MA",
      ]
    );
  });

  it("accepts sparse multi-word brand snippets when context is strong", () => {
    const brand = __newsTest.extractBrand(lead.company);
    const ranked = __newsTest.rankArticle(article({}), {
      brand: brand.brand,
      stripped: brand.stripped,
      brandWords: ["equity", "residential"],
      companyWords: ["equity", "residential"],
      locationWords: ["boston", "ma"],
    });

    assert.ok(ranked);
    assert.ok(ranked.score >= 45);
  });

  it("requires property context for stripped single-word brands", () => {
    const brand = __newsTest.extractBrand("Carter Property Management");
    const context = {
      brand: brand.brand,
      stripped: brand.stripped,
      brandWords: ["carter"],
      companyWords: ["carter", "property", "management"],
      locationWords: ["phoenix", "az"],
    };

    assert.equal(
      __newsTest.rankArticle(
        article({
          title: "Carter announces tour dates",
          description: "The singer announced a national tour.",
          url: "https://example.com/carter-tour",
        }),
        context
      ),
      null
    );

    assert.ok(
      __newsTest.rankArticle(
        article({
          title: "Carter buys apartment portfolio",
          description: "The property manager expanded in Phoenix.",
          url: "https://example.com/carter-apartments",
        }),
        context
      )
    );
  });

  it("rejects common-name brand matched only by author/person name without real estate + location", () => {
    const brand = __newsTest.extractBrand("Morgan Properties");
    const context = {
      brand: brand.brand,
      stripped: brand.stripped,
      brandWords: ["morgan"],
      companyWords: ["morgan", "properties"],
      locationWords: ["philadelphia", "pa"],
    };

    // Article about poet Morgan Parker — "morgan" matches the brand word but
    // has no real estate context AND no Philadelphia/PA location signal.
    assert.equal(
      __newsTest.rankArticle(
        article({
          title: "Meanwhile It Rains for Two Weeks and the Heat Never Breaks",
          description:
            "A debut collection by Morgan Parker exploring identity and grief.",
          url: "https://example.com/morgan-parker-poetry",
        }),
        context
      ),
      null
    );

    // Article that mentions Morgan Properties by its full name passes.
    assert.ok(
      __newsTest.rankArticle(
        article({
          title: "Morgan Properties acquires Philadelphia complex",
          description:
            "Morgan Properties expanded its apartment portfolio in Philadelphia.",
          url: "https://example.com/morgan-properties-philadelphia",
        }),
        context
      )
    );
  });

  it("rejects South Florida Greystar article for a San Francisco CA lead", () => {
    // Regression: "ca" in words like "local" must NOT satisfy the CA location
    // requirement — whole-word token matching is required.
    const sfContext = {
      brand: "greystar",
      stripped: true,
      brandWords: ["greystar"],
      companyWords: ["greystar", "real", "estate", "partners"],
      // CA lead: abbreviation + full state name both included after fix #2
      locationWords: ["san", "francisco", "ca", "california"],
    };

    // South Florida article: no California/San Francisco mention.
    // Old bug: "local" substring-matched "ca" → false hasLocation=true.
    assert.equal(
      __newsTest.rankArticle(
        article({
          title:
            "Lease roundup: Pura Vida + Pilates and yoga studios on tap across South Florida",
          description:
            "Greystar's South Florida portfolio adds local yoga and pilates studios.",
          url: "https://therealdeal.com/2026/04/south-florida-greystar-lease-roundup",
        }),
        sfContext
      ),
      null
    );

    // Genuinely relevant article: mentions Greystar + San Francisco.
    assert.ok(
      __newsTest.rankArticle(
        article({
          title: "Greystar opens luxury tower in San Francisco",
          description:
            "Greystar Real Estate Partners completed a 400-unit apartment community in San Francisco, California.",
          url: "https://example.com/greystar-san-francisco-tower",
        }),
        sfContext
      )
    );
  });

  it("blocks consent and non-http article URLs before ranking", () => {
    assert.equal(__newsTest.isUsableArticleUrl("ftp://example.com/story"), false);
    assert.equal(
      __newsTest.isUsableArticleUrl(
        "https://consent.yahoo.com/collectConsent?session=abc"
      ),
      false
    );
  });

  it("drops observed 404 links and falls back when HEAD is unsupported", async () => {
    const notFound = mock.fn(async () => new Response("", { status: 404 }));
    assert.equal(
      await __newsTest.validateArticleUrl(
        "https://example.com/missing",
        notFound as unknown as typeof fetch
      ),
      false
    );

    const headUnsupported = mock.fn(async () =>
      headUnsupported.mock.callCount() === 0
        ? new Response("", { status: 405 })
        : new Response("", { status: 200 })
    );
    assert.equal(
      await __newsTest.validateArticleUrl(
        "https://example.com/story",
        headUnsupported as unknown as typeof fetch
      ),
      true
    );
    assert.equal(headUnsupported.mock.callCount(), 2);
  });
});
