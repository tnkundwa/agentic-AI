import { NextResponse } from "next/server";
import { answerFollowup, getItem } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { answer } = (await req.json()) as { answer?: string };
  const n = Number(id);
  if (!answer?.trim() || !getItem(n))
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  answerFollowup(n, answer.trim());
  return NextResponse.json(getItem(n));
}
