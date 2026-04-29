# EliseAI GTM Lead Enrichment

A Next.js tool that enriches inbound EliseAI leads with public data, scores them against EliseAI's multifamily ICP, and drafts a personalized first-touch email with GPT or Claude. Runs on demand from a sales-rep UI trigger.

## What it does

Given a lead with `name, email, company, property_address, city, state, country`, the tool:

1. Geocodes the property address (U.S. Census Geocoder).
2. Pulls demographic + rental signals for the property's census tract (Census ACS 5-year).
3. Pulls walkability/transit scores for the address (WalkScore).
4. Pulls recent news mentions for the company (NewsAPI).
5. Pulls a company / city background blurb (Wikipedia).
6. Scores the lead 0–100 across 4 weighted dimensions and assigns Tier A/B/C.
7. Generates 3–5 sales-rep insights from the data.
8. Drafts a personalized intro email with OpenAI GPT, Anthropic Claude, or a deterministic template fallback.

Results are returned to the UI and exportable as CSV or Excel.

## Public APIs used (and why)

EliseAI sells AI leasing assistants to multifamily property managers, so signals were chosen to reflect rental-market quality, property fit, and company context.

| API | What it gives us | Why it matters for EliseAI |
| --- | --- | --- |
| **U.S. Census Geocoder** (no key) | Address → lat/lng + state/county/tract FIPS | Prereq for ACS + WalkScore. Free, no rate-limit auth required. |
| **Census ACS 5-year** (key optional) | Renter share, median rent, median income, population, 5-yr growth | Best free signal for "is this a real rental market" — directly proxies leasing volume. |
| **WalkScore** (free key) | Walk / transit / bike scores | Walkable urban properties = the segment where AI leasing assistants generate the most lift. |
| **Geoapify Places** (free key) | Nearby POIs (transit, grocery, dining, parks, fitness, healthcare, education) within a 15-min walk | Powers a transparent, in-house access score that backstops WalkScore (which has a multi-day approval window) and gives concrete amenity counts the SDR can quote in outreach. |
| **NewsAPI** (free key) | Recent company news (30-day default lookback) | Buying-intent signal (expansion, fundraising, acquisition) AND the best email personalization hook. |
| **Wikipedia REST** (no key) | Short company / city summary | Fallback context when news is sparse; used for color in the email opener. |
| **OpenAI GPT / Anthropic Claude** (paid key) | Drafted intro email subject + body | Personalizes the outreach using the structured enrichment, with strict no-fabrication prompt. GPT is preferred when `OPENAI_API_KEY` is set; Claude is the fallback provider. |

## Repo layout

```
proxy.ts                       # session gate (middleware) when DEMO_* env vars are set
app/
  page.tsx                     # paste/upload UI + results
  login/page.tsx               # optional login gate (when DEMO_* env vars are set)
  api/
    enrich/route.ts            # POST: main pipeline (UI trigger)
    sample/route.ts            # serves data/sample_leads.csv to the UI
    auth/login/route.ts        # demo session cookie (HMAC-signed)
    auth/logout/route.ts       # clear session cookie
lib/
  pipeline.ts                  # orchestrator: geocode → fan-out → score → email
  scoring.ts                   # documented rubric + tunable weights
  email.ts                     # GPT/Claude prompt + JSON parsing + template fallback
  csv.ts                       # CSV parser/exporter
  excel.ts                     # enriched-lead spreadsheet download (UI button)
  types.ts                     # Lead, EnrichedLead, Score, etc.
  enrichment/
    geocode.ts                 # Census Geocoder
    census.ts                  # ACS 5-year pulls
    walkscore.ts               # WalkScore API
    geoapify.ts                # Geoapify Places API + derived access score
    news.ts                    # NewsAPI
    wikipedia.ts               # Wikipedia REST
components/
  LeadInput.tsx                # paste/upload + parse UX
  LeadCard.tsx                 # per-lead enriched card with score, insights, email
  ResultsTable.tsx             # summary table across all leads
data/
  sample_leads.csv             # verified multifamily property-management leads
docs/
  ROLLOUT_PLAN.md              # phased sales-org rollout plan
.env.example
```

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Get free API keys** (the tool runs without them — it just degrades gracefully):

   - **WalkScore** — sign up at <https://www.walkscore.com/professional/api-sign-up.php>
   - **NewsAPI** — sign up at <https://newsapi.org/register>
   - **Census** — optional but recommended for rate limits: <https://api.census.gov/data/key_signup.html>
   - **Anthropic** — <https://console.anthropic.com/>

3. **Create `.env.local`** by copying `.env.example`:

   ```bash
   cp .env.example .env.local
   # edit .env.local and paste in your keys
   ```

   Optionally, to protect a public deployment behind login, also set:

   - `DEMO_ADMIN_EMAIL`
   - `DEMO_ADMIN_PASSWORD`
   - `DEMO_SESSION_SECRET` (random string used to sign the session cookie)

4. **Run locally**

   ```bash
   npm run dev
   ```

   Open <http://localhost:3000>, click "Load full sample", then "Enrich leads".

## Automation

The "Enrich leads" button on `app/page.tsx` POSTs to `/api/enrich`. The rep enters a lead or imports a CSV, clicks the enrichment button, and the same server-side pipeline runs for every submitted lead. That server route is the automation surface an SDR would use ad-hoc on a fresh batch; in production it could be replaced or complemented by a CRM/webhook trigger when a new lead is created.

## Lead scoring rubric (documented assumptions)

Total = 100, mapped to Tier A (≥75), B (50–74), C (<50). Weights live in `lib/scoring.ts` as constants and are tunable. Three pillars: **Market Fit (40) + Property Fit (30) + Company Momentum (30)**.

### Market fit — 40 pts

The property's census tract is a proxy for the broader portfolio's market quality. We assume EliseAI's ROI scales with rental demand and renter density.

- **Renter share** (Census B25003) — 20 pts. Linear from 20% (0 pts) to 60% (full 20 pts).
- **Median gross rent** (B25064) — 12 pts. Linear from $700 (0 pts) to $2,000 (full 12 pts). Higher rent = higher ARPU per unit.
- **5-yr population growth** — 8 pts. Linear from −2% (0 pts) to +10% (full 8 pts).

### Property fit — 30 pts

Walkable urban properties are the segment where AI leasing assistants generate the most lift.

- **Walkability / access** — 22 pts. WalkScore takes priority when available (linear from 30 → 90). When WalkScore is missing (e.g., still pending key approval), we fall back to a Geoapify-derived access score (linear from 25 → 85). The Geoapify score is the weighted sum of nearby POI counts within ~15-min walk: transit (25), grocery (20), dining (20), parks (10), fitness (10), healthcare (10), education (5).
- **Priority state bonus** — 8 pts (full or 0). NY, TX, FL, CA, IL, GA, MA, WA, CO, DC, NJ, PA, AZ, NC, VA. Override via `ELISE_PRIORITY_STATES` env var.

### Company momentum — 30 pts

Companies that are expanding / raising / acquiring are simultaneously seeing higher leasing volume AND have budget for tooling.

- **News volume** (recent lookback window) — 18 pts. Linear from 0 articles (0 pts) to 4+ articles (full 18 pts). Default lookback is 30 days via `NEWS_LOOKBACK_DAYS` (max 90).
- **Momentum keywords** — 12 pts. All-or-nothing. Triggers if any matched keyword appears in titles/descriptions: `expansion, expanding, acquired, acquisition, raised, funding, series a/b/c, ipo, launch, new community, new property, new development, opens, hiring, growth, partnership`, etc.

### Data quality — surfaced as flags, not score

Inbound leads have already raised their hand — penalizing them for intake/enrichment gaps measures *our* pipeline hygiene, not their fit. Instead, `buildQualityFlags()` in `lib/scoring.ts` returns non-scoring badges that render on the lead card so the SDR can verify before outreach:

- Personal email domain (gmail/yahoo/outlook/etc.) → "verify decision-maker"
- Email domain doesn't match company → "confirm affiliation"
- Geocoding failed / Census missing / no walkability data / no news data → infra-side warnings

These never affect the tier.

### Things we **deliberately did not** include (and why)

- **LinkedIn scraping / paid intent providers** — out of scope for "free public APIs" and against ToS.
- **Property unit count** — not reliably available from free APIs at the address level. A real production version would join HUD or RentCafe data.
- **OpenWeather** — initial design included it for an icebreaker, but it adds noise to scoring without a clear ROI signal. We dropped it to keep the rubric defensible.

### Tuning the rubric

All scoring is in `lib/scoring.ts`. To change a weight, edit the `WEIGHTS` constant at the top. To change a threshold, edit the `lerpScore` calls. To run an A/B in production, deploy two routes pointing at different weight constants and compare downstream win-rates.

## Deployment

```bash 
# one-time
npm i -g vercel
vercel link
vercel env add OPENAI_API_KEY       # preferred email drafting provider
vercel env add OPENAI_MODEL         # optional; defaults to gpt-4o-mini
vercel env add ANTHROPIC_API_KEY    # optional fallback email provider
vercel env add WALKSCORE_API_KEY
vercel env add GEOAPIFY_API_KEY      # falls back to Geoapify if WalkScore is missing
vercel env add NEWS_API_KEY
vercel env add NEWS_LOOKBACK_DAYS    # use 30 for NewsAPI free tier
vercel env add DEMO_ADMIN_EMAIL      # gated deploy: admin username
vercel env add DEMO_ADMIN_PASSWORD   # gated deploy: admin password
vercel env add DEMO_SESSION_SECRET   # openssl rand -hex 32
vercel env add CENSUS_API_KEY        # optional
vercel env add ELISE_PRIORITY_STATES # optional override

# deploy
vercel --prod
```

## Authentication (optional)

When `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD`, and `DEMO_SESSION_SECRET` are set:

- The app requires login at `/login`.
- The session is stored in an HTTP-only, signed cookie (HMAC SHA-256).
- `/api/enrich` is protected by the same session check.

## Caveats / known limitations

- **NewsAPI free tier** only allows queries from a developer environment — for production you'd need a paid plan or a swap to a different news source (Bing News, GDELT).
- **Census tract codes change** between decennial census decades. The 5-year population growth lookup compares the latest available ACS5 vintage against the ACS5 release five years prior using the *same tract code*; if boundaries were redrawn, it falls back to county-level growth or skips the signal when that also fails.
- **Concurrency is capped at 3** in `enrichLeads()` to stay under the Census Geocoder's rate limits. For very large batches, move the trigger behind a queue or CRM workflow instead of running everything in one UI request.
- **Vercel function max duration** still matters for large batches; keep UI-triggered batches small or move long-running enrichment to a queue.

## License

MIT
