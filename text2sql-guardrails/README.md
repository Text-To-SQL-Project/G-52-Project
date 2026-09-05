# Text-to-SQL Guardrails

A Text-to-SQL system over a real 25-table PostgreSQL database
(`college_erp`) that treats safety and confidence as first-class,
*measured* properties — not a demo that just returns SQL. Every claim below
is backed by a hand-verified, hand-audited golden-set evaluation; see
[`eval/README.md`](eval/README.md) for the full methodology, including two
documented cases where a suspicious metric was diagnosed down to a labeling
bug rather than taken at face value.

## Results

Evaluated on 161 hand-authored, hand-verified golden-set questions (135
unique answerable + 8 unanswerable + 18 adversarial), 3 repeats each:

| Metric | Value | What it measures |
|---|---|---|
| **Execution accuracy (EX)** | **0.714** | Fraction of answerable questions where the generated SQL's *results* match gold, via [a documented execution-match criterion](eval/README.md#the-execution-match-criterion) |
| **Fused confidence AUROC** | **0.649** | Does the confidence score rank correct answers above incorrect ones? (4-signal fusion, `multi_query_agreement` dropped — [why](eval/README.md#confidence-fusion-changes-2026-08)) |
| **Held-out calibration ECE** | **0.118** | Isotonic-calibrated, evaluated on a **question-level 60/40 held-out split** (not in-sample) — [fit procedure](eval/README.md#isotonic-calibration-fit-and-evaluated-on-a-question-level-held-out-split) |
| **Guardrail block rate (direct_sql)** | **30/30** | Every `DROP`/`DELETE`/`UPDATE`/`TRUNCATE`/stacked-injection SQL submitted directly to the guardrail layer was blocked |
| **Destructive queries executed** | **0** | Verified count of actually-destructive SQL that ran, across all adversarial cases (a coarser heuristic flags 8 adversarial-question executions; all 8 were manually confirmed as benign LLM substitutions — e.g. a `DROP TABLE` prompt returning a plain `SELECT` — not guardrail bypasses) |

These are the same numbers served live at `GET /v1/admin/config` and shown
on the Admin screen — not a separate marketing claim.

## Architecture

```
question ──▶ generation (LLM, cached schema prompt)
               │
               ▼
         guardrails (sqlglot AST — may BLOCK here, before execution)
               │
               ▼
   pre-exec detectors: schema_alignment, back_translation_match
               │
               ▼
      read-only execution (separate DB role, defense in depth)
               │
               ▼
     post-exec detectors: result_sanity, (multi_query_agreement, off by default)
               │
               ▼
    confidence fusion (hand-tuned weighted mean) ──▶ isotonic calibration
```

- **Generation** (`app/generation/`) — Claude, with the ~2.6K-token schema
  block marked as an Anthropic prompt-cache breakpoint (byte-identical
  across every call), plus a JSON-structured response parser.
- **Guardrails** (`app/safety/guardrails.py`) — static `sqlglot` AST
  analysis: blocks DDL/DML/multi-statement SQL, injects a row `LIMIT`,
  checks subquery nesting depth. This runs whether the SQL came from the
  LLM or a power-user's `sql_override` — nothing reaches the database
  unchecked.
- **Detection** (`app/detection/`) — four signals (`sql_validity`,
  `schema_alignment`, `back_translation_match`, `result_sanity`) feed a
  hand-tuned weighted-mean fusion, then an isotonic regression calibrates
  that score against measured accuracy on held-out data.
  `multi_query_agreement` exists but is off by default (`MULTI_QUERY_ENABLED=false`)
  — an ablation study found it was the only signal whose removal
  *increased* AUROC (see results table above), and it was never in
  `fuse_confidence()`'s weighted set to begin with. `eval/runner.py`
  evaluates whatever config is actually deployed rather than overriding
  it — it used to force this signal on regardless of `.env`, which meant
  the eval measured a configuration nothing ships with; `eval/analyze.py`
  now notes plainly when the signal's data is absent instead of silently
  omitting it.
- **Read-only execution** — `app/db.py`'s execution engine is meant to map
  to a SELECT-only Postgres role (`READONLY_DATABASE_URL`), so even a
  guardrail miss can't write. The Docker stack provisions this role for
  real (`seed/27_readonly_role.sql`).

## Run it

### Docker (Postgres + API + frontend)

    cp .env.example .env          # add your Anthropic key, OPERATOR_PASSWORD, and SECRET_KEY -- see Auth below
    docker compose up --build

- Frontend: http://localhost:5173
- API:      http://localhost:8000
- API docs: http://localhost:8000/docs
- DB:       Postgres on localhost:5433 (`app`/`app`, db `college_erp`) — host port 5433 maps to the container's 5432, so it doesn't clash with a native Postgres already on 5432; schema + all 25 tables' data (~190K rows) load automatically on first boot from `seed/`

### Without Docker

    # backend
    python -m venv venv && venv\Scripts\pip install -r requirements.txt
    # ... point DATABASE_URL at your own college_erp Postgres instance (see .env.example)
    uvicorn app.main:app --reload

    # frontend, in a second terminal
    cd frontend && npm install && npm run dev

## Auth

Minimal and deliberately scoped: one shared operator password, no users
table, no registration, no per-user anything. Set two env vars before
starting the API (both required — the app refuses every login with a 500,
not a 401, if either is empty, rather than silently accepting an empty
password or signing tokens with a guessable key):

    OPERATOR_PASSWORD=whatever-you-want
    SECRET_KEY=<64 random hex chars — generate with: python -c "import secrets; print(secrets.token_hex(32))">

The frontend shows a login screen gating the whole app. On success,
`POST /auth/login` returns a signed, 12-hour session token (HMAC-SHA256
over an expiry claim — no JWT library, there's nothing else to put in the
token when there's only one shared credential); the frontend stores it in
`localStorage` and sends it as `Authorization: Bearer <token>` on every
`/v1/*` request. `app/auth.py::require_auth` is applied once, at
`app.include_router()` in `app/main.py`, so it covers every route on that
router (query, schema, history, admin/config, admin/blocked-queries) —
including any added later — rather than being attached per-route where
one could be forgotten. A missing, malformed, expired, or tampered token
all get the identical `401 Not authenticated`; a wrong password gets the
identical `401 Invalid credentials` regardless of how wrong — never which
specific thing about the credential failed.

Explicitly out of scope: multiple users, roles, per-user history, OAuth,
refresh tokens, rate limiting on login attempts.

## Screens

| Screen | Talks to | What it shows |
|---|---|---|
| **Workspace** | `POST /v1/query` | NL input, syntax-highlighted SQL (editable + re-runnable via `sql_override`), results table, confidence card with per-signal bars, guardrail/clarification/error states |
| **History** | `GET /v1/history` | Past queries for the current browser session (session id persisted in `localStorage`) |
| **Schema Explorer** | `GET /v1/schema` | All 25 live tables, searchable, with PK/FK/sample values |
| **Admin** | `GET /v1/admin/config`, `GET /v1/admin/blocked-queries` | The results table above, live guardrail/detection config, confidence-fusion weights, and the real (unredacted) SQL for recent BLOCKED queries — see Auth above for why that's safe to show here and nowhere else |

Every screen requires being logged in first — see [Auth](#auth) above.

## API

| Method | Path | Returns | Contract |
|---|---|---|---|
| POST | `/auth/login` | `LoginResponse` | `app/api/auth_models.py` — outside `/v1`, unauthenticated by necessity (see Auth above) |
| POST | `/v1/query` | `QueryResponse` | `app/api/models.py` (fixed — frontend and backend both build against this) |
| GET | `/v1/schema` | `SchemaResponse` | `app/api/models.py` — 503 (not a fake schema) if introspection fails |
| GET | `/v1/history` | `HistoryResponse` | `app/api/models.py` — backed by a real `app.query_history` table (`app/history.py`), written on every query regardless of status; 503 if the read fails |
| GET | `/v1/admin/config` | `AdminConfigResponse` | `app/api/admin_models.py` — deliberately **not** in `models.py`, since it's operational introspection, not part of the core query contract |
| GET | `/v1/admin/blocked-queries` | `BlockedQueriesResponse` | `app/api/admin_models.py` — real, unredacted SQL for BLOCKED queries; never present in `QueryResponse` or `HistoryResponse` |
| GET | `/health` | `{status, version}` | — |

All `/v1/*` routes above require `Authorization: Bearer <token>` (see Auth); `/auth/login` and `/health` do not.

`app/api/models.py` is the single source of truth for the core query/
schema/history contract; the frontend's `frontend/src/types/api.ts`
mirrors it by hand and is kept in sync manually (see that file's own
header comment). Admin and auth each get their own smaller models file
(`app/api/admin_models.py`, `app/api/auth_models.py`), deliberately kept
out of the fixed contract since they're operational, not core.

## Evaluation

161-question golden set, real pipeline execution (no shortcuts — the eval
runner calls the same `app.generation`/`app.safety`/`app.detection` code
the API does), full methodology in [`eval/README.md`](eval/README.md):

    python -m eval.runner --repeats 3               # writes eval/results.jsonl
    python -m eval.analyze eval/results.jsonl --plot eval/reliability.png
    python -m eval.fit_calibration eval/results.jsonl # isotonic calibration, held-out

`eval/README.md` also documents the two departures worth knowing before
citing this system's numbers elsewhere: the execution-match criterion's
four deliberate departures from the Spider/BIRD `EX` definition, and a
methodological finding where a below-chance AUROC turned out to be
~40% false negatives in the *labeling* criterion, not the system — found
by manually auditing disagreement cases before accepting the metric, not
after.

## Testing

    pytest -q     # 73 tests: guardrails, generation (noop detection),
                  # execution-match criterion (permissive + strict), confidence
                  # fusion + calibration, schema-disclosure regression,
                  # multi-provider LLM client (contract + usage tracking), auth

## Known limitations

- **Calibration held-out set is small.** 54 questions in the test split —
  materially better than the pre-calibration ECE, but not enough data to
  treat the calibration curve as final; re-fit as the golden set grows
  (`eval/fit_calibration.py`).
- **`back_translation_match` needs two extra LLM calls per query**
  (back-translate, then compare) — disabling it
  (`BACK_TRANSLATION_ENABLED=false`) degrades confidence fusion to the
  remaining three signals rather than failing; see
  `app/detection/confidence.py`'s disabled-signal handling.
  `schema_alignment` and `result_sanity` are pure heuristics (AST/DB
  introspection and row-count checks) and never call the LLM.
