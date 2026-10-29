---
date: 2026-10-29T09:09:54+00:00
git_commit: none (directory is not a git repository)
branch: none
topic: "How the current code base suggests movies, and which existing parts relate to upcoming-movie / release-date suggestions based on user history"
tags: [research, codebase, recommend, tmdb, sqlite, next-api]
status: complete
---

# Research: How the codebase suggests movies

## Research Question
"Search how the current code base suggests movies and how we can implement a new feature for suggesting upcoming movies and release dates based on users history."

Scope note: only the first half (how suggestions work today) is documented. The "how we can implement" half is a feature/planning request and is out of scope for this research skill. Below, the existing code that touches release dates, history and TMDB endpoints is documented as it exists.

## Summary
Movie Picker is a single-user Next.js 15 app (App Router). The user records verdicts on movies (loved/liked/quit/disliked) in a SQLite table; "Pick for me" calls `POST /api/recommend`, which builds a candidate pool from TMDB (`/movie/{id}/recommendations` for up to 8 liked/loved titles, plus `/discover/movie` runs filtered by mood/kind/runtime), scores and trims it, fetches details, then asks an LLM (via an OpenAI-compatible LiteLLM endpoint) to choose 5 with one-sentence reasons. If the LLM is unavailable, the top 5 by score are used. Picks are stored in the same `entries` table with `suggested=1` and shown under "Try these".

No code currently references upcoming/unreleased movies, TMDB `/movie/upcoming`, or release-date filtering. Release dates are only kept as a 4-character `year`.

```
src/
├── app/
│   ├── page.tsx                 UI (single client page)
│   ├── layout.tsx, globals.css
│   └── api/
│       ├── recommend/route.ts   POST -> recommend()
│       ├── entries/route.ts     GET list, POST add verdict
│       ├── entries/[id]/route.ts PATCH verdict/reasons/note, DELETE
│       └── search/route.ts      GET -> searchMovies()
└── lib/
    ├── recommend.ts             candidate pool, scoring, LLM ranking
    ├── tmdb.ts                  TMDB fetch wrapper + endpoints
    └── db.ts                    node:sqlite, `entries` table
data/movies.db                   SQLite file (WAL)
```

```
page.tsx --POST /api/recommend--> recommend()
   listEntries() (db)  -> seen set, liked/loved seeds
   recommendations(id) x<=8 seeds (weight 2 loved / 1 liked)
   discover(...) x pages 1,2 per run (weight 0.5)
   score + vote_average/20 -> top 24 -> details() -> filter runtime -> top 15
   rank() LLM -> 5 picks {id, why}   (fallback: first 5)
   upsertEntry(suggested=1, why, mood) -> returned, page reloads /api/entries
```

## Detailed Findings

### Recommendation engine (`src/lib/recommend.ts`)
- Options: `{ moods, maxRuntime, kind }`, kind is `any | movie | documentary | standup` (`recommend.ts:13-14`).
- `MOOD_GENRES` maps 7 moods to TMDB genre ids (`recommend.ts:16-24`).
- `recommend()` (`recommend.ts:91-158`):
  - Loads all entries; `seen` = every tmdb_id already in the table (any verdict, including previous suggestions), which is excluded from the pool (`:92-99`).
  - Seeds: first 8 entries with verdict loved/liked (list is ordered by id DESC, so most recent); none for `standup` (`:94,104`). Each seed's TMDB recommendations are added with weight 2 (loved) or 1 (liked) (`:105-110`).
  - Discover runs: `documentary` -> genre 99; `standup` -> comedy + "stand-up comedy" keyword; otherwise mood genres joined with `|` (if any) plus an unfiltered run; `movie` adds `without_genres=documentary`; `maxRuntime` -> `with_runtime.lte`. Pages 1 and 2 each, weight 0.5 (`:112-132`).
  - Ranking: score + `vote_average/20`, genre filter for documentary/standup, top 24 (`:134-142`); `details()` for each, runtime filter, top 15 (`:144-147`).
  - `rank()` LLM step, fallback to first 5 with the text "Similar to titles you liked." (`:149-151`).
  - Results written via `upsertEntry({... verdict: null, suggested: true, why, mood})` (`:153-157`).
- `rank()` (`recommend.ts:42-89`): builds a text prompt of Loved / Liked / Quit-or-disliked (with reasons and notes via `line()`) / Skipped titles, tonight's mood, max runtime and kind, then candidates `[id] title (year, runtime) genres: overview[:220]`. System prompt asks for the 5 best, only from the list, JSON array `{id, why}`. Response is regex-extracted for `[...]` and filtered to known candidate ids. Model: `CHAT_MODEL` env or `claude-sonnet-5-5` (`:69`).
- `llm()` returns null without `LITELLM_API_KEY`; otherwise an OpenAI client with `baseURL = LITELLM_BASE_URL + /v1` (`:27-33`).

### TMDB client (`src/lib/tmdb.ts`)
- `tmdb()` helper: bearer `TMDB_TOKEN`, base `https://api.themoviedb.org/3`, throws on non-OK (`:24-37`).
- Endpoints wrapped: `/search/movie` (first 8) (`:52`), `/movie/{id}/recommendations` (`:60`), `/discover/movie` with defaults `sort_by=vote_count.desc`, `vote_count.gte=300`, `vote_average.gte=6.3`, `include_adult=false` (`:65-76`), `/search/keyword` (`:78`), `/movie/{id}` (`:86`).
- `Basic` type includes `release_date?: string` (`:5`); `Detail` reduces it to `year` (first 4 chars) (`:93`). Full release date is not persisted.
- No wrapper exists for `/movie/upcoming`, release-date filters (`primary_release_date.gte` etc.) or `region`.

### Persistence / user history (`src/lib/db.ts`)
- `node:sqlite` `DatabaseSync` at `data/movies.db`, WAL mode, cached on `globalThis._db` (`:32-64`).
- Single table `entries` (`:44-60`): tmdb_id (unique), title, year, overview, genres (JSON), runtime, poster, verdict, reasons (JSON), note, suggested, why, mood, created_at.
- Verdicts: `loved | liked | quit | disliked | skipped` (`:7`).
- `upsertEntry` inserts or, if the tmdb_id exists, only updates verdict via `COALESCE` (`:88-119`); `updateEntry` updates verdict/reasons/note (`:136-151`); `listEntries` orders by id DESC (`:128-134`); `deleteEntry` (`:153`).
- "History" is this table; there is no watch-date, rating scale, user id, or separate history table.

### API routes (`src/app/api/*`)
- `recommend/route.ts`: POST with `{moods, maxRuntime, kind}`, nodejs runtime, `maxDuration=60`, errors -> 502 (`:4-23`).
- `entries/route.ts`: GET list; POST `{tmdb_id, verdict}` fetches `details()` then `upsertEntry(suggested:false)` (`:7-26`).
- `entries/[id]/route.ts`: PATCH and DELETE (`:6-28`).
- `search/route.ts`: GET `?q=` -> `searchMovies` (`:6-14`).

### UI (`src/app/page.tsx`)
- Section 1 search and add verdicts (`:223-257`); section 2 mood chips, kind and runtime selects, "Pick for me" (`:259-296`); "Try these" = entries with `suggested && !verdict` (`:210,298-313`); "Your history" = everything else (`:211,315-324`).
- `EntryCard` shows poster, title, year, genres, runtime, `why`, verdict buttons, optional negative reasons (`:48-141`). "Not for me" sets verdict `skipped` (`:93-100`).
- Entry type on the client has no release-date field (`:6-19`); `Hit` carries `release_date` for search results only (`:20-25`).

### Configuration
- `.env.example`: `TMDB_TOKEN`, `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `CHAT_MODEL` (the `.env.local` file exists but was not read).
- Dependencies: next, react, openai (`package.json`). Scripts: dev/build/start on port 3001, `typecheck`. No test runner configured.

## Code References
- `src/lib/recommend.ts:91-158` - `recommend()` pipeline
- `src/lib/recommend.ts:42-89` - LLM ranking prompt and parsing
- `src/lib/recommend.ts:16-24` - mood to genre mapping
- `src/lib/tmdb.ts:24-37` - TMDB request helper
- `src/lib/tmdb.ts:65-76` - discover defaults
- `src/lib/tmdb.ts:86-99` - details -> Detail (year only)
- `src/lib/db.ts:44-60` - `entries` schema
- `src/lib/db.ts:88-119` - `upsertEntry`
- `src/app/api/recommend/route.ts:7-23` - recommend endpoint
- `src/app/page.tsx:185-201` - client call to recommend
- `src/app/page.tsx:210-212` - pending vs history split

## Architecture Documentation
- Thin route handlers delegate to `src/lib` modules; all server code runs on the Node runtime.
- Candidate generation (TMDB) is separate from ranking (LLM) with a deterministic fallback.
- User preference signal = verdicts, optional reasons/notes, and prior skips, passed to the LLM as text; the numeric scoring only uses verdict weight (2/1) from seeds, not reasons or negatives.
- Suggestions and history share one table, distinguished by `suggested` and `verdict`.
- Secrets via `.env.local`; the LLM is accessed through an OpenAI-compatible LiteLLM proxy.

## Open Questions
- `.env.local` contents and whether TMDB region/language settings are used elsewhere were not inspected.
- No git history is available to check how the code evolved.
