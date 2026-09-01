-- Application-internal table for the History screen (app.history.py).
-- Deliberately in its own `app` schema, NOT `college_erp`: introspect_schema()
-- (via SQLAlchemy's Inspector.get_table_names(), which resolves against
-- current_schema() -- the first entry in search_path, set to college_erp by
-- 01_search_path.sql) only ever sees the college_erp schema's tables. Putting
-- this table there instead means it can never leak into the Schema Explorer
-- or into the LLM's own generation prompt as a "queryable" table -- it isn't
-- domain data, it's the app's own bookkeeping.
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.query_history (
    id                BIGSERIAL PRIMARY KEY,
    query_id          TEXT NOT NULL UNIQUE,
    session_id        TEXT NOT NULL,
    question          TEXT NOT NULL,
    -- Real (untruncated-at-storage) SQL/reason -- may be schema-bearing.
    -- app/history.py substitutes the same generic client message
    -- GET /v1/history serves as POST /v1/query did, for every status
    -- except SUCCESS and BLOCKED (blocked_reasons is already schema-safe,
    -- see app/api/routes.py's audit comment). Real values are what a
    -- future authenticated admin view (Task 4) will read directly.
    sql_preview       TEXT,
    status            TEXT NOT NULL,
    status_reason     TEXT,
    confidence_score  DOUBLE PRECISION,
    row_count         INTEGER,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_query_history_session
    ON app.query_history (session_id, created_at DESC);
