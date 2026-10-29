import { NextResponse } from "next/server";
import {
  enrichItem,
  getItem,
  insertItem,
  listItems,
  recentContext,
  setEmbedding,
} from "@/lib/db";
import { embed, enrich } from "@/lib/llm";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(listItems());
}

export async function POST(req: Request) {
  const { content } = (await req.json()) as { content?: string };
  const text = content?.trim();
  if (!text) return NextResponse.json({ error: "empty" }, { status: 400 });

  const recent = recentContext();
  const id = insertItem(text, `Saved at ${new Date().toISOString()}`);

  const [meta, vec] = await Promise.all([enrich(text, recent), embed(text)]);
  if (meta) enrichItem(id, meta, vec);
  else if (vec) setEmbedding(id, vec);

  return NextResponse.json(getItem(id), { status: 201 });
}
