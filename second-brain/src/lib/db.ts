import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

type SqliteModule = typeof import("node:sqlite");

export type Item = {
  id: number;
  content: string;
  type: string | null;
  tags: string[];
  summary: string | null;
  followup: string | null;
  context: string | null;
  created_at: string;
};

type Row = Omit<Item, "tags"> & { tags: string | null };

const g = globalThis as unknown as { _db?: DatabaseSync };

export function db(): DatabaseSync {
  if (g._db) return g._db;
  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  const { DatabaseSync: Sqlite } = process.getBuiltinModule(
    "node:sqlite",
  ) as SqliteModule;
  const d = new Sqlite(path.join(dir, "brain.db"));
  d.exec("PRAGMA journal_mode = WAL;");
  d.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      type TEXT,
      tags TEXT,
      summary TEXT,
      followup TEXT,
      context TEXT,
      embedding BLOB,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  g._db = d;
  return d;
}

const COLS = "id, content, type, tags, summary, followup, context, created_at";

function toItem(r: Row): Item {
  return { ...r, tags: r.tags ? (JSON.parse(r.tags) as string[]) : [] };
}

export function insertItem(content: string, context: string): number {
  const r = db()
    .prepare("INSERT INTO items (content, context) VALUES (?, ?)")
    .run(content, context);
  return Number(r.lastInsertRowid);
}

export function enrichItem(
  id: number,
  f: { type: string; tags: string[]; summary: string; followup: string | null },
  embedding: number[] | null,
) {
  db()
    .prepare(
      "UPDATE items SET type=?, tags=?, summary=?, followup=?, embedding=? WHERE id=?",
    )
    .run(
      f.type,
      JSON.stringify(f.tags),
      f.summary,
      f.followup,
      embedding ? Buffer.from(new Float32Array(embedding).buffer) : null,
      id,
    );
}

export function setEmbedding(id: number, embedding: number[]) {
  db()
    .prepare("UPDATE items SET embedding=? WHERE id=?")
    .run(Buffer.from(new Float32Array(embedding).buffer), id);
}

export function answerFollowup(id: number, answer: string) {
  db()
    .prepare(
      "UPDATE items SET context = COALESCE(context,'') || ? , followup = NULL WHERE id=?",
    )
    .run(`\nClarification: ${answer}`, id);
}

export function getItem(id: number): Item | undefined {
  const r = db().prepare(`SELECT ${COLS} FROM items WHERE id=?`).get(id) as
    | unknown as Row
    | undefined;
  return r && toItem(r);
}

export function listItems(limit = 100): Item[] {
  return (
    db()
      .prepare(`SELECT ${COLS} FROM items ORDER BY id DESC LIMIT ?`)
      .all(limit) as unknown as Row[]
  ).map(toItem);
}

export function recentContext(n = 5): string {
  const rows = db()
    .prepare("SELECT content FROM items ORDER BY id DESC LIMIT ?")
    .all(n) as unknown as { content: string }[];
  return rows.map((r) => `- ${r.content.slice(0, 200)}`).join("\n");
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0,
    na = 0,
    nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export type Hit = Item & { score: number };

export function searchItems(
  query: string,
  queryEmbedding: number[] | null,
  limit = 10,
): Hit[] {
  const rows = db()
    .prepare(`SELECT ${COLS}, embedding FROM items`)
    .all() as unknown as (Row & { embedding: Uint8Array | null })[];
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);
  const qv = queryEmbedding ? new Float32Array(queryEmbedding) : null;

  const hits: Hit[] = rows.map((r) => {
    const hay = `${r.content} ${r.summary ?? ""} ${r.tags ?? ""} ${r.context ?? ""}`.toLowerCase();
    const kw = words.length
      ? words.filter((w) => hay.includes(w)).length / words.length
      : 0;
    let sem = 0;
    if (qv && r.embedding) {
      const buf = r.embedding;
      const v = new Float32Array(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      );
      sem = Math.max(0, cosine(qv, v));
    }
    const { embedding: _e, ...rest } = r;
    return { ...toItem(rest), score: qv ? 0.6 * sem + 0.4 * kw : kw };
  });

  return hits
    .filter((h) => h.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
