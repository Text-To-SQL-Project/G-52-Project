"""The interactive latency path: hedged LLM calls, back-translation moved off
the critical path (pending signal + poll endpoint), and the RPM reserve that
keeps background checks from starving interactive questions. No DB, no LLM."""
from __future__ import annotations

import time

import pytest
from fastapi import HTTPException

import app.api.routes as routes
from app.api.models import ConfidenceSignal, SignalStatus
from app.detection.confidence import fuse_confidence
from app.generation import llm_client
from app.generation.llm_client import _hedged
from tests.principals import TEST_FACULTY, TEST_STUDENT


def _sig(key, score, status=SignalStatus.PASS, detail="ok"):
    return ConfidenceSignal(key=key, label=key, score=score, status=status, detail=detail)


# --- hedging -----------------------------------------------------------------

def test_hedge_returns_the_faster_leg():
    calls = []

    def call():
        calls.append(1)
        time.sleep(1.0 if len(calls) == 1 else 0.05)
        return len(calls)

    start = time.perf_counter()
    assert _hedged(call, hedge_after=0.1) == 2
    assert time.perf_counter() - start < 0.6


def test_hedge_falls_through_a_failed_leg_and_skips_hedging_when_fast():
    calls = []

    def call():
        calls.append(1)
        if len(calls) == 1:
            time.sleep(0.2)
            raise RuntimeError("leg 1 failed")
        time.sleep(0.3)
        return "leg 2"

    assert _hedged(call, hedge_after=0.05) == "leg 2"
    assert _hedged(lambda: "fast", hedge_after=5) == "fast"


def test_hedge_raises_when_both_legs_fail():
    def call():
        time.sleep(0.1)
        raise ValueError("down")

    with pytest.raises(ValueError):
        _hedged(call, hedge_after=0.01)


# --- pending signal ----------------------------------------------------------

def test_pending_signal_is_excluded_and_marks_score_uncalibrated():
    base = [_sig("sql_validity", 1.0), _sig("schema_alignment", 1.0), _sig("result_sanity", 1.0)]
    pending = fuse_confidence(base + [routes._BT_PENDING_SIGNAL])
    measured_fail = fuse_confidence(base + [_sig("back_translation_match", 0.0, SignalStatus.FAIL)])
    assert pending.calibrated is False
    assert pending.score > measured_fail.score  # a pending 0.5 placeholder must not drag the mean


def test_background_result_reaches_only_its_owner(monkeypatch):
    final_bt = _sig("back_translation_match", 0.2, SignalStatus.FAIL, "drifted")
    monkeypatch.setattr(routes, "check_back_translation", lambda q, s: final_bt)
    monkeypatch.setattr(routes, "wait_for_background_room", lambda: True)
    written = {}
    monkeypatch.setattr(routes, "update_history_confidence", lambda qid, s: written.update({qid: s}))

    signals = [_sig("sql_validity", 1.0), _sig("schema_alignment", 1.0), routes._BT_PENDING_SIGNAL]
    with routes._pending_lock:
        routes._pending["q_test"] = (TEST_STUDENT.user_id, time.monotonic(), None)
    assert routes.get_query_confidence("q_test", TEST_STUDENT).pending is True

    routes._finish_back_translation("q_test", "question", "SELECT 1", signals, row_scoped=True)

    update = routes.get_query_confidence("q_test", TEST_STUDENT)
    assert update.pending is False
    assert update.confidence.score <= 0.40  # FAIL cap applied once the real signal lands
    assert written == {"q_test": update.confidence.score}
    with pytest.raises(HTTPException) as e:
        routes.get_query_confidence("q_test", TEST_FACULTY)
    assert e.value.status_code == 404


def test_background_check_skips_instead_of_starving_interactive_quota(monkeypatch):
    monkeypatch.setattr(routes, "wait_for_background_room", lambda: False)
    monkeypatch.setattr(routes, "update_history_confidence", lambda *a: None)
    with routes._pending_lock:
        routes._pending["q_quota"] = (TEST_STUDENT.user_id, time.monotonic(), None)
    routes._finish_back_translation(
        "q_quota", "q", "SELECT 1", [routes._BT_PENDING_SIGNAL], row_scoped=False
    )
    bt = routes.get_query_confidence("q_quota", TEST_STUDENT).confidence.signals[0]
    assert bt.status == SignalStatus.WARN and "LLM_RPM_LIMIT" in bt.detail


def test_rpm_reserve(monkeypatch):
    monkeypatch.setattr(llm_client.settings, "LLM_RPM_LIMIT", 12)
    t = llm_client._RpmThrottle()
    now = time.monotonic()
    t._call_times.extend([now] * 8)
    assert t.has_room(reserve=4) is False  # 8 used + 4 reserved = full
    assert t.has_room(reserve=2) is True
