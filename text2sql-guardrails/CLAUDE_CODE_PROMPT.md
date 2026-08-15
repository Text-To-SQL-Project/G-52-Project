# Run this in Claude Code (VS Code)

You have the backend skeleton and your real dataset locally. Claude Code can
read both — I can't reach your `C:\Users\dell\Desktop\Text-to-SQL` folder from
the chat, so this is the step to hand to Claude Code.

## Setup (once)

1. Unzip `text2sql-guardrails-skeleton.zip` into your project folder, e.g.
   `C:\Users\dell\Desktop\Text-to-SQL\backend`.
2. Open that folder in VS Code with Claude Code active.
3. Paste the prompt below into Claude Code.

---

## Prompt to paste into Claude Code

```
I have a FastAPI Text-to-SQL skeleton in this folder and my dataset/database
files in C:\Users\dell\Desktop\Text-to-SQL. Do the following, in order, and
show me the result of each step:

1. Inspect C:\Users\dell\Desktop\Text-to-SQL and tell me exactly what data
   files are there and their format (SQLite .db/.sqlite, CSV files, a .sql
   dump, or something else). List table/file names and a few columns each.

2. Set up a Python venv and install requirements.txt.

3. Connect the API to my real data using the SIMPLEST path that fits:
   - If there's already a SQLite database file: create a .env from
     .env.example and set
       DATABASE_URL=sqlite:///C:/Users/dell/Desktop/Text-to-SQL/<exact_file>.db
     (three slashes, forward slashes in the path). No Docker needed.
   - If the data is CSV files: run
       python -m scripts.load_dataset "C:/Users/dell/Desktop/Text-to-SQL"
     which loads each CSV into the DB (default SQLite). Confirm the tables.
   - If it's a .sql Postgres dump: bring up docker-compose, load the dump into
     the Postgres container, and leave DATABASE_URL pointing at Postgres.

4. Do NOT change app/api/models.py — the API contract is fixed on purpose.

5. Start the API (uvicorn app.main:app --reload) and call GET /v1/schema.
   Verify it returns MY real tables and columns (not the sample customers/
   orders mock). If it still shows the mock, the DB isn't connected — debug
   the connection until /v1/schema shows my real schema.

6. Update the mock in app/api/mock_data.py so the /v1/query SUCCESS example
   uses a REAL table and columns from my dataset (a simple, sensible query
   like a top-N or a count over one of my actual tables). Keep the exact same
   response shape/fields. This keeps the stub realistic until generation is built.

7. Run a quick check: GET /health, GET /v1/schema, GET /v1/history, and
   POST /v1/query with a plain-English question. Paste the /v1/query JSON so
   I can confirm the shape matches the contract.

Report what data format you found, what connection method you used, and the
final /v1/schema output.
```

---

## What should be true when it's done

- `GET /v1/schema` returns **your** tables/columns, pulled live by
  `app/schema/introspect.py` (which is dataset-agnostic — it discovers
  whatever exists, nothing hardcoded).
- The `/v1/query` mock references a real table from your data.
- `app/api/models.py` is untouched — your Stitch frontend still binds to the
  same `QueryResponse` / `confidence.signals` shape.

## Fast path if you'd rather I tailor it here

If you just paste me the output of one of these, I'll hand-write the exact
introspection result, the seed, and a real `/v1/query` example for your data:

- SQLite:  `python -c "import sqlite3,glob;print([ (t[0],[c[1] for c in sqlite3.connect(f).execute('PRAGMA table_info('+t[0]+')')]) for f in glob.glob(r'C:/Users/dell/Desktop/Text-to-SQL/*.db')+glob.glob(r'C:/Users/dell/Desktop/Text-to-SQL/*.sqlite') for t in sqlite3.connect(f).execute(\"SELECT name FROM sqlite_master WHERE type='table'\")])"`
- CSVs:    the header row (first line) of each CSV, plus the filenames.
- .sql:    the `CREATE TABLE` statements from the dump.
