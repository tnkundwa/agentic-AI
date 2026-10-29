import { NextResponse } from "next/server";
import { searchItems } from "@/lib/db";
import { embed } from "@/lib/llm";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json([]);
  return NextResponse.json(searchItems(q, await embed(q)));
}
