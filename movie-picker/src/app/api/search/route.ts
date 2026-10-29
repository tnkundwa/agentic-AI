import { NextResponse } from "next/server";
import { searchMovies } from "@/lib/tmdb";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json([]);
  try {
    return NextResponse.json(await searchMovies(q));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
