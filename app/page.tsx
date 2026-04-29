"use client";

import { useState } from "react";
import { LeadInput } from "@/components/LeadInput";
import { LeadCard } from "@/components/LeadCard";
import { ResultsTable } from "@/components/ResultsTable";
import { enrichedLeadsToCsv } from "@/lib/csv";
import { exportEnrichedLeadsToExcel } from "@/lib/excel";
import type { EnrichedLead, Lead } from "@/lib/types";

export default function Page() {
  const [results, setResults] = useState<EnrichedLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const onSubmit = async (leads: Lead[]) => {
    setLoading(true);
    setError(null);
    setResults([]);
    setProgress(`Enriching ${leads.length} ${leads.length === 1 ? "lead" : "leads"}...`);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leads }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      const enriched = (data.leads ?? []) as EnrichedLead[];
      enriched.sort((a, b) => b.score.total - a.score.total);
      setResults(enriched);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const exportCsv = () => {
    const csv = enrichedLeadsToCsv(results);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `enriched_leads_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportExcel = () => {
    exportEnrichedLeadsToExcel(results);
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <main className="min-h-screen">
      <div className="max-w-5xl mx-auto px-4 py-10 space-y-6">
        <header className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="pill bg-brand-100 text-brand-700">EliseAI</span>
              <span className="pill bg-slate-100 text-slate-600">
                GTM Lead Enrichment
              </span>
            </div>
            <button type="button" className="btn-secondary text-xs" onClick={logout}>
              Log out
            </button>
          </div>
          <h1 className="text-3xl font-bold text-slate-900">
            Inbound lead enrichment, scoring &amp; outreach
          </h1>
          <p className="text-slate-600 max-w-3xl">
            Paste an inbound lead list. The tool enriches each lead with U.S.
            Census demographics, Geoapify, recent company news, and Wikipedia
            context, then drafts a personalized first-touch email with GPT.
          </p>
        </header>

        <LeadInput onSubmit={onSubmit} loading={loading} />

        {progress && (
          <div className="text-sm text-slate-600 italic">{progress}</div>
        )}

        {error && (
          <div className="card p-4 border-red-200 bg-red-50 text-red-700 text-sm">
            {error}
          </div>
        )}

        {results.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-slate-900">
                Results
              </h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={exportCsv}
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={exportExcel}
                >
                  Export Excel
                </button>
              </div>
            </div>
            <ResultsTable leads={results} />
            <div className="grid grid-cols-1 gap-4">
              {results.map((r, i) => (
                <LeadCard key={i} enriched={r} />
              ))}
            </div>
          </>
        )}

        <footer className="text-xs text-slate-400 pt-8 border-t border-slate-200">
          Public APIs used: U.S. Census Geocoder + ACS (tract-level neighborhood
          proxy), WalkScore, NewsAPI, Wikipedia. Census ACS was chosen as the best
          free, nationwide source for consistent market-level rental signals.
          Email drafted by GPT or Claude. Scoring weights tunable in{" "}
          <code className="text-[11px]">lib/scoring.ts</code>.
        </footer>
      </div>
    </main>
  );
}
