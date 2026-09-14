# Security model

Four independent layers stand between a natural-language question and the
database. This document states what each one catches, what it does not,
and what remains after all four. It is the reference for the paper's
architecture section.

The organising principle is that **no layer is trusted to be sufficient**.
Each is placed where it can still be useful when the one before it has
failed, and each is described below in terms of what survives its failure.

---

## Layer 1 — Generation refusal

**Where:** `app/generation/` (prompt, model response, `refusal` field)
**Runs:** before any SQL exists

The model is asked to decline rather than answer when a request is
destructive, or unanswerable from the schema. A refusal carries a kind
(`unsafe` or `ambiguous`) and a reason, and the prompt explicitly forbids
the common evasion of substituting a harmless placeholder query.

**Catches:** the great majority of destructive and out-of-scope requests,
at zero cost, before anything is parsed or executed. It is also the only
layer that can distinguish "I will not" from "I cannot", which is what
makes a useful message possible.

**Does not catch:** anything, reliably. It is a language model asked to
follow an instruction. It can be argued out of a refusal, confused by an
indirect phrasing, or simply wrong. **Nothing downstream may assume this
layer ran at all.** Its value is in user experience and in reducing load
on the layers below, not in enforcement.

**Related control:** columns the executing role cannot read are withheld
from the prompt entirely (`RESTRICTED_COLUMNS`), so the model does not
generate SQL that would be refused at execution. That fixes a cause, not
a symptom, but it is not a security boundary — it just stops a legitimate
user meeting an error that looks like a bug.

---

## Layer 2 — AST guardrail

**Where:** `app/safety/guardrails.py`
**Runs:** on the generated SQL, before execution

Parses with `sqlglot` and blocks on structure rather than keywords: DDL
statement types, DML statement types, anything that is not a read-only
query, multiple statements, subquery nesting beyond a depth limit, and a
denylist of functions that change session or server state. It also
injects a row limit when none is present.

**Catches:** every destructive statement *type*, stacked statements, and
the specific function calls that would rewrite session state from inside
a plain `SELECT`. Structural checks do not care how a statement is spelled,
so obfuscation of a `DROP` does not help.

**Does not catch:**

- **Semantically wrong but structurally valid SQL.** A `SELECT` that joins
  the wrong tables and returns confident nonsense passes every check here.
  That is the confidence pipeline's job, not this layer's.
- **Anything the denylist does not name.** The function denylist is a
  denylist, and is documented in the code as noise reduction rather than
  a control. It cannot anticipate a function that gains state-changing
  behaviour in a future PostgreSQL.
- **Authorisation.** It has no idea who is asking.

---

## Layer 3 — Read-only database role

**Where:** `app/db.py::get_readonly_engine()`, `seed/27_readonly_role.sql`
**Runs:** at connection time, for every executed statement

Generated SQL executes as `readonly_app`: not a superuser, no `BYPASSRLS`,
owner of nothing, granted `SELECT` and nothing else. Column-level grants
additionally remove specific columns from its reach entirely
(`faculty.salary`, `students.category`, `students.blood_group`), because
row policies cannot filter columns.

**Catches:** every write, whatever layer 2 missed. A guardrail bypass that
produces a valid `DELETE` still fails at the database. It is the reason
layer 2's failure is recoverable.

**Does not catch:** reads. A role that may read a table may read all of
it, absent a row policy. This layer is about *what kind* of operation is
permitted, not *which rows*.

**How its failure was made loud:** `get_readonly_engine()` used to fall
back to `DATABASE_URL` when unconfigured, which silently ran generated SQL
as the owning superuser. It now refuses to construct, and
`app/startup_checks.py` aborts boot if the resolved role is a superuser or
holds `BYPASSRLS`. Both exist because this layer's absence is invisible on
the happy path — a privileged connection returns identical results.

---

## Layer 4 — Row Level Security, bound by a backend-keyed session map

**Where:** `seed/30_session_map.sql`, `seed/31_rls_policies.sql`,
`app/safety/session_scope.py`
**Runs:** inside the database, on every row considered

Eleven tables carry policies; fourteen reference tables deliberately carry
none. Policies resolve identity through `app.current_student_id()` and
friends, which read `app.session_map` keyed on **`(pid, backend_start)`** —
the executing backend's process id and start time. Neither is settable
from SQL. The row is written by the privileged connection before the query
begins; the executing role has `SELECT` on that table and nothing else.

**Catches:** cross-user reads, in *any query shape*. Enforcement happens
during row evaluation inside PostgreSQL, so joins, CTEs, `LATERAL`, window
functions, `UNION` arms, correlated subqueries and aggregates are all
filtered identically. This is the reason for choosing RLS over injecting
predicates into generated SQL: a predicate injector must be correct for
every query shape a model can produce, and this does not.

**Fails closed by SQL semantics, not by vigilance.** The accessors return
`NULL` when there is no valid mapping, so `student_id = NULL` is `NULL`,
not `TRUE`, and the row is excluded. An unbound session sees zero rows on
every table, with no guard clause anyone could forget to write.

**Does not catch:**

- **Aggregates over the user's own data being wrong.** Correct scoping is
  not correct answering.
- **Inference from absence.** A user can learn that a row they cannot see
  exists, from a count that does not add up or a foreign key that resolves
  to nothing.
- **Column-level exposure.** RLS has no column dimension. That is why
  layer 3 carries column grants.

---

## Who sees what: the faculty scope principle

RLS decides which rows each principal reaches. *Which* rows a faculty member
**should** reach is a product decision, not a schema one, and it was made
explicitly rather than inherited from whatever the first policy happened to
say. The principle, in one line each:

- **Teaching-relevant data is scoped by the teaching relation.** A faculty
  member sees a student's academic record where — and only where — they
  teach it.
- **Institutional facts are scoped by department.** A faculty member is
  entitled to know who is in their department.
- **Financial and placement data is closed entirely.** No teaching relation
  grants it, because none is relevant to teaching.

Applied to the eleven policied tables:

| table | faculty relation | rows for `faculty1` |
|---|---|---|
| `students` | department | 311 |
| `attendance` | act performed (rows they recorded) | 2,410 |
| `marks` | teaching, per mark | 467 |
| `student_section_mapping` | teaching, per student | 265 |
| `faculty`, `faculty_subject_assignments` | directory; any bound session | 100 / 130 |
| `fee_payments`, `library_transactions` | none — closed | 0 |
| `placement_applications`, `placement_offers` | none — closed | 0 |
| `student_enrollments` | none — closed, see below | 0 |

### Three different relations, on purpose

`attendance` is scoped by **the act performed** — the faculty member who
recorded the row. `students` is scoped by **department**. `marks` and
`student_section_mapping` are scoped by **teaching**. These are three
different relations in one schema, and that is intentional rather than
drift, because they answer three different questions:

- *Whose attendance record is this?* — the person who took it is the person
  accountable for it.
- *Who is in my department?* — an institutional fact, true regardless of
  what anyone teaches.
- *Whose marks may I read?* — the ones I am responsible for assessing.

Scoping all three by department would be simpler and wrong: it would let a
lecturer read marks for students in subjects they have never taught. On the
seeded data the department relation admits **5,352 marks against the
teaching relation's 467**, an order of magnitude wider for no teaching
purpose.

That gap is also why every faculty isolation test asserts **row identity and
never row count**. A policy accidentally written against the department
relation still returns "some rows, fewer than admin" — exactly what a count
assertion checks and passes. Only identity separates the two relations.
`test_faculty_marks_are_not_the_department_relation` pins this directly: it
finds marks in the faculty member's department that they teach nothing of,
and asserts those are invisible.

### "My students" is approximated, and the approximation errs closed

`student_enrollments` records enrolment in a **programme and semester** and
carries no `offering_id`. There is therefore no edge in this schema from a
teaching assignment to an enrolled student. The teaching relation is
reconstructed instead from **marks** — a student a faculty member has
assessed in an offering they teach.

Consequence, accepted: a student who is taught but not yet examined is not
visible. That errs closed, which is the right direction, but it means the
set grows as assessment happens rather than at enrolment time.

### `student_enrollments` is closed, and the reason is the interesting part

Two independent grounds, the second decisive.

**The schema cannot express a teaching relation here**, per the missing
edge above. The only available predicates were department or programme,
neither of which is a teaching relation.

**And a scoped policy here would be worse than no access.** The realistic
faculty question against this table is an institution-wide aggregate — *how
many students enrolled in each academic year?* Under **any** scoped policy
that query returns a smaller number with nothing marking it partial. The
faculty member reads a plausible answer to a question the system did not
actually answer. Closed, the same query returns zero rows, which is visibly
wrong.

A loud wrong answer beats a quiet one. This is also a limit of
`result_sanity`: an empty result trips a penalty, and a silently-narrowed
count trips nothing at all. The honest failure is the one the detector can
see.

`test_faculty_enrollment_aggregate_is_empty_not_partial` pins the decision,
so that adding a faculty branch here later fails a test and forces a reader
back to this reasoning rather than quietly widening it.

### The elevated helpers

`app.current_faculty_offerings()` and `app.current_faculty_taught_students()`
are `SECURITY DEFINER`, joining `app.current_faculty_department()`. Three
properties matter:

- **They take no arguments.** A helper taking a `student_id` would be a
  boolean oracle a caller could steer — *do you teach student 87?* — and
  generated SQL is attacker-influenced input. With no argument there is
  nothing to steer.
- **`search_path` is pinned**, so an elevated body cannot be redirected at a
  different `faculty_subject_assignments`.
- **Elevation buys independence.** `faculty_subject_assignments` carries its
  own policy. Without `DEFINER`, narrowing that policy would silently narrow
  what faculty see in `marks` — one table's policy changing another's
  meaning, invisible until someone noticed missing rows.

They return the empty set when `app.current_faculty_id()` is NULL, so a
student or an unbound session matches nothing. Fail-closed, like every other
accessor.

---

## Applying a policy change: two instances, both of them

**There are two PostgreSQL instances, and a policy change must be applied to
both and verified separately.**

| instance | reached at | used by |
|---|---|---|
| host | `localhost:5432` | the test suite, and anything run from the host venv |
| container (`db` service) | `localhost:5433` from the host, `db:5432` inside the compose network | the running API |

Applying `seed/31_rls_policies.sql` to one leaves the other on the old
policy. The failure is quiet in the worst way: the tests pass against a host
database that has the change while the live app enforces the old rules, or
the reverse — the app behaves correctly in a demo while the suite asserts
against stale policy. Neither side errors.

Apply, then verify each independently:

```bash
# container
cat seed/31_rls_policies.sql | docker compose exec -T db psql -U app -d college_erp -v ON_ERROR_STOP=1
# host
./venv/Scripts/python.exe -c "import io; from app.db import get_engine; \
  get_engine().begin().__enter__().exec_driver_sql(io.open('seed/31_rls_policies.sql', encoding='utf-8').read())"
# then read the policy back from BOTH, not just the one you changed last
```

### `psql -f /dev/stdin` is a silent no-op here

```bash
docker compose exec -T db psql ... -f /dev/stdin < file.sql   # DO NOT
cat file.sql | docker compose exec -T db psql ...             # do this
```

The first form reports `SET`, `CREATE POLICY`, `GRANT` and exits zero while
applying nothing from the file. `ON_ERROR_STOP=1` does not help, because
there is no error — there is no input.

This belongs in the same family as the six cases in `eval/FINDINGS.md` §9:
**a check that succeeded and did nothing.** The command's own output is
honest about each statement it ran; it simply ran statements from somewhere
other than the file you passed. As everywhere else in this project, the
verification that works is reading the state back from the system itself —
here, `pg_policies` on each instance — rather than trusting the exit code of
the thing that was supposed to change it.

---

## What the layers jointly do not cover

Stated plainly, because these are the residual risks and the paper should
not claim otherwise.

**1. Identity binding was, and partly still is, the weak seam.** The
standard RLS pattern stores the caller in a session GUC. Generated SQL can
rewrite that GUC from inside a plain `SELECT`, which bypassed a live policy
in nine of ten query shapes tested. `current_user` is no escape either,
because `role` is itself a writable GUC. The backend-keyed map removes the
mutable value from the trust path, and is the actual control. The GUC
binding and its post-execution re-assertion are **retained and are now
redundant by design** — they catch a policy accidentally written against
`current_setting()`, which is what every tutorial shows.

**2. A schema browser bypasses RLS entirely, and a policy audit will not
find it.** Introspection must run privileged to be complete, and sample
values and row counts are data reached through a structural API. Both are
now gated on role, and restricted columns are suppressed unconditionally.
The general risk stands for any system exposing schema over a row-scoped
database.

**3. The application-side row check is partial and must not be read as
enforcement.** It asserts that a projected `student_id` or `faculty_id`
belongs to the caller. It cannot see aggregates that drop the identity
column, `COUNT(*)`, aliased or computed ids, or any projection that omits
the id. Its blind spots are asserted by tests so they stay visible.

**4. Confidence under row scoping is uncalibrated.** Three result-sanity
checks cannot distinguish a correctly scoped empty result from a wrong
one, so they report themselves unmeasured and the score fuses over fewer
signals. The isotonic calibrator was fit on unscoped runs and has no claim
over that distribution, so `calibrated=False` is reported rather than a
number that looks principled. Fitting a second calibrator on row-scoped
runs is open work.

**5. Denylists are denylists.** Layer 2's function list and the restricted
column list both enumerate known-bad items. Neither is a boundary.

**6. Nothing here defends the model against being wrong.** Every layer
above constrains what a query may *do* and *see*. None makes a semantically
incorrect answer less likely — that is the confidence pipeline's
territory, and it reports a probability rather than a guarantee.

---

## Verification

Each layer is exercised by tests that assert on behaviour rather than
configuration, after several cases where the reverse passed for the wrong
reason (see `eval/FINDINGS.md` sections 9 through 13).

| layer | representative evidence |
|---|---|
| 1 | refusal-path tests; no schema identifier leaks into any non-success response |
| 2 | 15 attack shapes blocked, 5 legitimate shapes still allowed |
| 3 | startup check asserts the role is non-superuser and non-`BYPASSRLS`; writes and restricted columns refused |
| 4 | 70 `isolation`-marked tests over 13 exfiltration shapes, asserting row identity and never row count |

The `isolation` marker refuses to run on a privileged connection, because
an isolation test that silently acquired superuser would pass while proving
the opposite of its own claim.
