-- 00_schema.sql's `SET search_path TO college_erp;` only applies to that
-- script's own session (docker-entrypoint-initdb.d runs every *.sql file
-- as a separate psql invocation). This sets a DATABASE-level default so
-- that every future connection -- including the API container's -- sees
-- the college_erp schema without needing a per-connection search_path
-- override in DATABASE_URL/READONLY_DATABASE_URL.
ALTER DATABASE college_erp SET search_path TO college_erp, public;
