"""
W5: what GET /v1/schema is allowed to disclose, and to whom.

The hole this closes is documented at length in eval/FINDINGS.md section
13. In short: introspection runs on the OWNING connection, because reading
catalogs completely requires it, and owners bypass Row Level Security
unconditionally. Two of the things it returns are data rather than
structure -- sample values (a DISTINCT per column) and row estimates (a
COUNT(*) per table) -- so before this gating a student could read five real
values from every column of every table through an endpoint called
"schema", with no policy able to intervene.

The rule these tests pin down:

    structure  -> everyone      (tables, columns, types, keys)
    data       -> admins only   (sample values, row estimates)
"""
from __future__ import annotations

import inspect

import pytest

from app.schema.introspect import RESTRICTED_COLUMNS, introspect_schema


@pytest.fixture(scope="module")
def structure_only():
    return introspect_schema(include_samples=False, include_row_estimates=False)


@pytest.fixture(scope="module")
def full():
    return introspect_schema(include_samples=True, include_row_estimates=True)


# --- structure is visible to everyone --------------------------------------

def test_every_table_is_listed_regardless_of_disclosure_level(structure_only, full):
    assert {t.name for t in structure_only.tables} == {t.name for t in full.tables}
    assert len(structure_only.tables) == 25


def test_every_column_is_listed_regardless_of_disclosure_level(structure_only, full):
    """Hiding a column NAME protects nothing -- an operator is entitled to
    know the shape of the database, and the same information is in any ER
    diagram. Only the values are withheld."""
    def names(schema):
        return {(t.name, c.name) for t in schema.tables for c in t.columns}
    assert names(structure_only) == names(full)


def test_restricted_columns_are_still_listed(structure_only):
    """They are removed from the GENERATION schema, not from the browser."""
    for table, columns in RESTRICTED_COLUMNS.items():
        listed = {c.name for t in structure_only.tables if t.name == table for c in t.columns}
        assert columns <= listed, f"{table}: {columns - listed} vanished from the listing"


def test_keys_and_types_survive_the_structure_only_path(structure_only):
    students = next(t for t in structure_only.tables if t.name == "students")
    pk = [c for c in students.columns if c.is_primary_key]
    fk = [c for c in students.columns if c.is_foreign_key]
    assert pk and fk, "structure must remain complete when data is withheld"
    assert all(c.data_type for c in students.columns)


# --- data is withheld ------------------------------------------------------

def test_structure_only_returns_no_sample_values(structure_only):
    leaked = [(t.name, c.name) for t in structure_only.tables
              for c in t.columns if c.sample_values]
    assert leaked == [], f"sample values leaked without admin: {leaked[:5]}"


def test_structure_only_returns_no_row_estimates(structure_only):
    leaked = [t.name for t in structure_only.tables if t.row_estimate is not None]
    assert leaked == [], f"row estimates leaked without admin: {leaked[:5]}"


def test_withheld_row_estimate_is_none_not_zero(structure_only):
    """None already exists in the contract. Zero would read as an empty
    table, which is a different and false claim."""
    assert all(t.row_estimate is None for t in structure_only.tables)


def test_admin_level_disclosure_actually_includes_the_data(full):
    """The counterpart: gating must not have broken the admin view."""
    assert any(c.sample_values for t in full.tables for c in t.columns)
    assert all(t.row_estimate is not None for t in full.tables)


def test_restricted_columns_never_carry_samples_even_at_admin_level(full):
    """The one thing role gating does NOT cover. Introspection runs as the
    owner, so there is no role to gate on at that layer -- suppression has
    to be unconditional."""
    for table, columns in RESTRICTED_COLUMNS.items():
        for col in (c for t in full.tables if t.name == table
                    for c in t.columns if c.name in columns):
            assert col.sample_values == [], f"{table}.{col.name} exposed samples to an admin"


# --- the wiring ------------------------------------------------------------

def test_the_two_disclosures_are_separately_switchable():
    params = inspect.signature(introspect_schema).parameters
    assert "include_samples" in params
    assert "include_row_estimates" in params


def test_per_query_paths_ask_for_structure_only():
    """Generation and schema_align run on EVERY query. Row estimates are a
    COUNT(*) per table over 25 tables, which is pure latency for checks
    that only compare identifiers -- and a disclosure they have no use
    for."""
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    for rel in ("app/generation/generator.py", "app/detection/schema_align.py"):
        src = (root / rel).read_text(encoding="utf-8")
        assert "include_row_estimates=False" in src, f"{rel} still computes row estimates"


def test_the_schema_route_gates_on_the_principal():
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "app/api/routes.py").read_text(encoding="utf-8")
    assert "include_samples=principal.is_admin" in src
    assert "include_row_estimates=principal.is_admin" in src
