import OpenAI from "openai";

let client: OpenAI | null = null;

function llm(): OpenAI | null {
  if (!process.env.LITELLM_API_KEY) return null;
  client ??= new OpenAI({
    apiKey: process.env.LITELLM_API_KEY,
    baseURL: `${(process.env.LITELLM_BASE_URL ?? "").replace(/\/$/, "")}/v1`,
  });
  return client;
}

const CHAT_MODEL = () => process.env.CHAT_MODEL ?? "claude-sonnet-5-5";
const EMBED_MODEL = () => process.env.EMBED_MODEL ?? "text-embedding-3-small";

export async function embed(text: string): Promise<number[] | null> {
  const c = llm();
  if (!c) return null;
  try {
    const r = await c.embeddings.create({
      model: EMBED_MODEL(),
      input: text.slice(0, 6000),
    });
    return r.data[0].embedding;
  } catch (e) {
    console.error("embed failed", e);
    return null;
  }
}

export type Enrichment = {
  type: string;
  tags: string[];
  summary: string;
  followup: string | null;
};

export async function enrich(
  content: string,
  recent: string,
): Promise<Enrichment | null> {
  const c = llm();
  if (!c) return null;
  try {
    const r = await c.chat.completions.create({
      model: CHAT_MODEL(),
      messages: [
        {
          role: "system",
          content:
            "You file entries in a personal second-brain. Reply with JSON only: " +
            '{"type": one of note|link|idea|todo|quote|reference|other, "tags": 2-5 short lowercase tags, ' +
            '"summary": one sentence a future reader will understand without context, ' +
            '"followup": one short question that would make this entry clearer later, or null if it is already clear}. ' +
            "Use the recent entries only to resolve ambiguity.",
        },
        {
          role: "user",
          content: `Recent entries:\n${recent || "(none)"}\n\nNew entry:\n${content}`,
        },
      ],
    });
    const raw = r.choices[0].message.content ?? "";
    const json = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return null;
    const p = JSON.parse(json) as Partial<Enrichment>;
    return {
      type: p.type ?? "note",
      tags: Array.isArray(p.tags) ? p.tags.map(String).slice(0, 6) : [],
      summary: p.summary ?? "",
      followup: p.followup || null,
    };
  } catch (e) {
    console.error("enrich failed", e);
    return null;
  }
}

export async function chatAnswer(
  messages: { role: "user" | "assistant"; content: string }[],
  candidates: string,
): Promise<string> {
  const c = llm();
  if (!c)
    return "The LLM is not configured. Set LITELLM_API_KEY in .env.local to enable chat.";
  const r = await c.chat.completions.create({
    model: CHAT_MODEL(),
    messages: [
      {
        role: "system",
        content:
          "You help the user find something they saved in their personal second-brain but only vaguely remember. " +
          "Use ONLY the candidate entries below. Name the most likely entry (quote its id as #id), explain why, " +
          "and if unsure, ask one short question that would narrow it down. Say so if nothing matches.\n\n" +
          `Candidates:\n${candidates || "(none found)"}`,
      },
      ...messages,
    ],
  });
  return r.choices[0].message.content ?? "";
}
