"""
The row-scoped generation instruction, and the eval integrity that depends
on it staying conditional.

A student asking "Show my attendance" used to get CLARIFICATION_NEEDED,
because nothing in the prompt resolved "my" -- the model refused correctly
given what it knew, and no SQL was ever produced, so Row Level Security
never got a chance to filter anything. The instruction tells the model
that the database restricts results itself.

THE EVAL CONSTRAINT, which is what most of this file is about:

    eval/ and admin requests carry row_scoped=False and must receive a
    BYTE-IDENTICAL prompt to the one that produced results.jsonl and
    results_gemini.jsonl. If the prompt changes for eval, every published
    number needs a re-run to stay comparable.

So the tests below do not merely check that the instruction appears when
scoped; they check that it appears NOWHERE when unscoped, and that nobody
has hoisted it out of the conditional.
"""
from __future__ import annotations

import ast
import inspect
from pathlib import Path

import pytest

from app.generation import generator
from app.generation.prompt_builder import _ROW_SCOPED_INSTRUCTION, build_system_prompt
from app.schema.introspect import introspect_schema

REPO = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def schema():
    """Exactly what the generator passes in."""
    return introspect_schema(
        include_samples=False, omit_restricted=True, include_row_estimates=False
    )


# --- eval integrity: the unscoped prompt must not have moved ---------------

def test_default_is_unscoped(schema):
    """Anything that does not opt in gets the original prompt."""
    assert build_system_prompt(schema) == build_system_prompt(schema, row_scoped=False)


def test_unscoped_prompt_contains_no_trace_of_the_instruction(schema):
    """Byte-level: not the sentence, not a fragment, not the vocabulary.

    This is the assertion that would fail if anyone made the instruction
    unconditional, which is the whole reason it exists.
    """
    unscoped = build_system_prompt(schema, row_scoped=False)
    assert _ROW_SCOPED_INSTRUCTION not in unscoped
    for fragment in (
        "automatically restricted",
        "current user",
        "identity predicate",
        "first person",
        "ANSWERABLE",
    ):
        assert fragment not in unscoped, (
            f"{fragment!r} leaked into the eval prompt -- results.jsonl and "
            "results_gemini.jsonl would no longer be comparable"
        )


def test_the_scoped_prompt_is_the_unscoped_one_plus_exactly_one_line(schema):
    """The change must be additive and confined to a single rule. If the
    scoped prompt reordered or reworded anything else, the two would no
    longer be comparable either."""
    unscoped = build_system_prompt(schema, row_scoped=False).splitlines()
    scoped = build_system_prompt(schema, row_scoped=True).splitlines()

    added = [line for line in scoped if line not in unscoped]
    removed = [line for line in unscoped if line not in scoped]

    assert removed == [], f"scoping REMOVED prompt content: {removed}"
    assert len(added) == 1, f"expected exactly one added line, got {added}"
    assert _ROW_SCOPED_INSTRUCTION in added[0]


def test_the_instruction_is_inside_a_conditional_not_the_rule_list():
    """Structural, not textual. Reads the AST so that a future edit which
    appends the instruction to `lines` unconditionally is caught even if
    the wording changes."""
    src = (REPO / "app/generation/prompt_builder.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef) and n.name == "build_system_prompt")

    guarded = False
    for node in ast.walk(fn):
        if isinstance(node, ast.If) and "row_scoped" in ast.dump(node.test):
            if "_ROW_SCOPED_INSTRUCTION" in ast.dump(node):
                guarded = True
    assert guarded, (
        "the row-scoped instruction must live inside an `if row_scoped:` "
        "branch -- an unconditional append changes the eval prompt"
    )


# --- eval genuinely never opts in ------------------------------------------

def test_generate_sql_defaults_to_unscoped():
    assert inspect.signature(generator.generate_sql).parameters["row_scoped"].default is False
    assert inspect.signature(build_system_prompt).parameters["row_scoped"].default is False


def test_no_eval_module_sets_row_scoped():
    """Same check applied to result_sanity. eval/ must never opt in, on any
    path, or the prompt it sends stops matching the published runs."""
    offenders = []
    for path in (REPO / "eval").glob("*.py"):
        text = path.read_text(encoding="utf-8")
        if "row_scoped=True" in text or "row_scoped = True" in text:
            offenders.append(path.name)
    assert offenders == [], f"eval modules opting into row scoping: {offenders}"


def test_the_eval_runner_calls_generate_sql_without_the_flag():
    src = (REPO / "eval/runner.py").read_text(encoding="utf-8")
    assert "generate_sql(question)" in src, (
        "eval/runner.py must call generate_sql with the question alone"
    )


# --- what the instruction actually says ------------------------------------

def test_the_instruction_carries_no_identity_value():
    """Shape without value. A concrete id in the prompt would invite the
    model to write its own predicate, duplicating enforcement in the layer
    this project deliberately moved away from -- and would give a prompt
    injection something to manipulate."""
    text = _ROW_SCOPED_INSTRUCTION.lower()
    for leak in ("student_id =", "student 32", "= 32", "your id", "you are student"):
        assert leak not in text, f"instruction leaks an identity value: {leak!r}"


def test_the_instruction_forbids_writing_a_predicate():
    """Saying only 'results are filtered' invites the model to add the
    predicate anyway, helpfully."""
    text = _ROW_SCOPED_INSTRUCTION.lower()
    assert "no identity predicate" in text
    assert "do not add a where clause" in text
    assert "never invent an id" in text


def test_the_instruction_says_such_questions_are_answerable():
    assert "answerable" in _ROW_SCOPED_INSTRUCTION.lower()
    assert "must not" in _ROW_SCOPED_INSTRUCTION.lower()
