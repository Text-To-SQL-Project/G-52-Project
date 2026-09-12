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

## 2. Accounts

There is no longer a shared operator password. Five accounts live in
`app.users`, created by `scripts/seed_users.py`, and their passwords are
in the repo-root **`.env`** (not committed):

    grep SEED_ .env

| username | role | ERP identity | what it demonstrates |
|---|---|---|---|
| `student1` | student | student_id 32 | the isolation story — sees one student row, 19 marks |
| `student2` | student | student_id 87 | the peer: same section as student1, so their data genuinely overlaps in the schema |
| `student3` | student | student_id 3 | a different section entirely — useful for "no overlap at all" |
| `faculty1` | faculty | faculty_id 25 | departmental scope: 311 students, and the attendance they recorded |
| `admin` | admin | — | sees everything, and is the only role with the Admin tab |

`student1` and `student2` are picked deterministically as two students
**in the same section**, and `faculty1` teaches their programme. That
matters: two randomly chosen students would share no section, no subject
and no exam, and every isolation claim would hold trivially without
proving anything.

To re-seed after a database reset:

    python -m scripts.seed_users          # writes accounts
    python -m scripts.seed_users --show   # prints the plan, writes nothing

## 2a. The scripted demo moment

This is the clearest single thing to show. Run the **same query** as two
different users. Nothing about the application changes between them —
same request, same SQL, same database role. Only the row policies decide.

Log in as `student1`, ask for the SQL directly if you want it verbatim,
or just use the question. Then log out, log in as `admin`, and run it
again.

| query | student1 | faculty1 | admin |
|---|---|---|---|
| `SELECT count(*) FROM students` | **1** | 311 | 2000 |
| `SELECT count(*) FROM marks` | **19** | 0 | 40000 |
| `SELECT count(*) FROM attendance` | **79** | 2410 | 150000 |
| `SELECT count(*) FROM fee_payments` | **4** | 0 | 8000 |

Before Row Level Security, `student1` saw 2000 / 40000 / 150000 — every
row in the database.

**Say the caution out loud if anyone is reading closely:** `student1` and
`student2` each see exactly 79 attendance rows. That is a coincidence of
the seeded data, and it is why the test suite asserts on row *identity*
rather than row counts. A count comparison would pass even if the two
students' records had been completely swapped.

Two follow-ups worth having ready:

- **The attack.** Paste this as a query and it comes back BLOCKED, naming
  `set_config`:
  `SELECT set_config('app.student_id','87',true), student_id FROM marks`
  It is a plain read-only SELECT, and before the guardrail existed it
  bypassed the row policy in nine of ten query shapes tested. The
  enforcement does not depend on catching it, though — identity comes
  from the backend's pid and start time, which SQL cannot set.
- **A restricted column.** `SELECT blood_group FROM students` fails
  closed with the generic message. Row Level Security filters rows; a
  column that must never be reachable has to come out of the role's
  grants entirely.

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
- **Confidence reads `uncalibrated` for every non-admin query.** This is
  correct and deliberate. Under row scoping the three row-count-sensitive
  result-sanity checks cannot distinguish "empty because wrong" from
  "empty because correctly scoped", so they report themselves unmeasured
  and the score is fused from fewer signals. The isotonic calibrator was
  fit on unscoped runs, so claiming calibration over a different input
  distribution would be an overreach. Admin queries stay calibrated.
- **A student with no rows for a question is no longer marked low
  confidence.** That used to force a FAIL and clamp the score to 0.40 —
  the confidence system penalising the security model for working.
- **Schema Explorer shows no sample values or row counts unless you are
  admin.** Every table and column is still listed for everyone. Samples
  and counts are data, and introspection runs on the owning connection,
  so no row policy can moderate them.
- **`SELECT *` on `students` or `faculty` fails.** Both have columns the
  query role has no grant on. The model is told not to use a wildcard and
  is not shown those columns, so generated SQL should not hit it; a
  hand-written override will.

## 6. Changing anything

The frontend container serves a **pre-built static bundle**, not a dev
server. Editing anything under `frontend/src/` has no effect on what the
browser loads until the image is rebuilt:

    docker compose up -d --build

The same applies to backend changes — there is no `--reload` in the
container. Rebuild, then re-check `/health` before continuing.
