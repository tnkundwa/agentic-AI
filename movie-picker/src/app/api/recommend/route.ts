import { NextResponse } from "next/server";
import { recommend, type Kind } from "@/lib/recommend";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const b = (await req.json()) as {
    moods?: string[];
    maxRuntime?: number | null;
    kind?: Kind;
  };
  try {
    const picks = await recommend({
      moods: b.moods ?? [],
      maxRuntime: b.maxRuntime ?? null,
      kind: b.kind ?? "any",
    });
    return NextResponse.json(picks);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
