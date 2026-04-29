"use client";

import { useMemo, useRef, useState } from "react";
import type { Lead } from "@/lib/types";
import { parseLeadsCsv } from "@/lib/csv";

type Props = {
  onSubmit: (leads: Lead[]) => void;
  loading: boolean;
};

const SAMPLE_TEXT = `name,email,company,property_address,city,state,country
Jamie Reyes,jamie@equityresidential.com,Equity Residential,170 Amsterdam Ave,New York,NY,US
Priya Patel,priya@morganproperties.com,Morgan Properties,600 Red Lion Rd,Philadelphia,PA,US
Marcus Lee,marcus@greystar.com,Greystar,1700 California St,San Francisco,CA,US`;

const EMPTY_LEAD: Lead = {
  name: "",
  email: "",
  company: "",
  property_address: "",
  city: "",
  state: "",
  country: "US",
};

const REQUIRED_FIELDS: Array<keyof Lead> = [
  "name",
  "email",
  "company",
  "property_address",
  "city",
  "state",
];

export function LeadInput({ onSubmit, loading }: Props) {
  const [lead, setLead] = useState<Lead>(EMPTY_LEAD);
  const [bulkText, setBulkText] = useState<string>(SAMPLE_TEXT);
  const [formError, setFormError] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsedBulkLeads = useMemo(() => {
    try {
      return parseLeadsCsv(bulkText);
    } catch {
      return [];
    }
  }, [bulkText]);

  const setField = (field: keyof Lead, value: string) => {
    setLead((current) => ({ ...current, [field]: value }));
  };

  const handleSingleSubmit = () => {
    setFormError(null);
    const normalized: Lead = {
      ...lead,
      name: lead.name.trim(),
      email: lead.email.trim(),
      company: lead.company.trim(),
      property_address: lead.property_address.trim(),
      city: lead.city.trim(),
      state: lead.state.trim().toUpperCase(),
      country: lead.country.trim() || "US",
    };

    const missing = REQUIRED_FIELDS.filter((field) => !normalized[field]);
    if (missing.length > 0) {
      setFormError("Fill in name, email, company, property address, city, and state.");
      return;
    }

    onSubmit([normalized]);
  };

  const handleBulkSubmit = () => {
    setBulkError(null);
    if (parsedBulkLeads.length === 0) {
      setBulkError("No valid leads parsed. Check the CSV header row.");
      return;
    }
    onSubmit(parsedBulkLeads);
  };

  const handleFile = async (file: File) => {
    const t = await file.text();
    setBulkText(t);
    setBulkError(null);
  };

  const loadSampleFromFile = async () => {
    try {
      const res = await fetch("/api/sample");
      if (!res.ok) throw new Error("Sample fetch failed");
      const csv = await res.text();
      setBulkText(csv);
    } catch {
      setBulkText(SAMPLE_TEXT);
    }
    setBulkError(null);
  };

  return (
    <div className="card p-5 space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Add leads</h2>
          <p className="text-sm text-slate-500">
            Start with one lead, or use bulk import when you have a CSV from a
            form, CRM export, or spreadsheet.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Single lead</h3>
          <p className="text-xs text-slate-500">
            Best for quick qualification while talking to a prospect or testing
            one account.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field
            label="Name"
            value={lead.name}
            onChange={(value) => setField("name", value)}
            placeholder="Jamie Reyes"
            disabled={loading}
            required
          />
          <Field
            label="Email"
            value={lead.email}
            onChange={(value) => setField("email", value)}
            placeholder="jamie@equityresidential.com"
            disabled={loading}
            required
          />
          <Field
            label="Company"
            value={lead.company}
            onChange={(value) => setField("company", value)}
            placeholder="Equity Residential"
            disabled={loading}
            required
          />
          <Field
            label="Property address"
            value={lead.property_address}
            onChange={(value) => setField("property_address", value)}
            placeholder="170 Amsterdam Ave"
            disabled={loading}
            required
          />
          <Field
            label="City"
            value={lead.city}
            onChange={(value) => setField("city", value)}
            placeholder="New York"
            disabled={loading}
            required
          />
          <Field
            label="State"
            value={lead.state}
            onChange={(value) => setField("state", value)}
            placeholder="NY"
            disabled={loading}
            required
          />
        </div>

        {formError && <div className="text-sm text-red-600">{formError}</div>}

        <div className="flex justify-end">
          <button
            type="button"
            className="btn-primary"
            onClick={handleSingleSubmit}
            disabled={loading}
          >
            {loading ? "Enriching..." : "Enrich this lead"}
          </button>
        </div>
      </div>

      <details className="rounded-xl border border-slate-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">
          Bulk import CSV
          <span className="ml-2 font-normal text-slate-500">
            ({parsedBulkLeads.length} parsed)
          </span>
        </summary>

        <div className="border-t border-slate-200 p-4 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm text-slate-500">
              Use a header row so the app can map each column correctly. Required:
              name, email, company, property_address, city, state.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={loadSampleFromFile}
                disabled={loading}
              >
                Load full sample
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => fileRef.current?.click()}
                disabled={loading}
              >
                Upload CSV
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>
          </div>

          <textarea
            className="w-full h-44 font-mono text-xs rounded-lg border border-slate-300 p-3 focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={bulkText}
            onChange={(e) => {
              setBulkText(e.target.value);
              setBulkError(null);
            }}
            spellCheck={false}
            disabled={loading}
          />

          {bulkError && <div className="text-sm text-red-600">{bulkError}</div>}

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs text-slate-500">
              {parsedBulkLeads.length > 0
                ? `${parsedBulkLeads.length} ${
                    parsedBulkLeads.length === 1 ? "lead" : "leads"
                  } ready to enrich.`
                : "No leads parsed yet."}
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={handleBulkSubmit}
              disabled={loading || parsedBulkLeads.length === 0}
            >
              {loading ? "Enriching..." : "Enrich CSV leads"}
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled: boolean;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      <input
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-100"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </label>
  );
}
