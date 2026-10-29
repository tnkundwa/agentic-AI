import { NextResponse } from "next/server";
import { deleteEntry, updateEntry, type Verdict } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json()) as {
    verdict?: Verdict;
    reasons?: string[];
    note?: string;
  };
  const e = updateEntry(Number(id), body);
  return e
    ? NextResponse.json(e)
    : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  deleteEntry(Number((await params).id));
  return NextResponse.json({ ok: true });
}
