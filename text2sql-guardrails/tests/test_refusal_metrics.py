"""Unit tests for eval.metrics.refusal_accuracy() / clarification_accuracy()
-- pure functions over plain dicts, no DB, no LLM. Covers the
refusal_kind split (REFUSED="unsafe" vs CLARIFICATION_NEEDED="ambiguous")
added after the smoke test showed an ambiguous question ("Show me the
good students") being misreported as a safety refusal."""
from __future__ import annotations

from eval.metrics import clarification_accuracy, refusal_accuracy

_ADVERSARIAL_LLM_MEDIATED = {
    "id": "g_adv", "answerable": False, "adversarial": True, "direct_sql": False,
}
_ADVERSARIAL_DIRECT_SQL = {
    "id": "g_adv_direct", "answerable": False, "adversarial": True, "direct_sql": True,
}
_UNANSWERABLE = {
    "id": "g_unans", "answerable": False, "adversarial": False,
}
_ANSWERABLE = {
    "id": "g_ok", "answerable": True, "adversarial": False,
}


def test_refusal_accuracy_counts_adversarial_llm_mediated_refused():
    golden = [_ADVERSARIAL_LLM_MEDIATED]
    predictions = {"g_adv": {"status": "refused"}}
    assert refusal_accuracy(golden, predictions) == 1.0


def test_refusal_accuracy_excludes_direct_sql_adversarial():
    """direct_sql cases bypass generation via sql_override -- they can
    never produce status=refused, so they must not appear in the
    denominator (would make a perfect direct_sql-blocking system look
    like it has a 0% refusal rate on a case it was never meant to
    refuse)."""
    golden = [_ADVERSARIAL_DIRECT_SQL]
    predictions = {"g_adv_direct": {"status": "blocked"}}
    # Empty population after filtering -> defined as 0.0, not an error,
    # and NOT counted as a failure against a real case.
    assert refusal_accuracy(golden, predictions) == 0.0


def test_refusal_accuracy_does_not_count_clarification_as_correct():
    """The whole point of the split: a case reported as 'clarification'
    (ambiguous) must not count as a correct 'refused' (unsafe) outcome --
    they measure different capabilities."""
    golden = [_ADVERSARIAL_LLM_MEDIATED]
    predictions = {"g_adv": {"status": "clarification"}}
    assert refusal_accuracy(golden, predictions) == 0.0


def test_refusal_accuracy_excludes_unanswerable_non_adversarial():
    """Legitimately unanswerable questions belong to
    clarification_accuracy(), not refusal_accuracy() -- see the mirror
    test below."""
    golden = [_UNANSWERABLE]
    predictions = {"g_unans": {"status": "refused"}}
    assert refusal_accuracy(golden, predictions) == 0.0


def test_clarification_accuracy_counts_unanswerable_clarification():
    golden = [_UNANSWERABLE]
    predictions = {"g_unans": {"status": "clarification"}}
    assert clarification_accuracy(golden, predictions) == 1.0


def test_clarification_accuracy_does_not_count_refused_as_correct():
    golden = [_UNANSWERABLE]
    predictions = {"g_unans": {"status": "refused"}}
    assert clarification_accuracy(golden, predictions) == 0.0


def test_clarification_accuracy_excludes_adversarial():
    """Adversarial cases belong to refusal_accuracy()/block_accuracy(),
    never clarification_accuracy() -- even if one happened to come back
    'clarification' (e.g. a borderline-phrased adversarial question)."""
    golden = [_ADVERSARIAL_LLM_MEDIATED]
    predictions = {"g_adv": {"status": "clarification"}}
    assert clarification_accuracy(golden, predictions) == 0.0


def test_error_status_never_counts_as_correct_in_either_metric():
    golden = [_ADVERSARIAL_LLM_MEDIATED, _UNANSWERABLE]
    predictions = {
        "g_adv": {"status": "error"},
        "g_unans": {"status": "error"},
    }
    assert refusal_accuracy(golden, predictions) == 0.0
    assert clarification_accuracy(golden, predictions) == 0.0


def test_answerable_cases_never_enter_either_population():
    golden = [_ANSWERABLE]
    predictions = {"g_ok": {"status": "success"}}
    # Empty populations after filtering -> both defined as 0.0.
    assert refusal_accuracy(golden, predictions) == 0.0
    assert clarification_accuracy(golden, predictions) == 0.0
