-- app/db.py::get_readonly_engine() -- the engine that actually runs
-- generated SQL -- is meant to map to a SELECT-only Postgres role in
-- production ("second line of defence behind the guardrails: even a
-- guardrail miss cannot write"). This creates that role for the Docker
-- stack; READONLY_DATABASE_URL in docker-compose.yml points at it.
SET search_path TO college_erp;

CREATE ROLE readonly_app WITH LOGIN PASSWORD 'readonly_app';
ALTER ROLE readonly_app SET search_path TO college_erp, public;

GRANT CONNECT ON DATABASE college_erp TO readonly_app;
GRANT USAGE ON SCHEMA college_erp TO readonly_app;
GRANT SELECT ON ALL TABLES IN SCHEMA college_erp TO readonly_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA college_erp GRANT SELECT ON TABLES TO readonly_app;
