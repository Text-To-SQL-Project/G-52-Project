# Demo Runbook

One page. Everything needed to run the demo, and what to do when the LLM
quota runs out mid-way.

## 1. Cold start

From the repo root:

    docker compose up -d --build
    docker compose ps

Healthy looks like:

| Service | Status | Ports |
|---|---|---|
| `db` | `Up (healthy)` | `0.0.0.0:5433->5432/tcp` |
| `api` | `Up` | `0.0.0.0:8000->8000/tcp` |
| `frontend` | `Up` | `0.0.0.0:5173->80/tcp` |

`db` must reach **`(healthy)`** before the API can serve anything — on a
first boot it loads the full `college_erp` schema and ~190K rows from
`seed/`, which takes a minute or two. On later boots the volume already
exists and it comes up in seconds.

Then confirm the API is actually alive, not just running:

    curl http://localhost:8000/health

Expected: `{"status":"ok","version":"..."}`. If that answers, open
http://localhost:5173 and log in.

If `db` sits in `starting` for more than ~3 minutes, or `api` restarts in
a loop, read the reason rather than restarting blindly:

    docker compose logs db --tail 40
    docker compose logs api --tail 40

## 2. Login password

The password is `OPERATOR_PASSWORD` in the repo-root **`.env`** file (not
committed; `.env.example` carries only a placeholder). Read it with:

    grep OPERATOR_PASSWORD .env

There is one shared operator password and no users table — see the Auth
section of the top-level README for why that is deliberate.

## 3. The five demo queries, in order

Run them in this order. The first two prove the happy path, the next two
prove the system declines rather than guesses, the last proves the
guardrail layer stops SQL the LLM never wrote.

| # | Enter | Expected status | Why it's in the demo |
|---|---|---|---|
| 1 | `Which students are currently active?` | **SUCCESS** | Simple lookup. Fast, always correct on the golden set. Warm-up. |
| 2 | `What are the top 5 subjects by average marks, along with their department?` | **SUCCESS** | Multi-table join plus aggregation — the real capability claim. |
| 3 | `Show me the top students.` | **CLARIFICATION_NEEDED** | Genuinely ambiguous ("top" by what?). The system asks instead of picking a metric silently. |
| 4 | `Drop the students table.` | **REFUSED** | The model declines at generation time. Note the status is REFUSED, **not** BLOCKED — nothing reached the guardrail because no SQL was produced. |
| 5 | In the SQL editor, replace the SQL with `DROP TABLE students;` and re-run | **BLOCKED** | The guardrail's `sqlglot` AST analysis, on SQL the user supplied directly. This is the `sql_override` path, and it makes **zero LLM calls**. |

Queries 4 and 5 are the pair worth narrating together: they are two
different defences against the same request, and only one of them depends
on the model behaving well.

Budget: roughly 8 Gemini calls for all five (queries 1 and 2 cost three
each — one generation plus two back-translation; 3 and 4 cost one each;
5 costs none).

## 4. If the Gemini quota is exhausted mid-demo

The free tier is **500 requests/day** for `gemini-flash-lite-latest`, and
it resets at **12:30 pm IST** (midnight Pacific). The authoritative
counter is https://aistudio.google.com/rate-limit — the app does not keep
a persistent daily tally, so do not trust `LLM_DAILY_CALL_LIMIT` as a
reading of usage.

When quota is gone, `/v1/query` on a natural-language question returns
**ERROR**. These screens keep working with no LLM access at all, and are
enough to carry the rest of the demo:

- **Schema Explorer** — all 25 live tables with PK/FK and sample values,
  read straight from Postgres via introspection.
- **History** — every query already run this session, with its status.
  Anything demonstrated before the quota ran out is still there to talk
  through.
- **Admin → blocked queries** — the real, unredacted SQL for recent
  BLOCKED queries, plus the live guardrail and detection config and the
  confidence-fusion weights.
- **Demo query 5 (BLOCKED via `sql_override`)** — still works. The
  override path skips generation entirely and a BLOCKED result
  short-circuits before the detectors, so it is the one query that costs
  nothing. Paste any destructive statement (`DROP TABLE students;`,
  `DELETE FROM marks;`, `SELECT 1; DROP TABLE marks;`) into the SQL editor
  and re-run.

In short: with no quota you can still demonstrate the schema, the history,
and the entire safety story. Only generation is lost.

## 5. Known behaviour, so it isn't a surprise on stage

- **Generation retries up to 5 times.** A slow or rate-limited call backs
  off exponentially between attempts. Worst case is well over a minute
  before it either succeeds or errors. This is deliberate: generation
  cannot degrade gracefully, so it gets the full retry budget.
- **Back-translation is capped at 2 attempts (~52 s worst case).** Two
  attempts at the 25-second timeout plus one backoff delay. If it still
  fails it degrades to a neutral WARN at 0.5 rather than failing the
  request — which visibly drags the confidence score down, since that
  signal carries weight 0.29. A query that returns correct SQL with a
  middling confidence score most likely hit this.
- **Multi-query agreement is off** (`MULTI_QUERY_ENABLED=false`) and its
  row is hidden from the confidence panel rather than shown as a
  misleading 50%. Four signals feed the score, not five.
- **First query after a cold start is slower** — no warm connection pool,
  no prompt cache.

## 6. Changing anything

The frontend container serves a **pre-built static bundle**, not a dev
server. Editing anything under `frontend/src/` has no effect on what the
browser loads until the image is rebuilt:

    docker compose up -d --build

The same applies to backend changes — there is no `--reload` in the
container. Rebuild, then re-check `/health` before continuing.
