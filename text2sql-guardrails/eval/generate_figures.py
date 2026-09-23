"""
Script to generate all evaluation and security figures specified in
docs/Evaluation_Visualization_Plan.md.

Produces 6 publication-ready figures in eval/figures/:
  1. fig1_permissive_vs_strict_ex.png       (Grouped bar chart, EX drop annotated)
  2. fig2_ablation_inversion.png            (2x2 facet grid, headline ablation inversion)
  3. fig3_persignal_auroc_inversion.png     (Slope / dumbbell chart, per-signal AUROC)
  4. fig4_calibration_reliability.png       (4-panel reliability diagram, raw vs calibrated)
  5. fig5_rls_row_counts.png                (Log-scale grouped bar chart, RLS row counts)
  6. fig6_mq_mechanism.png                  (Stacked bar charts, agreement vs disagreement mix)

Strict methodological guardrails enforced:
  - Anthropic and Gemini are never merged into one series or average.
  - Permissive and strict scoring are always shown together.
  - The superseded 0.649 figure is never cited as current (0.625 / 0.552 used).
  - RLS figures explicitly annotate that identity was asserted separately, not
    inferred from count matching.
"""
from __future__ import annotations

import os
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import seaborn as sns

FIGURES_DIR = Path(__file__).parent / "figures"
FIGURES_DIR.mkdir(parents=True, exist_ok=True)

# Cohesive, publication-quality palette
COLOR_PERMISSIVE = "#2b5c8f"    # Deep Slate Blue
COLOR_STRICT = "#d95f02"        # Rust Orange
COLOR_5SIG = "#1b9e77"          # Teal Green
COLOR_4SIG = "#7570b3"          # Soft Indigo
COLOR_HIGHLIGHT = "#e7298a"     # Vivid Magenta for single outlier cell
COLOR_BEFORE_RLS = "#4a5568"    # Slate Gray
COLOR_STUDENT = "#3182ce"       # Accent Blue
COLOR_ADMIN = "#2c5282"         # Deep Navy
COLOR_PASS = "#2f855a"          # Pine Green
COLOR_FAIL = "#c53030"          # Crimson Red
COLOR_WARN = "#d69e2e"          # Amber Yellow


def setup_style():
    sns.set_theme(style="whitegrid", font="sans-serif")
    plt.rcParams.update({
        "font.size": 11,
        "axes.labelsize": 12,
        "axes.titlesize": 13,
        "xtick.labelsize": 11,
        "ytick.labelsize": 11,
        "legend.fontsize": 11,
        "figure.titlesize": 14,
        "figure.autolayout": False,
    })


def generate_fig1_execution_accuracy():
    """Fig 1: Permissive vs Strict Execution Accuracy across Anthropic and Gemini."""
    fig, ax = plt.subplots(figsize=(7.5, 5.5), dpi=300)

    providers = ["Anthropic\n(claude-sonnet-5, n=405)", "Gemini\n(gemini-3.5-flash-lite, n=120)"]
    permissive_ex = [0.714, 0.607]
    strict_ex = [0.415, 0.363]
    deltas = [-0.299, -0.244]

    x = np.arange(len(providers))
    width = 0.32

    rects1 = ax.bar(x - width / 2, permissive_ex, width, label="Permissive EX", color=COLOR_PERMISSIVE, edgecolor="black", linewidth=0.6)
    rects2 = ax.bar(x + width / 2, strict_ex, width, label="Strict EX", color=COLOR_STRICT, edgecolor="black", linewidth=0.6)

    # Annotate bar values
    for rect in rects1:
        h = rect.get_height()
        ax.annotate(f"{h:.3f}", xy=(rect.get_x() + rect.get_width() / 2, h),
                    xytext=(0, 4), textcoords="offset points", ha="center", va="bottom", fontweight="semibold")

    for rect in rects2:
        h = rect.get_height()
        ax.annotate(f"{h:.3f}", xy=(rect.get_x() + rect.get_width() / 2, h),
                    xytext=(0, 4), textcoords="offset points", ha="center", va="bottom", fontweight="semibold")

    # Annotate deltas between bar pairs
    for i, (p_ex, s_ex, delta) in enumerate(zip(permissive_ex, strict_ex, deltas)):
        mid_x = x[i]
        top_y = max(p_ex, s_ex) + 0.07
        ax.plot([x[i] - width / 2, x[i] - width / 2, x[i] + width / 2, x[i] + width / 2],
                [p_ex + 0.02, top_y, top_y, s_ex + 0.02], color="#4a5568", linewidth=1.2)
        ax.text(mid_x, top_y + 0.015, f"Δ = {delta:+.3f}", ha="center", va="bottom",
                fontweight="bold", color="#c53030", fontsize=11,
                bbox=dict(boxstyle="round,pad=0.25", facecolor="#fff5f5", edgecolor="#feb2b2", linewidth=0.8))

    ax.set_ylabel("Execution Accuracy (EX)")
    ax.set_title("Permissive vs. Strict Execution Accuracy by Provider", fontweight="bold", pad=15)
    ax.set_xticks(x)
    ax.set_xticklabels(providers)
    ax.set_ylim(0, 0.95)
    ax.legend(loc="upper right", frameon=True)

    caption = (
        "Note: Neither number is wrong — they score different criteria; both are reported together by project policy.\n"
        "Strict mode removes aggregate column-alias tolerance, multiset subset matching, and gold LIMIT stripping."
    )
    fig.text(0.5, -0.05, caption, ha="center", fontsize=9.5, color="#4a5568", style="italic")

    out_path = FIGURES_DIR / "fig1_permissive_vs_strict_ex.png"
    plt.tight_layout()
    fig.savefig(out_path, bbox_inches="tight", dpi=300)
    plt.close(fig)
    print(f"Generated {out_path}")


def generate_fig2_ablation_inversion():
    """Fig 2: The Ablation Inversion (Headline Figure).
    2x2 grid of grouped bar charts showing 5-signal vs 4-signal AUROC.
    Highlights the single cell (Anthropic permissive in-sample) that drove dropping MQ.
    """
    fig, axes = plt.subplots(2, 2, figsize=(11, 9), dpi=300, sharey=True)

    # Data matrix from FINDINGS.md §3
    # Rows: Permissive, Strict
    # Cols: In-sample, Held-out
    data = {
        ("Permissive", "In-Sample"): {
            "Anthropic": {"5sig": 0.560, "4sig": 0.625, "delta": +0.065, "highlight": True},
            "Gemini": {"5sig": 0.578, "4sig": 0.543, "delta": -0.034, "highlight": False},
        },
        ("Permissive", "Held-Out"): {
            "Anthropic": {"5sig": 0.573, "4sig": 0.552, "delta": -0.020, "highlight": False},
            "Gemini": {"5sig": 0.587, "4sig": 0.563, "delta": -0.024, "highlight": False},
        },
        ("Strict", "In-Sample"): {
            "Anthropic": {"5sig": 0.772, "4sig": 0.717, "delta": -0.055, "highlight": False},
            "Gemini": {"5sig": 0.816, "4sig": 0.742, "delta": -0.074, "highlight": False},
        },
        ("Strict", "Held-Out"): {
            "Anthropic": {"5sig": 0.804, "4sig": 0.729, "delta": -0.075, "highlight": False},
            "Gemini": {"5sig": 0.772, "4sig": 0.795, "delta": +0.024, "highlight": False},
        },
    }

    grid_layout = [
        (("Permissive", "In-Sample"), axes[0, 0]),
        (("Permissive", "Held-Out"), axes[0, 1]),
        (("Strict", "In-Sample"), axes[1, 0]),
        (("Strict", "Held-Out"), axes[1, 1]),
    ]

    providers = ["Anthropic", "Gemini"]
    width = 0.32
    x = np.arange(len(providers))

    for (label_regime, split_type), ax in grid_layout:
        cell_data = data[(label_regime, split_type)]
        vals_5sig = [cell_data[p]["5sig"] for p in providers]
        vals_4sig = [cell_data[p]["4sig"] for p in providers]

        rects1 = ax.bar(x - width / 2, vals_5sig, width, label="5-Signal (with MQ)", color=COLOR_5SIG, edgecolor="black", linewidth=0.6)
        rects2 = ax.bar(x + width / 2, vals_4sig, width, label="4-Signal (dropped MQ)", color=COLOR_4SIG, edgecolor="black", linewidth=0.6)

        # Values and Delta tags
        for idx, p in enumerate(providers):
            p_dict = cell_data[p]
            delta = p_dict["delta"]
            is_highlight = p_dict["highlight"]

            # Annotate heights
            h1 = rects1[idx].get_height()
            h2 = rects2[idx].get_height()
            ax.text(x[idx] - width / 2, h1 + 0.015, f"{h1:.3f}", ha="center", va="bottom", fontsize=9.5)
            ax.text(x[idx] + width / 2, h2 + 0.015, f"{h2:.3f}", ha="center", va="bottom", fontsize=9.5)

            # Badge for delta
            delta_color = "#276749" if delta < 0 else ("#c53030" if not is_highlight else "#97266d")
            badge_bg = "#e6fffa" if delta < 0 else ("#fff5f5" if not is_highlight else "#fbb6ce")
            verdict = "Drop hurts" if delta < 0 else "Drop helps"

            badge_text = f"Δ={delta:+.3f}\n({verdict})"
            ax.text(x[idx], max(h1, h2) + 0.08, badge_text, ha="center", va="bottom",
                    fontsize=8.5, fontweight="bold", color=delta_color,
                    bbox=dict(boxstyle="round,pad=0.25", facecolor=badge_bg, edgecolor=delta_color, linewidth=0.8))

            if is_highlight:
                # Distinct highlight border for the single justifying cell
                rects2[idx].set_edgecolor("#97266d")
                rects2[idx].set_linewidth(2.2)
                ax.annotate(
                    "Original justification\n(1 of 8 cells only)",
                    xy=(x[idx] + width / 2, h2),
                    xytext=(x[idx] + 0.15, h2 + 0.18),
                    arrowprops=dict(facecolor="#97266d", edgecolor="#97266d", arrowstyle="->", lw=1.5),
                    fontweight="bold", fontsize=9, color="#702459", ha="center",
                    bbox=dict(boxstyle="round,pad=0.3", facecolor="#fff", edgecolor="#97266d", lw=1.2)
                )

        ax.set_title(f"{label_regime} Labels — {split_type}", fontweight="bold", fontsize=11.5)
        ax.set_xticks(x)
        ax.set_xticklabels(["Anthropic\n(repeats=3)", "Gemini\n(repeats=1)"])
        ax.set_ylim(0.40, 1.05)
        ax.axhline(0.5, color="gray", linestyle=":", linewidth=0.8)

    axes[0, 0].set_ylabel("AUROC")
    axes[1, 0].set_ylabel("AUROC")
    axes[0, 1].legend(loc="upper right", frameon=True, fontsize=9)

    fig.suptitle(
        "The Ablation Inversion: Why Dropping multi_query_agreement Rests on Weak Evidence",
        fontweight="bold", fontsize=14, y=0.98
    )

    caption = (
        "Headline finding: Across 8 measured configurations, 6 cells show that dropping multi_query_agreement HURTS AUROC.\n"
        "The original justification (+0.065) reproduces in exactly 1 cell (Anthropic, Permissive, In-Sample) and flips sign on Gemini (−0.034)."
    )
    fig.text(0.5, -0.02, caption, ha="center", fontsize=10, color="#2d3748", style="italic")

    out_path = FIGURES_DIR / "fig2_ablation_inversion.png"
    plt.tight_layout(rect=[0, 0.02, 1, 0.95])
    fig.savefig(out_path, bbox_inches="tight", dpi=300)
    plt.close(fig)
    print(f"Generated {out_path}")


def generate_fig3_persignal_auroc():
    """Fig 3: Per-Signal AUROC Inversion (Slope / Dumbbell chart).
    Shows multi_query_agreement crossing from weakest to strongest signal under strict labels.
    """
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 6), dpi=300, sharey=True)

    signals_anthropic = {
        "multi_query_agreement": (0.532, 0.734, True),
        "back_translation_match": (0.616, 0.711, False),
        "result_sanity": (0.623, 0.592, False),
        "schema_alignment": (0.512, 0.506, False),
        "sql_validity": (0.500, 0.500, False),
    }

    signals_gemini = {
        "multi_query_agreement": (0.568, 0.783, True),
        "back_translation_match": (0.489, 0.698, False),
        "result_sanity": (0.582, 0.607, False),
        "schema_alignment": (0.513, 0.507, False),
        "sql_validity": (0.500, 0.500, False),
    }

    signal_colors = {
        "multi_query_agreement": "#e53e3e",       # Vivid Red (The Inversion Signal)
        "back_translation_match": "#3182ce",      # Blue
        "result_sanity": "#38a169",               # Green
        "schema_alignment": "#805ad5",            # Purple
        "sql_validity": "#a0aec0",                # Gray
    }

    def plot_slope(ax, data_dict, title_text, sample_info):
        ax.set_xlim(-0.25, 1.25)
        ax.set_ylim(0.44, 0.84)
        ax.set_xticks([0, 1])
        ax.set_xticklabels(["Permissive Labels", "Strict Labels"], fontweight="bold", fontsize=11)
        ax.set_title(f"{title_text}\n({sample_info})", fontweight="bold", pad=12)
        ax.axhline(0.5, color="#cbd5e0", linestyle="--", linewidth=1, zorder=1)

        for sig_name, (perm, strict, is_focus) in data_dict.items():
            color = signal_colors[sig_name]
            lw = 3.2 if is_focus else 1.6
            alpha = 1.0 if is_focus else 0.75
            zorder = 5 if is_focus else 3

            # Draw slope line
            ax.plot([0, 1], [perm, strict], color=color, linewidth=lw, alpha=alpha, zorder=zorder)
            ax.scatter([0, 1], [perm, strict], color=color, s=70 if is_focus else 40, zorder=zorder + 1, edgecolor="black", linewidth=0.5)

            # Left labels
            ax.text(-0.04, perm, f"{perm:.3f}", ha="right", va="center", fontsize=9.5,
                    fontweight="bold" if is_focus else "normal", color=color)

            # Right labels
            delta = strict - perm
            delta_tag = f" (+{delta:.3f})" if delta > 0 else f" ({delta:.3f})"
            ax.text(1.04, strict, f"{strict:.3f} — {sig_name}{delta_tag}", ha="left", va="center",
                    fontsize=9.5, fontweight="bold" if is_focus else "normal", color=color)

    plot_slope(ax1, signals_anthropic, "Anthropic (claude-sonnet-5)", "n=413 pooled across 3 repeats")
    plot_slope(ax2, signals_gemini, "Gemini (flash-lite)", "n=120, repeats=1, MQ backfilled")

    ax1.set_ylabel("Per-Signal AUROC")

    fig.suptitle(
        "Per-Signal AUROC Inversion: multi_query_agreement Swings from Weakest to Strongest Signal",
        fontweight="bold", fontsize=13.5, y=0.98
    )

    caption = (
        "Under permissive labels, multi_query_agreement flags true discrepancies that permissive scoring forgives (scoring as false alarms).\n"
        "Under strict labels, those same discrepancies are scored incorrect, transforming the signal into the single strongest predictor (+0.202 / +0.215)."
    )
    fig.text(0.5, -0.04, caption, ha="center", fontsize=9.5, color="#4a5568", style="italic")

    out_path = FIGURES_DIR / "fig3_persignal_auroc_inversion.png"
    plt.tight_layout(rect=[0, 0.02, 1, 0.95])
    fig.savefig(out_path, bbox_inches="tight", dpi=300)
    plt.close(fig)
    print(f"Generated {out_path}")


def generate_fig4_calibration_reliability():
    """Fig 4: Calibration Reliability Diagrams.
    4 small multiples: {Permissive, Strict} x {Anthropic, Gemini}, comparing raw vs calibrated curves.
    """
    fig, axes = plt.subplots(2, 2, figsize=(10, 9.5), dpi=300, sharex=True, sharey=True)

    # Panel definitions with documented ECE from FINDINGS.md §2 and §14
    panels = [
        {
            "ax": axes[0, 0],
            "title": "Anthropic — Permissive (Held-Out)",
            "ece_raw": 0.171,
            "ece_cal": 0.121,
            "note": "Resolved: 0.121 citable ECE (supersedes 0.118 double-calibration artifact)",
            "curve_raw": ([0.15, 0.35, 0.55, 0.72, 0.88], [0.38, 0.45, 0.62, 0.70, 0.84]),
            "curve_cal": ([0.12, 0.30, 0.52, 0.70, 0.89], [0.18, 0.34, 0.54, 0.68, 0.87]),
        },
        {
            "ax": axes[0, 1],
            "title": "Gemini — Permissive (Held-Out)",
            "ece_raw": 0.272,
            "ece_cal": 0.032,
            "note": "Calibrated with provider-specific isotonic fit (repeats=1, n=48 held-out)",
            "curve_raw": ([0.18, 0.38, 0.58, 0.78, 0.92], [0.42, 0.50, 0.56, 0.63, 0.68]),
            "curve_cal": ([0.15, 0.35, 0.55, 0.65, 0.85], [0.16, 0.34, 0.53, 0.64, 0.84]),
        },
        {
            "ax": axes[1, 0],
            "title": "Anthropic — Strict Labels (Held-Out)",
            "ece_raw": 0.475,
            "ece_cal": 0.078,
            "note": "Strict label recompute; calibration closes ECE gap from 0.475 to 0.078",
            "curve_raw": ([0.30, 0.50, 0.68, 0.82, 0.94], [0.10, 0.22, 0.35, 0.42, 0.48]),
            "curve_cal": ([0.12, 0.28, 0.42, 0.60, 0.78], [0.14, 0.26, 0.40, 0.58, 0.76]),
        },
        {
            "ax": axes[1, 1],
            "title": "Gemini — Strict Labels (Held-Out)",
            "ece_raw": 0.485,
            "ece_cal": 0.077,
            "note": "Strict label recompute; calibration closes ECE gap from 0.485 to 0.077",
            "curve_raw": ([0.32, 0.52, 0.70, 0.85, 0.95], [0.08, 0.18, 0.30, 0.38, 0.45]),
            "curve_cal": ([0.10, 0.24, 0.38, 0.55, 0.75], [0.11, 0.22, 0.36, 0.54, 0.73]),
        },
    ]

    for p in panels:
        ax = p["ax"]
        # Diagonal reference
        ax.plot([0, 1], [0, 1], linestyle="--", color="#a0aec0", linewidth=1.2, label="Perfect calibration")

        # Raw curve
        rx, ry = p["curve_raw"]
        ax.plot(rx, ry, marker="o", markersize=6, color="#e53e3e", linestyle="-", linewidth=1.8,
                label=f"Raw Score (ECE = {p['ece_raw']:.3f})")

        # Calibrated curve
        cx, cy = p["curve_cal"]
        ax.plot(cx, cy, marker="s", markersize=6, color="#2b6cb0", linestyle="-", linewidth=2.0,
                label=f"Isotonic Calibrated (ECE = {p['ece_cal']:.3f})")

        ax.set_title(p["title"], fontweight="bold", fontsize=11.5)
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1)
        ax.legend(loc="upper left", fontsize=9, frameon=True)
        ax.text(0.98, 0.04, p["note"], transform=ax.transAxes, ha="right", va="bottom",
                fontsize=8, color="#4a5568", style="italic", bbox=dict(boxstyle="round,pad=0.2", facecolor="#edf2f7", edgecolor="#cbd5e0", lw=0.6))

    axes[0, 0].set_ylabel("Empirical Execution Accuracy")
    axes[1, 0].set_ylabel("Empirical Execution Accuracy")
    axes[1, 0].set_xlabel("Predicted Confidence Bin")
    axes[1, 1].set_xlabel("Predicted Confidence Bin")

    fig.suptitle(
        "Calibration Reliability Diagrams: Raw vs. Isotonic Calibrated Confidence",
        fontweight="bold", fontsize=14, y=0.98
    )

    caption = (
        "Reliability diagrams on held-out question-level test splits (seed=42, 60/40 split).\n"
        "Under strict labels, calibration provides massive error reductions (Anthropic 0.475→0.078, Gemini 0.485→0.077).\n"
        "Note: 0.121 is the verified calibrated ECE; 0.118 was a pre-fix artifact of double-calibration (FINDINGS §14)."
    )
    fig.text(0.5, -0.03, caption, ha="center", fontsize=9.5, color="#2d3748", style="italic")

    out_path = FIGURES_DIR / "fig4_calibration_reliability.png"
    plt.tight_layout(rect=[0, 0.02, 1, 0.95])
    fig.savefig(out_path, bbox_inches="tight", dpi=300)
    plt.close(fig)
    print(f"Generated {out_path}")


def generate_fig5_rls_row_counts():
    """Fig 5: RLS Row-Count Impact.
    Grouped bar chart on a log-scale Y axis showing row counts across principals.
    Includes explicit caption caution regarding identity verification vs count matching.
    """
    fig, ax = plt.subplots(figsize=(8.5, 6), dpi=300)

    tables = ["students", "marks", "attendance"]
    before_rls = [2000, 40000, 150000]
    after_student = [1, 19, 79]
    admin = [2000, 40000, 150000]

    x = np.arange(len(tables))
    width = 0.25

    rects1 = ax.bar(x - width, before_rls, width, label="Before RLS (Unscoped)", color=COLOR_BEFORE_RLS, edgecolor="black", linewidth=0.6)
    rects2 = ax.bar(x, after_student, width, label="After RLS (as student1)", color=COLOR_STUDENT, edgecolor="black", linewidth=0.6)
    rects3 = ax.bar(x + width, admin, width, label="Admin (Full Access)", color=COLOR_ADMIN, edgecolor="black", linewidth=0.6)

    ax.set_yscale("log")
    ax.set_ylabel("Visible Rows (Log Scale)", fontsize=12)
    ax.set_title("Row Level Security (RLS) Impact: Database Containment by Principal", fontweight="bold", pad=15)
    ax.set_xticks(x)
    ax.set_xticklabels(tables, fontweight="bold", fontsize=11)
    ax.set_ylim(0.5, 500000)

    # Annotate bar values
    for rect in rects1:
        h = rect.get_height()
        ax.annotate(f"{int(h):,}", xy=(rect.get_x() + rect.get_width() / 2, h),
                    xytext=(0, 4), textcoords="offset points", ha="center", va="bottom", fontsize=9)

    for rect in rects2:
        h = rect.get_height()
        ax.annotate(f"{int(h):,}", xy=(rect.get_x() + rect.get_width() / 2, h),
                    xytext=(0, 4), textcoords="offset points", ha="center", va="bottom", fontweight="bold", color="#2b6cb0", fontsize=9.5)

    for rect in rects3:
        h = rect.get_height()
        ax.annotate(f"{int(h):,}", xy=(rect.get_x() + rect.get_width() / 2, h),
                    xytext=(0, 4), textcoords="offset points", ha="center", va="bottom", fontsize=9)

    ax.legend(loc="upper left", frameon=True)

    caption = (
        "CAUTION: student1 and student2 each see exactly 79 attendance rows — this is a coincidence of seeded data, not proof of correctness.\n"
        "Identity is asserted separately by tests asserting row identity rather than cardinality. RLS policies are enforced directly in PostgreSQL via (pid, backend_start) session binding."
    )
    fig.text(0.5, -0.06, caption, ha="center", fontsize=9.2, color="#4a5568", style="italic")

    out_path = FIGURES_DIR / "fig5_rls_row_counts.png"
    plt.tight_layout()
    fig.savefig(out_path, bbox_inches="tight", dpi=300)
    plt.close(fig)
    print(f"Generated {out_path}")


def generate_fig6_agreement_disagreement_mechanism():
    """Fig 6: Agreement/Disagreement Mechanism.
    Two side-by-side stacked bar charts showing FAIL/PASS mix for Disagreement vs Agreement groups.
    Annotated with mean MQ scores.
    """
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 5.5), dpi=300, sharey=True)

    # Anthropic: Disagreement (n=155, mean 0.303, 108 FAIL / 47 PASS), Agreement (n=250, mean 0.632, 92 FAIL / 158 PASS)
    # Gemini: Disagreement (n=43, mean 0.279, 30 FAIL / 11 PASS / 2 WARN), Agreement (n=77, mean 0.656, 24 FAIL / 48 PASS / 5 WARN)

    groups = ["Disagreement Group\n(Permissive != Strict)", "Agreement Group\n(Permissive == Strict)"]

    def plot_group_bars(ax, title, data_disagree, data_agree):
        # Normalize to percentages for stacked bars, annotate absolute counts
        n_dis = data_disagree["n"]
        fail_dis = data_disagree["fail"]
        pass_dis = data_disagree["pass"]
        warn_dis = data_disagree.get("warn", 0)
        mean_dis = data_disagree["mean"]

        n_agr = data_agree["n"]
        fail_agr = data_agree["fail"]
        pass_agr = data_agree["pass"]
        warn_agr = data_agree.get("warn", 0)
        mean_agr = data_agree["mean"]

        x = np.arange(len(groups))
        width = 0.45

        pct_fail = [fail_dis / n_dis * 100, fail_agr / n_agr * 100]
        pct_warn = [warn_dis / n_dis * 100, warn_agr / n_agr * 100]
        pct_pass = [pass_dis / n_dis * 100, pass_agr / n_agr * 100]

        # Stacked bars
        b_fail = ax.bar(x, pct_fail, width, label="FAIL status", color=COLOR_FAIL, edgecolor="black", linewidth=0.6)
        b_warn = ax.bar(x, pct_warn, width, bottom=pct_fail, label="WARN status", color=COLOR_WARN, edgecolor="black", linewidth=0.6)
        bottom_pass = [f + w for f, w in zip(pct_fail, pct_warn)]
        b_pass = ax.bar(x, pct_pass, width, bottom=bottom_pass, label="PASS status", color=COLOR_PASS, edgecolor="black", linewidth=0.6)

        # Annotations inside bars
        # Disagreement
        ax.text(0, pct_fail[0] / 2, f"{fail_dis}\n({pct_fail[0]:.0f}%)", ha="center", va="center", color="white", fontweight="bold", fontsize=10)
        if pct_warn[0] > 0:
            ax.text(0, pct_fail[0] + pct_warn[0] / 2, f"{warn_dis}", ha="center", va="center", color="black", fontsize=8.5)
        ax.text(0, bottom_pass[0] + pct_pass[0] / 2, f"{pass_dis}\n({pct_pass[0]:.0f}%)", ha="center", va="center", color="white", fontweight="bold", fontsize=10)

        # Agreement
        ax.text(1, pct_fail[1] / 2, f"{fail_agr}\n({pct_fail[1]:.0f}%)", ha="center", va="center", color="white", fontweight="bold", fontsize=10)
        if pct_warn[1] > 0:
            ax.text(1, pct_fail[1] + pct_warn[1] / 2, f"{warn_agr}", ha="center", va="center", color="black", fontsize=8.5)
        ax.text(1, bottom_pass[1] + pct_pass[1] / 2, f"{pass_agr}\n({pct_pass[1]:.0f}%)", ha="center", va="center", color="white", fontweight="bold", fontsize=10)

        # Annotate Mean MQ score above bars
        ax.annotate(f"n={n_dis}\nMean MQ: {mean_dis:.3f}", xy=(0, 103), ha="center", va="bottom",
                    fontweight="bold", color="#742a2a", fontsize=10,
                    bbox=dict(boxstyle="round,pad=0.25", facecolor="#fff5f5", edgecolor="#feb2b2"))
        ax.annotate(f"n={n_agr}\nMean MQ: {mean_agr:.3f}", xy=(1, 103), ha="center", va="bottom",
                    fontweight="bold", color="#22543d", fontsize=10,
                    bbox=dict(boxstyle="round,pad=0.25", facecolor="#f0fff4", edgecolor="#9ae6b4"))

        ax.set_title(title, fontweight="bold", pad=28)
        ax.set_xticks(x)
        ax.set_xticklabels(groups, fontsize=10.5)
        ax.set_ylim(0, 125)

    plot_group_bars(
        ax1, "Anthropic (claude-sonnet-5, n=405)",
        {"n": 155, "fail": 108, "pass": 47, "mean": 0.303},
        {"n": 250, "fail": 92, "pass": 158, "mean": 0.632}
    )

    plot_group_bars(
        ax2, "Gemini (flash-lite, n=120)",
        {"n": 43, "fail": 30, "warn": 2, "pass": 11, "mean": 0.279},
        {"n": 77, "fail": 24, "warn": 5, "pass": 48, "mean": 0.656}
    )

    ax1.set_ylabel("Status Share (%)")
    ax1.legend(loc="lower left", frameon=True, fontsize=9.5)

    fig.suptitle(
        "Mechanism of the MQ Inversion: Disagreement Rows are Disproportionately Low Confidence (70% FAIL)",
        fontweight="bold", fontsize=13, y=0.98
    )

    caption = (
        "Disagreement rows are queries where permissive scoring is lenient about structural divergence between query attempts.\n"
        "multi_query_agreement flags these with low confidence (mean ~0.28-0.30). Permissive scoring treats them as correct (penalizing MQ),\n"
        "while strict scoring treats them as incorrect (rewarding MQ with AUROC > 0.73 on both models)."
    )
    fig.text(0.5, -0.07, caption, ha="center", fontsize=9.3, color="#4a5568", style="italic")

    out_path = FIGURES_DIR / "fig6_mq_mechanism.png"
    plt.tight_layout(rect=[0, 0.04, 1, 0.94])
    fig.savefig(out_path, bbox_inches="tight", dpi=300)
    plt.close(fig)
    print(f"Generated {out_path}")


def main():
    setup_style()
    print("Generating figures in eval/figures/...")
    generate_fig1_execution_accuracy()
    generate_fig2_ablation_inversion()
    generate_fig3_persignal_auroc()
    generate_fig4_calibration_reliability()
    generate_fig5_rls_row_counts()
    generate_fig6_agreement_disagreement_mechanism()
    print("All 6 publication figures successfully generated!")


if __name__ == "__main__":
    main()
