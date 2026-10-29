import OpenAI from "openai";
import {
  GENRE,
  discover,
  details,
  recommendations,
  standupKeywordId,
  type Basic,
  type Detail,
} from "./tmdb";
import { listEntries, upsertEntry, type Entry } from "./db";

export type Kind = "any" | "movie" | "documentary" | "standup";
export type Options = { moods: string[]; maxRuntime: number | null; kind: Kind };

const MOOD_GENRES: Record<string, number[]> = {
  funny: [GENRE.comedy],
  light: [GENRE.comedy, GENRE.family, GENRE.romance],
  thrilling: [GENRE.thriller, GENRE.action],
  thoughtful: [GENRE.drama, GENRE.documentary],
  scary: [GENRE.horror],
  "mind-bending": [GENRE.scifi, GENRE.mystery],
  cozy: [GENRE.romance, GENRE.family, GENRE.comedy],
};
export const MOODS = Object.keys(MOOD_GENRES);

function llm(): OpenAI | null {
  if (!process.env.LITELLM_API_KEY) return null;
  return new OpenAI({
    apiKey: process.env.LITELLM_API_KEY,
    baseURL: `${(process.env.LITELLM_BASE_URL ?? "").replace(/\/$/, "")}/v1`,
  });
}

function line(e: Entry): string {
  const bits = [`${e.title} (${e.year ?? "?"})`, e.genres.join("/")];
  if (e.reasons.length) bits.push(`reasons: ${e.reasons.join(", ")}`);
  if (e.note) bits.push(`note: ${e.note}`);
  return bits.filter(Boolean).join(" | ");
}

async function rank(
  opts: Options,
  entries: Entry[],
  cands: Detail[],
): Promise<{ id: number; why: string }[] | null> {
  const c = llm();
  if (!c) return null;
  const pick = (vs: string[]) => entries.filter((e) => e.verdict && vs.includes(e.verdict));
  const prompt = [
    `Loved: ${pick(["loved"]).map(line).join("; ") || "none"}`,
    `Liked: ${pick(["liked"]).map(line).join("; ") || "none"}`,
    `Quit or disliked (reasons are optional hints, often absent): ${
      pick(["quit", "disliked"]).map(line).join("; ") || "none"
    }`,
    `Suggested before and skipped: ${pick(["skipped"]).map((e) => e.title).join(", ") || "none"}`,
    `Tonight's mood: ${opts.moods.join(", ") || "no preference"}; max runtime: ${
      opts.maxRuntime ? `${opts.maxRuntime} min` : "any"
    }; kind: ${opts.kind}`,
    "",
    "Candidates:",
    ...cands.map(
      (m) =>
        `[${m.tmdb_id}] ${m.title} (${m.year ?? "?"}, ${m.runtime ?? "?"} min) ${m.genres.join("/")}: ${(m.overview ?? "").slice(0, 220)}`,
    ),
  ].join("\n");
  try {
    const r = await c.chat.completions.create({
      model: process.env.CHAT_MODEL ?? "claude-sonnet-5-5",
      messages: [
        {
          role: "system",
          content:
            "You pick movies for one person based on their taste. Choose the 5 best candidates for tonight, " +
            "ONLY from the candidate list. Infer taste from patterns (tone, pacing, themes), not just genre. " +
            "Reply with JSON only: an array of {\"id\": <candidate id>, \"why\": <one friendly sentence tying it to their taste or mood>}.",
        },
        { role: "user", content: prompt },
      ],
    });
    const json = (r.choices[0].message.content ?? "").match(/\[[\s\S]*\]/)?.[0];
    if (!json) return null;
    const arr = JSON.parse(json) as { id: number; why: string }[];
    return arr.filter((x) => cands.some((m) => m.tmdb_id === Number(x.id)));
  } catch (e) {
    console.error("rank failed", e);
    return null;
  }
}

export async function recommend(opts: Options): Promise<Entry[]> {
  const entries = listEntries();
  const seen = new Set(entries.map((e) => e.tmdb_id));
  const liked = entries.filter((e) => e.verdict === "loved" || e.verdict === "liked");

  const score = new Map<number, number>();
  const pool = new Map<number, Basic>();
  const add = (m: Basic, w: number) => {
    if (seen.has(m.id)) return;
    pool.set(m.id, m);
    score.set(m.id, (score.get(m.id) ?? 0) + w);
  };

  const seeds = opts.kind === "standup" ? [] : liked.slice(0, 8);
  await Promise.all(
    seeds.map(async (e) => {
      const w = e.verdict === "loved" ? 2 : 1;
      for (const m of await recommendations(e.tmdb_id)) add(m, w);
    }),
  );

  const base: Record<string, string | number> = {};
  if (opts.maxRuntime) base["with_runtime.lte"] = opts.maxRuntime;
  const moodGenres = [...new Set(opts.moods.flatMap((m) => MOOD_GENRES[m] ?? []))];

  const runs: Record<string, string | number>[] = [];
  if (opts.kind === "documentary") runs.push({ with_genres: GENRE.documentary });
  else if (opts.kind === "standup") {
    const kw = await standupKeywordId();
    runs.push({ with_genres: GENRE.comedy, ...(kw ? { with_keywords: kw } : {}) });
  } else {
    if (opts.kind === "movie") base.without_genres = GENRE.documentary;
    if (moodGenres.length) runs.push({ with_genres: moodGenres.join("|") });
    runs.push({});
  }
  await Promise.all(
    runs.flatMap((r) =>
      [1, 2].map(async (page) => {
        for (const m of await discover({ ...base, ...r, page })) add(m, 0.5);
      }),
    ),
  );

  const need =
    opts.kind === "documentary" ? GENRE.documentary : opts.kind === "standup" ? GENRE.comedy : null;
  const ranked = [...pool.values()]
    .filter((m) => !need || m.genre_ids?.includes(need))
    .sort(
      (a, b) =>
        (score.get(b.id) ?? 0) + b.vote_average / 20 - ((score.get(a.id) ?? 0) + a.vote_average / 20),
    )
    .slice(0, 24);

  const detailed = (await Promise.all(ranked.map((m) => details(m.id).catch(() => null))))
    .filter((d): d is Detail => d !== null)
    .filter((d) => !opts.maxRuntime || !d.runtime || d.runtime <= opts.maxRuntime)
    .slice(0, 15);

  const picks =
    (await rank(opts, entries, detailed)) ??
    detailed.slice(0, 5).map((d) => ({ id: d.tmdb_id, why: "Similar to titles you liked." }));

  const mood = opts.moods.join(", ") || null;
  return picks.slice(0, 5).flatMap((p) => {
    const d = detailed.find((x) => x.tmdb_id === Number(p.id));
    return d ? [upsertEntry({ ...d, verdict: null, suggested: true, why: p.why, mood })] : [];
  });
}
