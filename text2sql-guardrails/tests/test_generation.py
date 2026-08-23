"""Unit tests for app.generation.generator.is_noop_sql -- pure AST logic,
no LLM call, no DB needed."""
from __future__ import annotations

from app.generation.generator import is_noop_sql


def test_where_false_literal_is_noop():
    assert is_noop_sql("SELECT 1 WHERE FALSE LIMIT 1000;")


def test_select_null_where_false_is_noop():
    assert is_noop_sql("SELECT NULL WHERE FALSE LIMIT 1000;")


def test_where_always_false_numeric_comparison_is_noop():
    assert is_noop_sql("SELECT 1 WHERE 1 = 0;")


def test_select_null_no_from_is_noop():
    assert is_noop_sql("SELECT NULL;")


def test_select_constant_list_no_from_is_noop():
    assert is_noop_sql("SELECT 1, 'x', NULL;")


def test_real_query_with_filter_is_not_noop():
    assert not is_noop_sql(
        "SELECT student_id, first_name, last_name FROM students "
        "WHERE status = 'ACTIVE' LIMIT 1000;"
    )


def test_real_aggregate_query_is_not_noop():
    assert not is_noop_sql("SELECT COUNT(*) FROM students;")


def test_real_query_with_ordinary_filter_is_not_noop():
    assert not is_noop_sql("SELECT * FROM students WHERE department_id = 3;")


def test_where_always_true_is_not_noop():
    assert not is_noop_sql("SELECT student_id FROM students WHERE 1 = 1;")


def test_unparseable_sql_is_not_noop():
    # Must degrade gracefully, not raise -- an unparseable string is
    # someone else's problem (check_guardrails handles that case).
    assert not is_noop_sql("this is not sql at all (((")
