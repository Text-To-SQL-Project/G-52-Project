-- History detail: a snapshot of each successful answer (the QueryResponse:
-- SQL, explanation, confidence breakdown and up to 200 result rows), so a
-- past query can be re-opened in full from the History screen without
-- re-running it. Read only through GET /v1/history/{query_id}, which
-- enforces the same owner-or-admin rule as GET /v1/history.
-- NULL for non-success rows and for rows written before this column existed.
ALTER TABLE app.query_history ADD COLUMN IF NOT EXISTS detail JSONB;
