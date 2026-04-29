import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

export async function GET() {
  try {
    const p = path.join(
      /* turbopackIgnore: true */ process.cwd(),
      "data",
      "sample_leads.csv"
    );
    const text = await fs.readFile(p, "utf8");
    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "text/csv; charset=utf-8" },
    });
  } catch {
    return NextResponse.json(
      { error: "Sample file not found" },
      { status: 404 }
    );
  }
}
