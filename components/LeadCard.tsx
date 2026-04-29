"use client";

import { useState } from "react";
import type { DraftEmail, EnrichedLead, Tier } from "@/lib/types";

const TIER_STYLES: Record<Tier, string> = {
  A: "bg-emerald-100 text-emerald-800 border-emerald-200",
  B: "bg-amber-100 text-amber-800 border-amber-200",
  C: "bg-slate-100 text-slate-700 border-slate-200",
};

const TIER_RING: Record<Tier, string> = {
  A: "ring-emerald-300",
  B: "ring-amber-300",
  C: "ring-slate-200",
};

const fmtCurrency = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `$${n.toLocaleString()}`;

const fmtPct = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined ? "—" : `${n.toFixed(digits)}%`;

const fmtNum = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString();

const fmtDate = (value: string | null | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Browser extensions/devtools can make the document temporarily unfocused.
      // Fall through to the textarea-based copy path.
    }
  }

  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);

  const selection = document.getSelection();
  const previousRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  textarea.focus({ preventScroll: true });
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(textarea);
    if (selection && previousRange) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }
  }

  return copied;
};

type Props = {
  enriched: EnrichedLead;
};

export function LeadCard({ enriched }: Props) {
  const { lead, score, enrichment, insights, qualityFlags, email } = enriched;
  const c = enrichment.census;
  const w = enrichment.walkScore;
  const g = enrichment.geoapify;
  const n = enrichment.news;

  const accessLabel = w?.walkScore !== undefined && w?.walkScore !== null
    ? "WalkScore"
    : "Access";
  const accessValue =
    w?.walkScore !== undefined && w?.walkScore !== null
      ? fmtNum(w.walkScore)
      : g
      ? `${g.accessScore}/100`
      : "—";
  const transitValue =
    w?.transitScore !== undefined && w?.transitScore !== null
      ? fmtNum(w.transitScore)
      : g
      ? `${g.counts.transit} stops`
      : "—";
  const noUsableNews = n?.status === "empty" || n?.articleCount === 0;

  return (
    <div
      className={`card ring-2 ring-offset-2 ${TIER_RING[score.tier]} overflow-hidden`}
    >
      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-slate-900">
                {lead.company}
              </h3>
              <span
                className={`pill border ${TIER_STYLES[score.tier]}`}
                title="Lead tier"
              >
                Tier {score.tier}
              </span>
            </div>
            <div className="text-sm text-slate-600">
              {lead.name} &middot; {lead.email}
            </div>
            <div className="text-xs text-slate-500">
              {lead.property_address}, {lead.city}, {lead.state}
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-slate-900 leading-none">
              {score.total}
            </div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              / 100
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-xs">
          <ScoreBar
            label="Market"
            value={score.breakdown.marketFit}
            max={40}
          />
          <ScoreBar
            label="Property"
            value={score.breakdown.propertyFit}
            max={30}
          />
          <ScoreBar
            label="Momentum"
            value={score.breakdown.companyMomentum}
            max={30}
          />
        </div>

        {score.reasons.length > 0 && (
          <details className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
            <summary className="cursor-pointer font-semibold text-slate-700">
              Why this score?
            </summary>
            <ul className="mt-2 list-disc list-inside space-y-1">
              {score.reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          </details>
        )}

        {qualityFlags && qualityFlags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {qualityFlags.map((flag, i) => (
              <span
                key={i}
                className={`pill border text-[11px] ${
                  flag.severity === "warn"
                    ? "bg-amber-50 text-amber-800 border-amber-200"
                    : "bg-slate-50 text-slate-600 border-slate-200"
                }`}
                title="Data-quality flag — does not affect score"
              >
                {flag.message}
              </span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg bg-slate-50 p-3 text-xs">
          <Metric label="Tract renter share" value={fmtPct(c?.renterSharePct, 0)} />
          <Metric
            label="Tract median gross rent"
            value={fmtCurrency(c?.medianGrossRent)}
          />
          <Metric
            label="Tract pop. growth (5y)"
            value={fmtPct(c?.populationGrowth5yrPct)}
          />
          <Metric
            label="Tract median income"
            value={fmtCurrency(c?.medianHouseholdIncome)}
          />
          <Metric label={accessLabel} value={accessValue} />
          <Metric label="Transit" value={transitValue} />
          <Metric label="News" value={fmtNum(n?.articleCount)} />
          <Metric
            label="Tract population"
            value={fmtNum(c?.population)}
          />
        </div>
        <div className="text-[11px] text-slate-500">
          Census metrics are ACS 5-year values at the census-tract level (a
          neighborhood proxy), not property-level asking rents.
        </div>

        {insights.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
              Sales insights
            </div>
            <ul className="list-disc list-inside text-sm text-slate-700 space-y-1">
              {insights.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}

        <DraftEmailEditor
          key={`${enriched.enrichedAt}-${lead.email}-${lead.company}`}
          email={email}
        />

        {n && n.topArticles.length > 0 && (
          <details className="text-xs text-slate-600">
            <summary className="cursor-pointer text-slate-500 hover:text-slate-700">
              Top news ({n.topArticles.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {n.topArticles.slice(0, 3).map((a, i) => (
                <li key={i}>
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-700 hover:underline"
                  >
                    {a.title}
                  </a>{" "}
                  <span className="text-slate-400">
                    — {[a.source, fmtDate(a.publishedAt)].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {noUsableNews && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            No recent usable news
            {n?.rawArticleCount
              ? ` — ${n.rawArticleCount} raw NewsAPI ${
                  n.rawArticleCount === 1 ? "match was" : "matches were"
                } filtered for relevance or link quality.`
              : "."}
          </div>
        )}

        {Object.keys(enrichment.errors).length > 0 && (
          <details className="text-xs text-amber-700">
            <summary className="cursor-pointer">
              Enrichment warnings ({Object.keys(enrichment.errors).length})
            </summary>
            <ul className="mt-2 space-y-1">
              {Object.entries(enrichment.errors).map(([k, v]) => (
                <li key={k}>
                  <span className="font-medium">{k}:</span> {v}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

function ScoreBar({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div>
      <div className="flex justify-between text-slate-500">
        <span>{label}</span>
        <span>
          {value}/{max}
        </span>
      </div>
      <div className="h-1.5 mt-1 rounded-full bg-slate-200 overflow-hidden">
        <div
          className="h-full bg-brand-500 rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function DraftEmailEditor({ email }: { email: DraftEmail }) {
  const [open, setOpen] = useState(true);
  const [draftSubject, setDraftSubject] = useState(email.subject);
  const [draftBody, setDraftBody] = useState(email.body);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const didCopy = await copyTextToClipboard(
      `Subject: ${draftSubject}\n\n${draftBody}`
    );
    if (didCopy) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Draft email
          <span className="ml-2 normal-case font-normal text-slate-400">
            ({email.source})
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={`rounded-full px-2 py-1 text-xs transition-all duration-200 ${
              copied
                ? "bg-emerald-100 text-emerald-800 animate-pulse"
                : "text-brand-700 hover:bg-white hover:underline"
            }`}
            onClick={copy}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            type="button"
            className="text-xs text-slate-500 hover:underline"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide" : "Show"}
          </button>
        </div>
      </div>
      {open && (
        <div className="p-3 space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Subject
            <input
              value={draftSubject}
              onChange={(e) => setDraftSubject(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Body
            <textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              rows={8}
              className="mt-1 w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-800 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
          </label>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="text-sm font-medium text-slate-900">{value}</div>
    </div>
  );
}
