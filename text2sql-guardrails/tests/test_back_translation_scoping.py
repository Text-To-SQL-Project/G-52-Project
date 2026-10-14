"""A row-scoped query ("my marks") has no per-user filter in its SQL; the
database adds it. The comparison must be told, or it fails a correct answer."""
from app.config import settings
from app.detection import back_translation


def _run(monkeypatch, row_scoped):
    prompts = []

    def fake_complete(system, user, **_):
        prompts.append(user)
        return "What are the subjects and marks for students?" if len(prompts) == 1 else '{"score": 0.9, "reason": "same"}'

    monkeypatch.setattr(settings, "BACK_TRANSLATION_ENABLED", True)
    monkeypatch.setattr(back_translation, "complete", fake_complete)
    sig = back_translation.check_back_translation("What are my marks?", "SELECT * FROM marks", row_scoped)
    return sig, prompts[1]


def test_row_scoped_comparison_mentions_rls(monkeypatch):
    sig, compare = _run(monkeypatch, True)
    assert "row-level security" in compare and sig.score == 0.9


def test_unscoped_comparison_is_unchanged(monkeypatch):
    _, compare = _run(monkeypatch, False)
    assert "row-level security" not in compare
