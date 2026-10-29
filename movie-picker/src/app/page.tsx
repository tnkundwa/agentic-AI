"use client";

import { useCallback, useEffect, useState } from "react";

type Verdict = "loved" | "liked" | "quit" | "disliked" | "skipped";
type Entry = {
  id: number;
  tmdb_id: number;
  title: string;
  year: string | null;
  genres: string[];
  runtime: number | null;
  poster: string | null;
  verdict: Verdict | null;
  reasons: string[];
  note: string | null;
  suggested: number;
  why: string | null;
};
type Hit = {
  id: number;
  title: string;
  release_date?: string;
  poster_path: string | null;
};

const MOODS = ["funny", "light", "thrilling", "thoughtful", "scary", "mind-bending", "cozy"];
const REASONS = ["too slow", "too dark", "predictable", "not funny", "too violent", "confusing", "not my mood"];
const VERDICTS: { v: Verdict; label: string; good: boolean }[] = [
  { v: "loved", label: "Loved", good: true },
  { v: "liked", label: "Liked", good: true },
  { v: "quit", label: "Quit", good: false },
  { v: "disliked", label: "Disliked", good: false },
];
const img = (p: string | null) =>
  p ? `https://image.tmdb.org/t/p/w185${p}` : undefined;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json" },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
}

function EntryCard({
  e,
  onChange,
  onRemove,
  showSkip,
}: {
  e: Entry;
  onChange: (e: Entry) => void;
  onRemove: (id: number) => void;
  showSkip?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(e.note ?? "");
  const negative = e.verdict === "quit" || e.verdict === "disliked";

  const patch = async (body: object) =>
    onChange(
      await api<Entry>(`/api/entries/${e.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    );

  return (
    <div className="card">
      <img className="poster" src={img(e.poster)} alt="" />
      <div className="body">
        <div className="title">
          {e.title} <span className="meta">{e.year}</span>
        </div>
        <div className="meta">
          {e.genres.join(" / ")}
          {e.runtime ? ` · ${e.runtime} min` : ""}
        </div>
        {e.why && <div className="why">{e.why}</div>}
        <div className="row">
          {VERDICTS.map(({ v, label, good }) => (
            <button
              key={v}
              className={`v ${good ? "good" : "bad"} ${e.verdict === v ? "on" : ""}`}
              onClick={() => patch({ verdict: v })}
            >
              {label}
            </button>
          ))}
          {showSkip && (
            <button
              className={`v bad ${e.verdict === "skipped" ? "on" : ""}`}
              onClick={() => patch({ verdict: "skipped" })}
            >
              Not for me
            </button>
          )}
          <button className="link" onClick={() => onRemove(e.id)}>
            remove
          </button>
        </div>
        {negative && (
          <div className="row">
            {!open ? (
              <button className="link" onClick={() => setOpen(true)}>
                add a reason (optional)
              </button>
            ) : (
              <>
                {REASONS.map((r) => (
                  <button
                    key={r}
                    className={`chip ${e.reasons.includes(r) ? "on" : ""}`}
                    onClick={() =>
                      patch({
                        reasons: e.reasons.includes(r)
                          ? e.reasons.filter((x) => x !== r)
                          : [...e.reasons, r],
                      })
                    }
                  >
                    {r}
                  </button>
                ))}
                <input
                  value={note}
                  onChange={(ev) => setNote(ev.target.value)}
                  onBlur={() => note !== (e.note ?? "") && patch({ note })}
                  placeholder="anything else, or leave blank"
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [moods, setMoods] = useState<string[]>([]);
  const [kind, setKind] = useState("any");
  const [maxRuntime, setMaxRuntime] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setEntries(await api<Entry[]>("/api/entries"));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const guard = async (fn: () => Promise<void>) => {
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const search = () =>
    guard(async () => {
      if (!q.trim()) return setHits([]);
      setHits(await api<Hit[]>(`/api/search?q=${encodeURIComponent(q)}`));
    });

  const addSeed = (h: Hit, verdict: Verdict) =>
    guard(async () => {
      await api("/api/entries", {
        method: "POST",
        body: JSON.stringify({ tmdb_id: h.id, verdict }),
      });
      setHits((xs) => xs.filter((x) => x.id !== h.id));
      await load();
    });

  const recommend = () =>
    guard(async () => {
      setBusy(true);
      try {
        await api("/api/recommend", {
          method: "POST",
          body: JSON.stringify({
            moods,
            kind,
            maxRuntime: maxRuntime ? Number(maxRuntime) : null,
          }),
        });
        await load();
      } finally {
        setBusy(false);
      }
    });

  const replace = (n: Entry) =>
    setEntries((xs) => xs.map((x) => (x.id === n.id ? n : x)));
  const remove = async (id: number) => {
    await fetch(`/api/entries/${id}`, { method: "DELETE" });
    setEntries((xs) => xs.filter((x) => x.id !== id));
  };

  const pending = entries.filter((e) => e.suggested && !e.verdict);
  const history = entries.filter((e) => !(e.suggested && !e.verdict));
  const rated = entries.filter((e) => e.verdict && e.verdict !== "skipped").length;

  return (
    <main>
      <h1>Movie Picker</h1>
      <p className="sub">
        Tell it what you loved and what you quit. It gets better with every
        pick. {rated} rated so far.
      </p>
      {err && <div className="err">{err}</div>}

      <h2>1. What have you watched?</h2>
      <div className="panel">
        <div className="row" style={{ marginTop: 0 }}>
          <input
            className="wide"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Search a movie, documentary or stand-up special"
          />
          <button onClick={search}>Search</button>
        </div>
        {hits.map((h) => (
          <div className="card" key={h.id}>
            <img className="poster" src={img(h.poster_path)} alt="" />
            <div className="body">
              <div className="title">
                {h.title}{" "}
                <span className="meta">{h.release_date?.slice(0, 4)}</span>
              </div>
              <div className="row">
                {VERDICTS.map(({ v, label, good }) => (
                  <button
                    key={v}
                    className={`v ${good ? "good" : "bad"}`}
                    onClick={() => addSeed(h, v)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <h2>2. What do you feel like tonight?</h2>
      <div className="panel">
        <div className="row" style={{ marginTop: 0 }}>
          {MOODS.map((m) => (
            <button
              key={m}
              className={`chip ${moods.includes(m) ? "on" : ""}`}
              onClick={() =>
                setMoods((xs) =>
                  xs.includes(m) ? xs.filter((x) => x !== m) : [...xs, m],
                )
              }
            >
              {m}
            </button>
          ))}
        </div>
        <div className="row">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="any">Anything</option>
            <option value="movie">Movies</option>
            <option value="documentary">Documentaries</option>
            <option value="standup">Stand-up</option>
          </select>
          <select
            value={maxRuntime}
            onChange={(e) => setMaxRuntime(e.target.value)}
          >
            <option value="">Any length</option>
            <option value="90">Under 90 min</option>
            <option value="110">Under 110 min</option>
            <option value="140">Under 140 min</option>
          </select>
          <button onClick={recommend} disabled={busy}>
            {busy ? "Thinking..." : "Pick for me"}
          </button>
        </div>
      </div>

      {pending.length > 0 && (
        <>
          <h2>Try these</h2>
          <div className="panel">
            {pending.map((e) => (
              <EntryCard
                key={e.id}
                e={e}
                onChange={replace}
                onRemove={remove}
                showSkip
              />
            ))}
          </div>
        </>
      )}

      {history.length > 0 && (
        <>
          <h2>Your history</h2>
          <div className="panel">
            {history.map((e) => (
              <EntryCard key={e.id} e={e} onChange={replace} onRemove={remove} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
