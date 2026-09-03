"""Unit tests for eval.metrics.execution_match -- pure AST/comparison
logic, no DB, no LLM. See eval/README.md for the full writeup of the
aggregate-column positional fallback these tests exercise."""
from __future__ import annotations

from eval.metrics import execution_match, gold_sql_has_top_level_order_by


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


# --- strict mode: each disables one of eval/README.md's four departures ---


def test_strict_column_count_mismatch_fails_fast():
    """Departure #1 (name-based projection, generous superset) is fully
    off in strict mode -- pred returning an extra column beyond gold's is
    now a hard fail, not tolerated."""
    pred_sql = "SELECT student_id, first_name, status FROM students;"
    gold_sql = "SELECT student_id, first_name FROM students;"
    assert not execution_match(
        pred_sql, ["student_id", "first_name", "status"], [[1, "Alice", "ACTIVE"]],
        gold_sql, ["student_id", "first_name"], [[1, "Alice"]],
        ordered=False, strict=True,
    )


def test_strict_matches_by_value_permutation_not_name():
    """Strict mode doesn't match columns by name at all -- differently
    named/ordered columns with the same equal-count values still match, a
    strictly more general replacement for the permissive path's aggregate-
    kind fallback (this works for plain columns too, which that fallback
    never covered)."""
    pred_sql = "SELECT first_name AS fn, student_id AS sid FROM students;"
    gold_sql = "SELECT student_id, first_name FROM students;"
    assert execution_match(
        pred_sql, ["fn", "sid"], [["Alice", 1]],
        gold_sql, ["student_id", "first_name"], [[1, "Alice"]],
        ordered=False, strict=True,
    )


def test_strict_requires_exact_multiset_equality_not_subset():
    """Departure #2 is off: a prediction missing rows gold has now fails,
    where the permissive subset match would have passed it."""
    pred_sql = "SELECT department_id FROM students;"
    gold_sql = "SELECT department_id FROM students;"
    assert execution_match(
        pred_sql, ["department_id"], [[1], [2]],
        gold_sql, ["department_id"], [[1], [2]],
        ordered=False, strict=True,
    )
    assert not execution_match(
        pred_sql, ["department_id"], [[1]],  # missing gold's second row
        gold_sql, ["department_id"], [[1], [2]],
        ordered=False, strict=True,
    )


def test_strict_infers_order_sensitivity_from_gold_sql_not_the_ordered_arg():
    """Departure #4 is off: strict mode ignores the caller's `ordered`
    annotation and instead checks gold_sql itself for a top-level ORDER BY.
    Passing ordered=False here must not matter -- gold_sql has ORDER BY, so
    row order is still enforced and an out-of-order prediction still fails."""
    pred_sql = "SELECT student_id FROM students ORDER BY student_id;"
    gold_sql = "SELECT student_id FROM students ORDER BY student_id;"
    assert gold_sql_has_top_level_order_by(gold_sql)
    assert execution_match(
        pred_sql, ["student_id"], [[1], [2]],
        gold_sql, ["student_id"], [[1], [2]],
        ordered=False, strict=True,
    )
    assert not execution_match(
        pred_sql, ["student_id"], [[2], [1]],  # right rows, wrong order
        gold_sql, ["student_id"], [[1], [2]],
        ordered=False, strict=True,
    )


def test_gold_sql_has_top_level_order_by_false_when_absent():
    assert not gold_sql_has_top_level_order_by("SELECT student_id FROM students;")
