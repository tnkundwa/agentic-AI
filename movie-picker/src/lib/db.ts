import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

type SqliteModule = typeof import("node:sqlite");

export type Verdict = "loved" | "liked" | "quit" | "disliked" | "skipped";

export type Entry = {
  id: number;
  tmdb_id: number;
  title: string;
  year: string | null;
  overview: string | null;
  genres: string[];
  runtime: number | null;
  poster: string | null;
  verdict: Verdict | null;
  reasons: string[];
  note: string | null;
  suggested: number;
  why: string | null;
  mood: string | null;
  created_at: string;
};

type Row = Omit<Entry, "genres" | "reasons"> & {
  genres: string | null;
  reasons: string | null;
};

const g = globalThis as unknown as { _db?: DatabaseSync };

function db(): DatabaseSync {
  if (g._db) return g._db;
  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  const { DatabaseSync: Sqlite } = process.getBuiltinModule(
    "node:sqlite",
  ) as SqliteModule;
  const d = new Sqlite(path.join(dir, "movies.db"));
  d.exec("PRAGMA journal_mode = WAL;");
  d.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER NOT NULL UNIQUE,
      title TEXT NOT NULL,
      year TEXT,
      overview TEXT,
      genres TEXT,
      runtime INTEGER,
      poster TEXT,
      verdict TEXT,
      reasons TEXT,
      note TEXT,
      suggested INTEGER NOT NULL DEFAULT 0,
      why TEXT,
      mood TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  g._db = d;
  return d;
}

function toEntry(r: Row): Entry {
  return {
    ...r,
    genres: r.genres ? (JSON.parse(r.genres) as string[]) : [],
    reasons: r.reasons ? (JSON.parse(r.reasons) as string[]) : [],
  };
}

export type NewEntry = {
  tmdb_id: number;
  title: string;
  year: string | null;
  overview: string | null;
  genres: string[];
  runtime: number | null;
  poster: string | null;
  verdict: Verdict | null;
  suggested: boolean;
  why?: string | null;
  mood?: string | null;
};

export function upsertEntry(e: NewEntry): Entry {
  const d = db();
  const existing = d
    .prepare("SELECT id FROM entries WHERE tmdb_id=?")
    .get(e.tmdb_id) as unknown as { id: number } | undefined;
  if (existing) {
    d.prepare(
      "UPDATE entries SET verdict=COALESCE(?, verdict) WHERE id=?",
    ).run(e.verdict, existing.id);
    return getEntry(existing.id)!;
  }
  const r = d
    .prepare(
      `INSERT INTO entries
       (tmdb_id, title, year, overview, genres, runtime, poster, verdict, suggested, why, mood)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      e.tmdb_id,
      e.title,
      e.year,
      e.overview,
      JSON.stringify(e.genres),
      e.runtime,
      e.poster,
      e.verdict,
      e.suggested ? 1 : 0,
      e.why ?? null,
      e.mood ?? null,
    );
  return getEntry(Number(r.lastInsertRowid))!;
}

export function getEntry(id: number): Entry | undefined {
  const r = db().prepare("SELECT * FROM entries WHERE id=?").get(id) as
    | unknown as Row
    | undefined;
  return r && toEntry(r);
}

export function listEntries(): Entry[] {
  return (
    db()
      .prepare("SELECT * FROM entries ORDER BY id DESC")
      .all() as unknown as Row[]
  ).map(toEntry);
}

export function updateEntry(
  id: number,
  f: { verdict?: Verdict; reasons?: string[]; note?: string },
): Entry | undefined {
  const cur = getEntry(id);
  if (!cur) return undefined;
  db()
    .prepare("UPDATE entries SET verdict=?, reasons=?, note=? WHERE id=?")
    .run(
      f.verdict ?? cur.verdict,
      JSON.stringify(f.reasons ?? cur.reasons),
      f.note ?? cur.note,
      id,
    );
  return getEntry(id);
}

export function deleteEntry(id: number) {
  db().prepare("DELETE FROM entries WHERE id=?").run(id);
}
