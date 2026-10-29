import { NextResponse } from "next/server";
import { searchItems } from "@/lib/db";
import { chatAnswer, embed } from "@/lib/llm";

export const runtime = "nodejs";

type Msg = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  const { messages } = (await req.json()) as { messages?: Msg[] };
  if (!messages?.length)
    return NextResponse.json({ error: "empty" }, { status: 400 });

  const query = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ");
  const hits = searchItems(query, await embed(query), 8);
  const candidates = hits
    .map(
      (h) =>
        `#${h.id} [${h.created_at}] (${h.type ?? "?"}) ${h.content}` +
        (h.summary ? `\n  summary: ${h.summary}` : "") +
        (h.context ? `\n  context: ${h.context.replace(/\n/g, " ")}` : ""),
    )
    .join("\n");

  try {
    const reply = await chatAnswer(messages, candidates);
    return NextResponse.json({ reply, hits });
  } catch (e) {
    console.error("chat failed", e);
    return NextResponse.json(
      { reply: "The LLM call failed. Check the gateway settings.", hits },
      { status: 502 },
    );
  }
}
