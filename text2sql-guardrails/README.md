# Text-to-SQL Guardrails — Backend Skeleton

Runnable FastAPI skeleton with the API contract locked and the three endpoints
stubbed with mock data. Build the frontend and the real pipeline against this
without either side breaking the other.

## Run it

    cp .env.example .env          # add your LLM key later; not needed for the stub
    docker compose up --build

- API:  http://localhost:8000
- Docs: http://localhost:8000/docs   (interactive, try the endpoints here)
- DB:   Postgres on localhost:5432 (user app / pass app / db sample_shop)

Or without Docker:

    pip install -r requirements.txt
    uvicorn app.main:app --reload

## Endpoints

| Method | Path         | Returns          | Screen it powers        |
|--------|--------------|------------------|-------------------------|
| POST   | /v1/query    | QueryResponse    | Main query workspace    |
| GET    | /v1/schema   | SchemaResponse   | Schema Explorer         |
| GET    | /v1/history  | HistoryResponse  | History panel           |
| GET    | /health      | status           | —                       |

The stub routes on keywords so the UI feels alive:
- question with `drop`/`delete`/`alter` -> **BLOCKED** response
- question with `revenue` -> **CLARIFICATION** response
- anything else -> **SUCCESS** response (top-customers example)

## The contract

`app/api/models.py` is the single source of truth. The frontend reads
`QueryResponse` — its `confidence.signals` array maps 1:1 to the five bars on
your confidence card, and `status` drives which view the UI shows.

## Replacing the mocks (order matters)

Each handler in `app/api/routes.py` has a numbered TODO. Fill them in as:
schema retriever -> generation -> guardrails -> pre-exec detectors ->
sandbox -> post-exec detectors -> confidence fusion. The contract stays fixed
throughout, so the frontend keeps working the whole time.

## Next build targets

1. `app/schema/introspect.py` — SQLAlchemy `inspect()` -> real /v1/schema
2. `app/safety/guardrails.py` — sqlglot AST checks (code is in your plan doc)
3. `app/generation/` — LLM client + prompt builder
4. `app/detection/` — the four detectors + confidence fusion
