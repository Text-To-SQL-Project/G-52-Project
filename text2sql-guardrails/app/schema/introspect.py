"""
Real schema introspection. Dataset-agnostic: it discovers whatever tables
and columns actually exist in the connected database — nothing is hardcoded.

Powers GET /v1/schema (the Schema Explorer screen) and, later, the
schema-aware prompt builder in app/generation/.

Works with any SQLAlchemy-supported DB: a local SQLite file OR Postgres.
"""
from __future__ import annotations

import threading
import time

from sqlalchemy import inspect, text

from app.api.models import ColumnInfo, SchemaResponse, TableInfo
from app.config import settings
from app.db import get_engine


# Columns the query-execution role cannot read, because they were removed
# from its grants rather than merely policy-filtered (see
# seed/31_rls_policies.sql). RLS filters rows; a column that must never be
# reachable by a natural-language query has to come out of the grant.
#
# Two different treatments follow from that, and the distinction matters:
#
#   GENERATION  -- the column is omitted entirely. If the model cannot see
#                  it, it does not write SQL that names it, and the user
#                  never meets an error that looks like a bug. Fixing the
#                  cause rather than the symptom.
#   SCHEMA EXPLORER -- the column is still LISTED, because structure is not
#                  data and an operator is entitled to know the column
#                  exists. Its sample values are suppressed, because those
#                  are data.
#
# Sample suppression is unconditional, not tied to the caller: introspection
# runs on the OWNING connection, which can read anything, so without this
# the Schema Explorer would hand every authenticated user five real
# salaries -- a leak the RLS policies have no opportunity to prevent.
RESTRICTED_COLUMNS: dict[str, set[str]] = {
    "faculty": {"salary"},
    # A faculty member sees every student in their department, so these two
    # are not protected by the row policy. A protected social attribute and
    # health data, neither with any teaching necessity. Date of birth and
    # contact details stay readable on purpose -- see seed/32.
    "students": {"category", "blood_group"},
}


def _is_restricted(table: str, column: str) -> bool:
    return column in RESTRICTED_COLUMNS.get(table, ())


def _sample_values(conn, table: str, column: str, limit: int = 5) -> list[str]:
    """Best-effort distinct sample values for a column (for disambiguation)."""
    try:
        # Quote identifiers defensively; works on SQLite and Postgres.
        rows = conn.execute(
            text(f'SELECT DISTINCT "{column}" FROM "{table}" '
                 f'WHERE "{column}" IS NOT NULL LIMIT :n'),
            {"n": limit},
        ).fetchall()
        return [str(r[0]) for r in rows]
    except Exception:
        return []


def _row_estimate(conn, table: str) -> int | None:
    try:
        return conn.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar()
    except Exception:
        return None


def _introspect_live(
    include_samples: bool = True,
    omit_restricted: bool = False,
    include_row_estimates: bool = True,
) -> SchemaResponse:
    """Return the live schema of the connected database.

    `omit_restricted=True` drops RESTRICTED_COLUMNS from the output
    entirely. Used for the generation prompt so the model never learns
    those columns exist and never writes SQL that would be refused at
    execution. Left False for the Schema Explorer, which lists the column
    but never its values.

    `include_samples` and `include_row_estimates` are separate switches
    because they are separate disclosures, and because both are DATA while
    everything else here is structure. This function runs on the OWNING
    connection -- it has to, to read catalogs completely -- so it bypasses
    Row Level Security entirely and no policy can moderate what these two
    return. See eval/FINDINGS.md section 13.

    Both are also the only expensive part: sampling is a DISTINCT per
    column and an estimate is a COUNT(*) per table, which on this schema
    means scanning 150,000 attendance rows. Callers that need only
    structure (generation, schema_align) should turn both off, which is
    both a disclosure decision and a latency one.
    """
    engine = get_engine()
    inspector = inspect(engine)

    tables: list[TableInfo] = []
    with engine.connect() as conn:
        for table_name in inspector.get_table_names():
            pk_cols = set(
                inspector.get_pk_constraint(table_name).get("constrained_columns", [])
            )

            # Map FK columns -> "target_table.target_column"
            fk_map: dict[str, str] = {}
            for fk in inspector.get_foreign_keys(table_name):
                ref_table = fk.get("referred_table")
                for local_col, ref_col in zip(
                    fk.get("constrained_columns", []),
                    fk.get("referred_columns", []),
                ):
                    fk_map[local_col] = f"{ref_table}.{ref_col}"

            columns: list[ColumnInfo] = []
            for col in inspector.get_columns(table_name):
                name = col["name"]
                restricted = _is_restricted(table_name, name)
                if restricted and omit_restricted:
                    continue
                columns.append(
                    ColumnInfo(
                        name=name,
                        data_type=str(col["type"]),
                        nullable=bool(col.get("nullable", True)),
                        is_primary_key=name in pk_cols,
                        is_foreign_key=name in fk_map,
                        references=fk_map.get(name),
                        # Restricted columns never carry samples, whoever is
                        # asking -- this runs on the owning connection.
                        sample_values=(
                            _sample_values(conn, table_name, name)
                            if (include_samples and not restricted) else []
                        ),
                    )
                )

            tables.append(
                TableInfo(
                    name=table_name,
                    columns=columns,
                    # None, not 0, when withheld: the contract already
                    # allows null and it must not read as "empty table".
                    row_estimate=(
                        _row_estimate(conn, table_name)
                        if include_row_estimates else None
                    ),
                )
            )

    return SchemaResponse(
        database=engine.url.database or "database",
        tables=tables,
        total_tables=len(tables),
        total_columns=sum(len(t.columns) for t in tables),
    )


# Structure-only results keyed by omit_restricted. Reflection is ~200 ms and
# every question needed it twice (generator + schema_align); structure only
# changes on admin DDL, which calls invalidate_schema_cache().
# Served stale-while-revalidate, so no request ever waits on reflection.
# ponytail: per-process cache; DDL from outside the app shows up one
# request after SCHEMA_CACHE_SECONDS.
_structure_cache: dict[bool, tuple[float, SchemaResponse]] = {}
_refreshing = threading.Lock()


def introspect_schema(
    include_samples: bool = True,
    omit_restricted: bool = False,
    include_row_estimates: bool = True,
) -> SchemaResponse:
    """See _introspect_live. Samples and row estimates are data, so those
    calls always go live; structure-only calls are served from cache."""
    if include_samples or include_row_estimates:
        return _introspect_live(include_samples, omit_restricted, include_row_estimates)
    hit = _structure_cache.get(omit_restricted)
    if hit is None:
        return _refresh(omit_restricted)
    if time.monotonic() - hit[0] >= settings.SCHEMA_CACHE_SECONDS and _refreshing.acquire(blocking=False):
        # Stale: answer from cache now, re-reflect off the request path.
        def run() -> None:
            try:
                _refresh(omit_restricted)
            finally:
                _refreshing.release()
        threading.Thread(target=run, daemon=True, name="schema-refresh").start()
    return hit[1]


def _refresh(omit_restricted: bool) -> SchemaResponse:
    schema = _introspect_live(False, omit_restricted, False)
    _structure_cache[omit_restricted] = (time.monotonic(), schema)
    return schema


def invalidate_schema_cache() -> None:
    _structure_cache.clear()
