"use client";

import { useCallback, useEffect, useState } from "react";

type Item = {
  id: number;
  content: string;
  type: string | null;
  tags: string[];
  summary: string | null;
  followup: string | null;
  created_at: string;
  score?: number;
};
type Msg = { role: "user" | "assistant"; content: string };

function ItemCard({
  item,
  onAnswered,
}: {
  item: Item;
  onAnswered: (i: Item) => void;
}) {
  const [answer, setAnswer] = useState("");
  const [dismissed, setDismissed] = useState(false);

  async function submit() {
    if (!answer.trim()) return;
    const r = await fetch(`/api/items/${item.id}/answer`, {
      method: "POST",
      body: JSON.stringify({ answer }),
    });
    if (r.ok) onAnswered(await r.json());
  }

  return (
    <div className="item">
      <div className="content">{item.content}</div>
      {item.summary && <div className="summary">{item.summary}</div>}
      <div className="meta">
        #{item.id} · {item.type ?? "unsorted"} · {item.created_at}
        {item.score !== undefined && ` · ${(item.score * 100).toFixed(0)}%`}{" "}
        {item.tags.map((t) => (
          <span className="tag" key={t}>
            {t}
          </span>
        ))}
      </div>
      {item.followup && !dismissed && (
        <div className="followup">
          <div>{item.followup}</div>
          <div className="row">
            <input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Optional answer"
            />
            <button onClick={submit}>Save</button>
            <button className="ghost" onClick={() => setDismissed(true)}>
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Item[] | null>(null);
  const [chat, setChat] = useState<Msg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [thinking, setThinking] = useState(false);

  const load = useCallback(async () => {
    setItems(await (await fetch("/api/items")).json());
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function capture() {
    if (!text.trim()) return;
    setSaving(true);
    await fetch("/api/items", {
      method: "POST",
      body: JSON.stringify({ content: text }),
    });
    setText("");
    await load();
    setSaving(false);
  }

  async function search() {
    if (!query.trim()) return setResults(null);
    setResults(
      await (await fetch(`/api/search?q=${encodeURIComponent(query)}`)).json(),
    );
  }

  async function send() {
    if (!chatInput.trim()) return;
    const next: Msg[] = [...chat, { role: "user", content: chatInput }];
    setChat(next);
    setChatInput("");
    setThinking(true);
    const r = await fetch("/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages: next }),
    });
    const data = await r.json();
    setChat([...next, { role: "assistant", content: data.reply }]);
    setThinking(false);
  }

  const replace = (i: Item) =>
    setItems((xs) => xs.map((x) => (x.id === i.id ? i : x)));

  return (
    <main>
      <h1>Second Brain</h1>
      <section>
        <div className="panel">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) capture();
            }}
            placeholder="Whatever you came across. Ctrl+Enter to save."
          />
          <div className="row">
            <button onClick={capture} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        <h2>Search</h2>
        <div className="panel">
          <div className="row" style={{ marginTop: 0 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="Fragments you remember"
            />
            <button onClick={search}>Search</button>
          </div>
          {results?.length === 0 && <div className="meta">No matches.</div>}
          {results?.map((i) => (
            <ItemCard key={i.id} item={i} onAnswered={replace} />
          ))}
        </div>

        <h2>Timeline</h2>
        <div className="panel">
          {items.length === 0 && <div className="meta">Nothing saved yet.</div>}
          {items.map((i) => (
            <ItemCard key={i.id} item={i} onAnswered={replace} />
          ))}
        </div>
      </section>

      <aside>
        <h2 style={{ marginTop: 0 }}>Help me remember</h2>
        <div className="panel">
          <div className="chat">
            {chat.length === 0 && (
              <div className="meta">
                Describe what you vaguely remember and I will look through your
                notes.
              </div>
            )}
            {chat.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.content}
              </div>
            ))}
            {thinking && <div className="meta">Thinking...</div>}
          </div>
          <div className="row">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Something about..."
            />
            <button onClick={send} disabled={thinking}>
              Send
            </button>
          </div>
        </div>
      </aside>
    </main>
  );
}
