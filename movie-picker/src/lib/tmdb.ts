const BASE = "https://api.themoviedb.org/3";

export type Basic = {
  id: number;
  title: string;
  release_date?: string;
  overview: string;
  poster_path: string | null;
  genre_ids?: number[];
  vote_average: number;
  vote_count: number;
};

export type Detail = {
  tmdb_id: number;
  title: string;
  year: string | null;
  overview: string | null;
  genres: string[];
  runtime: number | null;
  poster: string | null;
};

async function tmdb<T>(
  p: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const token = process.env.TMDB_TOKEN;
  if (!token) throw new Error("TMDB_TOKEN is not set in .env.local");
  const url = new URL(BASE + p);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!r.ok) throw new Error(`TMDB ${r.status} on ${p}`);
  return (await r.json()) as T;
}

export const GENRE = {
  comedy: 35,
  documentary: 99,
  drama: 18,
  thriller: 53,
  action: 28,
  family: 10751,
  romance: 10749,
  horror: 27,
  scifi: 878,
  mystery: 9648,
} as const;

export async function searchMovies(q: string): Promise<Basic[]> {
  const r = await tmdb<{ results: Basic[] }>("/search/movie", {
    query: q,
    include_adult: "false",
  });
  return r.results.slice(0, 8);
}

export async function recommendations(id: number): Promise<Basic[]> {
  const r = await tmdb<{ results: Basic[] }>(`/movie/${id}/recommendations`);
  return r.results;
}

export async function discover(
  params: Record<string, string | number>,
): Promise<Basic[]> {
  const r = await tmdb<{ results: Basic[] }>("/discover/movie", {
    sort_by: "vote_count.desc",
    "vote_count.gte": 300,
    "vote_average.gte": 6.3,
    include_adult: "false",
    ...params,
  });
  return r.results;
}

export async function standupKeywordId(): Promise<number | null> {
  const r = await tmdb<{ results: { id: number; name: string }[] }>(
    "/search/keyword",
    { query: "stand-up comedy" },
  );
  return r.results[0]?.id ?? null;
}

export async function details(id: number): Promise<Detail> {
  const m = await tmdb<
    Basic & { runtime: number | null; genres: { id: number; name: string }[] }
  >(`/movie/${id}`);
  return {
    tmdb_id: m.id,
    title: m.title,
    year: m.release_date?.slice(0, 4) || null,
    overview: m.overview || null,
    genres: m.genres.map((x) => x.name),
    runtime: m.runtime || null,
    poster: m.poster_path,
  };
}
