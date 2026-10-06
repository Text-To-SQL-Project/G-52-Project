"""The interactive latency path: hedged LLM calls, back-translation moved off
the critical path (pending signal + signed ticket), and the RPM reserve that
keeps the deferred check from starving new questions. No DB, no LLM."""
from __future__ import annotations

import time

import pytest
from fastapi import HTTPException

import app.api.routes as routes
from app.api.models import ConfidenceSignal, ConfidenceTicket, SignalStatus
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


def _ticket(**over):
    payload = {
        "q": "q_test", "u": TEST_STUDENT.user_id, "exp": int(time.time()) + 60,
        "question": "question", "sql": "SELECT 1", "rs": True, "p": None,
        "signals": [s.model_dump(mode="json") for s in
                    [_sig("sql_validity", 1.0), _sig("schema_alignment", 1.0), routes._BT_PENDING_SIGNAL]],
    }
    return routes._make_ticket({**payload, **over})


def test_ticket_redeems_only_for_its_owner_and_query(monkeypatch):
    monkeypatch.setattr(routes.settings, "SECRET_KEY", "k" * 40)
    final_bt = _sig("back_translation_match", 0.2, SignalStatus.FAIL, "drifted")
    monkeypatch.setattr(routes, "check_back_translation", lambda q, s: final_bt)
    monkeypatch.setattr(routes, "wait_for_background_room", lambda **_: True)
    written = {}
    monkeypatch.setattr(routes, "update_history_confidence", lambda qid, s: written.update({qid: s}))

    update = routes.redeem_confidence_ticket("q_test", ConfidenceTicket(ticket=_ticket()), TEST_STUDENT)
    assert update.pending is False
    assert update.confidence.score <= 0.40  # FAIL cap applied once the real signal lands
    assert written == {"q_test": update.confidence.score}

    good = _ticket()
    for qid, ticket, who in [
        ("q_test", good, TEST_FACULTY),                        # someone else's
        ("q_other", good, TEST_STUDENT),                        # wrong query id
        ("q_test", good[:-2] + "00", TEST_STUDENT),             # tampered signature
        ("q_test", _ticket(exp=int(time.time()) - 1), TEST_STUDENT),  # expired
    ]:
        with pytest.raises(HTTPException) as e:
            routes.redeem_confidence_ticket(qid, ConfidenceTicket(ticket=ticket), who)
        assert e.value.status_code == 404


def test_check_skips_instead_of_starving_new_questions(monkeypatch):
    monkeypatch.setattr(routes.settings, "SECRET_KEY", "k" * 40)
    monkeypatch.setattr(routes, "wait_for_background_room", lambda **_: False)
    monkeypatch.setattr(routes, "update_history_confidence", lambda *a: None)
    update = routes.redeem_confidence_ticket("q_test", ConfidenceTicket(ticket=_ticket()), TEST_STUDENT)
    bt = next(s for s in update.confidence.signals if s.key == "back_translation_match")
    assert bt.status == SignalStatus.WARN and "LLM_RPM_LIMIT" in bt.detail


def test_rpm_reserve(monkeypatch):
    monkeypatch.setattr(llm_client.settings, "LLM_RPM_LIMIT", 12)
    t = llm_client._RpmThrottle()
    now = time.monotonic()
    t._call_times.extend([now] * 8)
    assert t.has_room(reserve=4) is False  # 8 used + 4 reserved = full
    assert t.has_room(reserve=2) is True
