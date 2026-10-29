import { NextResponse } from "next/server";
import { listEntries, upsertEntry, type Verdict } from "@/lib/db";
import { details } from "@/lib/tmdb";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(listEntries());
}

export async function POST(req: Request) {
  const { tmdb_id, verdict } = (await req.json()) as {
    tmdb_id?: number;
    verdict?: Verdict;
  };
  if (!tmdb_id || !verdict)
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  try {
    const d = await details(tmdb_id);
    return NextResponse.json(upsertEntry({ ...d, verdict, suggested: false }), {
      status: 201,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
