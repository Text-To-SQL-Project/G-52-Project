"""Unit tests for eval.metrics.execution_match -- pure AST/comparison
logic, no DB, no LLM. See eval/README.md for the full writeup of the
aggregate-column positional fallback these tests exercise."""
from __future__ import annotations

from eval.metrics import execution_match


def test_gold_unaliased_aggregate_matches_pred_aliased_aggregate():
    """The pattern found in g025/g030: gold leaves COUNT(*) unaliased
    (column defaults to "count"), pred names it descriptively. Must match
    on the same underlying value."""
    pred_sql = "SELECT COUNT(*) AS absent_count FROM attendance WHERE status = 'ABSENT';"
    gold_sql = "SELECT COUNT(*) FROM attendance WHERE status = 'ABSENT';"
    assert execution_match(
        pred_sql, ["absent_count"], [[1629]],
        gold_sql, ["count"], [[1629]],
        ordered=False,
    )


def test_both_sides_alias_the_same_aggregate_differently():
    """The pattern found in g027: gold aliases SUM(...) AS total, pred
    aliases the same computation AS total_amount. Must match."""
    pred_sql = "SELECT COUNT(*) AS payment_count, SUM(amount_paid) AS total_amount FROM fee_payments;"
    gold_sql = "SELECT COUNT(*) AS payment_count, SUM(amount_paid) AS total FROM fee_payments;"
    assert execution_match(
        pred_sql, ["payment_count", "total_amount"], [[1551, 49334748.35]],
        gold_sql, ["payment_count", "total"], [[1551, 49334748.35]],
        ordered=False,
    )


def test_different_aggregate_kinds_are_never_positionally_matched():
    """A COUNT must never be matched to a SUM just because both are the
    sole unmatched column on their respective sides -- same-kind is
    required, not merely "some aggregate"."""
    pred_sql = "SELECT SUM(amount_paid) AS total FROM fee_payments;"
    gold_sql = "SELECT COUNT(*) FROM students;"
    assert not execution_match(
        pred_sql, ["total"], [[999]],
        gold_sql, ["count"], [[42]],
        ordered=False,
    )


def test_plain_columns_are_not_eligible_for_positional_fallback():
    """Only aggregate expressions get the positional fallback. Two
    unrelated plain column references must not be matched just because
    each is the only unmatched column on its side."""
    pred_sql = "SELECT last_name FROM students;"
    gold_sql = "SELECT first_name FROM students;"
    assert not execution_match(
        pred_sql, ["last_name"], [["Smith"]],
        gold_sql, ["first_name"], [["Alice"]],
        ordered=False,
    )


def test_exact_name_match_still_works_without_fallback():
    """Regression guard: ordinary exact-name column matching (the common
    case) must still work exactly as before -- the fallback should never
    be needed, let alone trigger, here."""
    pred_sql = "SELECT student_id, first_name FROM students WHERE status = 'ACTIVE';"
    gold_sql = "SELECT student_id, first_name FROM students WHERE status = 'ACTIVE';"
    assert execution_match(
        pred_sql, ["student_id", "first_name"], [[1, "Alice"]],
        gold_sql, ["student_id", "first_name"], [[1, "Alice"]],
        ordered=False,
    )


def test_extra_pred_columns_still_ignored_alongside_aggregate_fallback():
    """A prediction can have both an unrelated extra column (ignored, as
    always) and an aggregate needing the positional fallback -- both
    behaviors should compose correctly."""
    pred_sql = "SELECT department_id, COUNT(*) AS n FROM students GROUP BY department_id;"
    gold_sql = "SELECT department_id, COUNT(*) FROM students GROUP BY department_id;"
    assert execution_match(
        pred_sql, ["department_id", "n"], [[1, 10], [2, 20]],
        gold_sql, ["department_id", "count"], [[1, 10], [2, 20]],
        ordered=False,
    )


def test_select_star_disables_positional_fallback_gracefully():
    """SELECT * makes the projection-count vs column-count lengths
    mismatch (one expression, many columns) -- the fallback must decline
    gracefully (name-only matching, no crash) rather than misbehave."""
    pred_sql = "SELECT * FROM students;"
    gold_sql = "SELECT COUNT(*) FROM students;"
    assert not execution_match(
        pred_sql, ["student_id", "first_name"], [[1, "Alice"]],
        gold_sql, ["count"], [[42]],
        ordered=False,
    )
