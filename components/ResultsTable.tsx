"use client";

import type { EnrichedLead } from "@/lib/types";

const tierClass: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-800",
  B: "bg-amber-100 text-amber-800",
  C: "bg-slate-100 text-slate-700",
};

export function ResultsTable({ leads }: { leads: EnrichedLead[] }) {
  if (leads.length === 0) return null;
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">
          Summary ({leads.length} {leads.length === 1 ? "lead" : "leads"})
        </h2>
        <div className="text-xs text-slate-500">
          A: {leads.filter((l) => l.score.tier === "A").length} &middot; B:{" "}
          {leads.filter((l) => l.score.tier === "B").length} &middot; C:{" "}
          {leads.filter((l) => l.score.tier === "C").length}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">Tier</th>
              <th className="px-4 py-2 text-left">Score</th>
              <th className="px-4 py-2 text-left">Company</th>
              <th className="px-4 py-2 text-left">Contact</th>
              <th className="px-4 py-2 text-left">Email</th>
              <th className="px-4 py-2 text-left">Location</th>
              <th className="px-4 py-2 text-right">Renter %</th>
              <th className="px-4 py-2 text-right">Walk</th>
              <th className="px-4 py-2 text-right">News</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {leads.map((l, i) => (
              <tr key={i} className="hover:bg-slate-50">
                <td className="px-4 py-2">
                  <span
                    className={`pill ${tierClass[l.score.tier] ?? ""}`}
                  >
                    {l.score.tier}
                  </span>
                </td>
                <td className="px-4 py-2 font-semibold">{l.score.total}</td>
                <td className="px-4 py-2">{l.lead.company}</td>
                <td className="px-4 py-2 text-slate-600">
                  {l.lead.name}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  <a
                    href={`mailto:${l.lead.email}`}
                    className="text-brand-700 hover:underline break-all"
                  >
                    {l.lead.email}
                  </a>
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {l.lead.city}, {l.lead.state}
                </td>
                <td className="px-4 py-2 text-right">
                  {l.enrichment.census?.renterSharePct !== null &&
                  l.enrichment.census?.renterSharePct !== undefined
                    ? `${l.enrichment.census.renterSharePct.toFixed(0)}%`
                    : "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  {l.enrichment.walkScore?.walkScore ?? "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  {l.enrichment.news?.articleCount ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
