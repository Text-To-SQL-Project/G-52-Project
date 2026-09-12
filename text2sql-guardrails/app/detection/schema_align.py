"""
Schema-alignment detector: confirms that every table/column the generated
SQL references actually exists in the live database. Feeds the
'schema_alignment' entry in Confidence.signals (replacing the fixed mock
value). Pure post-hoc check -- runs after guardrails pass, before execution
(step 4, "detection (pre)", in the pipeline order documented in
app/api/routes.py::run_query()'s docstring).
"""
from __future__ import annotations

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError

from app.api.models import ConfidenceSignal, SignalStatus
from app.schema.introspect import introspect_schema


def check_schema_alignment(sql: str) -> ConfidenceSignal:
    try:
        stmt = sqlglot.parse_one(sql, dialect="postgres")
    except ParseError as e:
        return ConfidenceSignal(
            key="schema_alignment",
            label="Schema Alignment",
            score=0.0,
            status=SignalStatus.FAIL,
            detail=f"Could not parse SQL to check schema alignment: {e}",
        )

    # --- what the query references --------------------------------------
    # CTE names (WITH x AS (...)) are indistinguishable from real table
    # references in the AST -- both are exp.Table nodes -- so without this,
    # every CTE alias gets checked against (and flagged missing from) the
    # live physical schema. Collect them so they're treated as valid.
    cte_names_lower = {
        c.alias.lower() for c in stmt.find_all(exp.CTE) if getattr(c, "alias", None)
    }

    tables = list(stmt.find_all(exp.Table))
    referenced_tables = sorted({
        t.name for t in tables if t.name.lower() not in cte_names_lower
    })
    alias_map = {(t.alias or t.name): t.name for t in tables}

    # Output aliases (e.g. COUNT(*) AS student_count) are valid to reference
    # unqualified in ORDER BY/GROUP BY/HAVING -- they aren't real columns,
    # so they must be excluded or every aggregate query would false-positive.
    output_aliases = {
        e.alias for e in stmt.selects if getattr(e, "alias", None)
    } if isinstance(stmt, exp.Select) else set()

    columns = list(stmt.find_all(exp.Column))
    referenced_columns: list[tuple[str | None, str]] = []
    for c in columns:
        if not c.table and c.name in output_aliases:
            continue
        resolved_table = alias_map.get(c.table) if c.table else (
            referenced_tables[0] if len(referenced_tables) == 1 else None
        )
        if resolved_table is not None and resolved_table.lower() in cte_names_lower:
            # Can't validate a CTE's own output columns without analyzing
            # the CTE body itself -- skip rather than false-positive.
            continue
        referenced_columns.append((resolved_table, c.name))

    total = len(referenced_tables) + len(referenced_columns)
    if total == 0:
        return ConfidenceSignal(
            key="schema_alignment",
            label="Schema Alignment",
            score=1.0,
            status=SignalStatus.PASS,
            detail="No table/column references to validate.",
        )

    # --- live schema universe -------------------------------------------
    # Structure only. This runs on EVERY query, and a COUNT(*) per table
    # over 25 tables is pure latency for a check that only compares
    # identifiers.
    live = introspect_schema(include_samples=False, include_row_estimates=False)
    live_tables = {t.name.lower(): {c.name.lower() for c in t.columns} for t in live.tables}

    missing_tables = [t for t in referenced_tables if t.lower() not in live_tables]

    missing_columns: list[str] = []
    for resolved_table, col_name in referenced_columns:
        if resolved_table is not None:
            table_cols = live_tables.get(resolved_table.lower())
            if table_cols is None or col_name.lower() not in table_cols:
                missing_columns.append(f"{resolved_table}.{col_name}")
        else:
            # ambiguous (no alias, multiple tables) -- pass if it exists in ANY
            if not any(col_name.lower() in cols for cols in live_tables.values()):
                missing_columns.append(f"?.{col_name}")

    n_bad = len(missing_tables) + len(missing_columns)
    score = max(0.0, (total - n_bad) / total)

    if n_bad == 0:
        status = SignalStatus.PASS
        detail = f"All {len(referenced_tables)} tables, {len(referenced_columns)} columns exist."
    else:
        parts = []
        if missing_tables:
            parts.append(f"missing table(s): {', '.join(missing_tables)}")
        if missing_columns:
            parts.append(f"missing column(s): {', '.join(missing_columns)}")
        detail = "; ".join(parts) + "."
        status = SignalStatus.FAIL if missing_tables or score < 0.5 else SignalStatus.WARN

    return ConfidenceSignal(
        key="schema_alignment",
        label="Schema Alignment",
        score=round(score, 2),
        status=status,
        detail=detail,
    )
