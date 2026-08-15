"""
Real schema introspection. Dataset-agnostic: it discovers whatever tables
and columns actually exist in the connected database — nothing is hardcoded.

Powers GET /v1/schema (the Schema Explorer screen) and, later, the
schema-aware prompt builder in app/generation/.

Works with any SQLAlchemy-supported DB: a local SQLite file OR Postgres.
"""
from __future__ import annotations

from sqlalchemy import inspect, text

from app.api.models import ColumnInfo, SchemaResponse, TableInfo
from app.db import get_engine


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


def introspect_schema(include_samples: bool = True) -> SchemaResponse:
    """Return the live schema of the connected database."""
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
                columns.append(
                    ColumnInfo(
                        name=name,
                        data_type=str(col["type"]),
                        nullable=bool(col.get("nullable", True)),
                        is_primary_key=name in pk_cols,
                        is_foreign_key=name in fk_map,
                        references=fk_map.get(name),
                        sample_values=(
                            _sample_values(conn, table_name, name)
                            if include_samples else []
                        ),
                    )
                )

            tables.append(
                TableInfo(
                    name=table_name,
                    columns=columns,
                    row_estimate=_row_estimate(conn, table_name),
                )
            )

    return SchemaResponse(
        database=engine.url.database or "database",
        tables=tables,
        total_tables=len(tables),
        total_columns=sum(len(t.columns) for t in tables),
    )
