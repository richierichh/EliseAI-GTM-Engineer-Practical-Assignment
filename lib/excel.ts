import type { EnrichedLead } from "./types";

type Cell = string | number | null | undefined;
type Row = Record<string, Cell>;

const blank = (value: Cell): string | number | null => value ?? null;

const joined = (items: string[] | undefined): string =>
  items && items.length > 0 ? items.join(" | ") : "";

const escapeXml = (value: Cell): string =>
  value === null || value === undefined
    ? ""
    : String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

const dataType = (value: Cell): "Number" | "String" =>
  typeof value === "number" && Number.isFinite(value) ? "Number" : "String";

const columnWidths = (rows: Row[]): number[] => {
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  return headers.map((header) => {
    const maxChars = rows.reduce((max, row) => {
      const value = row[header];
      return Math.max(max, value === null || value === undefined ? 0 : String(value).length);
    }, header.length);
    return Math.min(Math.max(maxChars * 7, 80), 360);
  });
};

const worksheetXml = (name: string, rows: Row[]): string => {
  const safeRows = rows.length > 0 ? rows : [{ Note: "No records" }];
  const headers = Object.keys(safeRows[0]);
  const widths = columnWidths(safeRows);

  const columns = widths
    .map((width) => `<Column ss:AutoFitWidth="0" ss:Width="${width}"/>`)
    .join("");

  const headerRow = `<Row ss:StyleID="Header">${headers
    .map((header) => `<Cell><Data ss:Type="String">${escapeXml(header)}</Data></Cell>`)
    .join("")}</Row>`;

  const bodyRows = safeRows
    .map(
      (row) =>
        `<Row>${headers
          .map((header) => {
            const value = row[header];
            return `<Cell><Data ss:Type="${dataType(value)}">${escapeXml(value)}</Data></Cell>`;
          })
          .join("")}</Row>`
    )
    .join("");

  return `<Worksheet ss:Name="${escapeXml(name)}"><Table>${columns}${headerRow}${bodyRows}</Table></Worksheet>`;
};

const download = (filename: string, content: string) => {
  const blob = new Blob([content], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export function exportEnrichedLeadsToExcel(leads: EnrichedLead[]): void {
  const generatedAt = new Date().toISOString();

  const overview: Row[] = [
    { Metric: "Generated at", Value: generatedAt },
    { Metric: "Total leads", Value: leads.length },
    { Metric: "Tier A leads", Value: leads.filter((l) => l.score.tier === "A").length },
    { Metric: "Tier B leads", Value: leads.filter((l) => l.score.tier === "B").length },
    { Metric: "Tier C leads", Value: leads.filter((l) => l.score.tier === "C").length },
  ];

  const summary: Row[] = leads.map((lead, index) => {
    const c = lead.enrichment.census;
    const w = lead.enrichment.walkScore;
    const g = lead.enrichment.geoapify;
    const n = lead.enrichment.news;
    return {
      Rank: index + 1,
      Tier: lead.score.tier,
      Score: lead.score.total,
      Company: lead.lead.company,
      Contact: lead.lead.name,
      Email: lead.lead.email,
      Location: `${lead.lead.city}, ${lead.lead.state}`,
      "Property address": lead.lead.property_address,
      "Market fit": lead.score.breakdown.marketFit,
      "Property fit": lead.score.breakdown.propertyFit,
      "Company momentum": lead.score.breakdown.companyMomentum,
      "Renter share %": blank(c?.renterSharePct),
      "Median rent": blank(c?.medianGrossRent),
      WalkScore: blank(w?.walkScore),
      "Access score": blank(g?.accessScore),
      "News count": blank(n?.articleCount),
      "Email subject": lead.email.subject,
    };
  });

  const enrichmentDetails: Row[] = leads.map((lead) => {
    const c = lead.enrichment.census;
    const w = lead.enrichment.walkScore;
    const g = lead.enrichment.geoapify;
    const geo = lead.enrichment.geocode;
    const wiki = lead.enrichment.wikipedia;
    return {
      Company: lead.lead.company,
      Contact: lead.lead.name,
      "Matched address": blank(geo?.matchedAddress),
      Latitude: blank(geo?.latitude),
      Longitude: blank(geo?.longitude),
      "State FIPS": blank(geo?.stateFips),
      "County FIPS": blank(geo?.countyFips),
      "Tract FIPS": blank(geo?.tractFips),
      Population: blank(c?.population),
      "Median household income": blank(c?.medianHouseholdIncome),
      "Median gross rent": blank(c?.medianGrossRent),
      "Renter share %": blank(c?.renterSharePct),
      "Population growth 5yr %": blank(c?.populationGrowth5yrPct),
      "Census geography": blank(c?.geographyLabel),
      WalkScore: blank(w?.walkScore),
      "Walk description": blank(w?.walkDescription),
      "Transit score": blank(w?.transitScore),
      "Bike score": blank(w?.bikeScore),
      "Geoapify access score": blank(g?.accessScore),
      "Transit POIs": blank(g?.counts.transit),
      "Grocery POIs": blank(g?.counts.grocery),
      "Dining POIs": blank(g?.counts.dining),
      "Parks POIs": blank(g?.counts.parks),
      "Fitness POIs": blank(g?.counts.fitness),
      "Healthcare POIs": blank(g?.counts.healthcare),
      "Education POIs": blank(g?.counts.education),
      "Wikipedia source": blank(wiki?.source),
      "Wikipedia title": blank(wiki?.title),
      "Wikipedia URL": blank(wiki?.url),
    };
  });

  const scoreReasons: Row[] = leads.flatMap((lead) =>
    lead.score.reasons.map((reason, index) => ({
      Company: lead.lead.company,
      Contact: lead.lead.name,
      Tier: lead.score.tier,
      Score: lead.score.total,
      Order: index + 1,
      Reason: reason,
    }))
  );

  const insights: Row[] = leads.flatMap((lead) =>
    lead.insights.map((insight, index) => ({
      Company: lead.lead.company,
      Contact: lead.lead.name,
      Tier: lead.score.tier,
      Order: index + 1,
      Insight: insight,
    }))
  );

  const qualityFlags: Row[] = leads.flatMap((lead) =>
    lead.qualityFlags.map((flag) => ({
      Company: lead.lead.company,
      Contact: lead.lead.name,
      Severity: flag.severity,
      Flag: flag.message,
    }))
  );

  const news: Row[] = leads.flatMap((lead) =>
    (lead.enrichment.news?.topArticles ?? []).map((article, index) => ({
      Company: lead.lead.company,
      Contact: lead.lead.name,
      Order: index + 1,
      Title: article.title,
      Source: article.source,
      "Published at": article.publishedAt,
      URL: article.url,
      Description: blank(article.description),
      "Momentum keywords": joined(lead.enrichment.news?.matchedKeywords),
    }))
  );

  const outreach: Row[] = leads.map((lead) => ({
    Company: lead.lead.company,
    Contact: lead.lead.name,
    Email: lead.lead.email,
    Tier: lead.score.tier,
    Score: lead.score.total,
    "Draft source": lead.email.source,
    Subject: lead.email.subject,
    Body: lead.email.body,
  }));

  const warnings: Row[] = leads.flatMap((lead) =>
    Object.entries(lead.enrichment.errors).map(([source, message]) => ({
      Company: lead.lead.company,
      Contact: lead.lead.name,
      Source: source,
      Warning: message,
    }))
  );

  const sheets = [
    worksheetXml("Overview", overview),
    worksheetXml("Lead Summary", summary),
    worksheetXml("Enrichment Details", enrichmentDetails),
    worksheetXml("Score Reasons", scoreReasons),
    worksheetXml("Sales Insights", insights),
    worksheetXml("Quality Flags", qualityFlags),
    worksheetXml("News", news),
    worksheetXml("Draft Outreach", outreach),
    worksheetXml("Warnings", warnings),
  ].join("");

  const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Title>Enriched EliseAI Leads</Title>
  <Subject>Lead enrichment, scoring, and outreach workbook</Subject>
  <Author>EliseAI GTM Lead Enrichment</Author>
  <Created>${generatedAt}</Created>
 </DocumentProperties>
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Top" ss:WrapText="1"/>
   <Font ss:FontName="Arial" ss:Size="10"/>
  </Style>
  <Style ss:ID="Header">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Arial" ss:Size="10" ss:Bold="1"/>
   <Interior ss:Color="#EEE7FF" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 ${sheets}
</Workbook>`;

  download(
    `enriched_leads_${new Date().toISOString().slice(0, 10)}.xls`,
    workbook
  );
}
