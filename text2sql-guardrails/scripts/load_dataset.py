"""
Load a folder of CSV files into the configured database — one table per CSV,
table name = file stem. Use this only if your dataset is CSVs. If you already
have a SQLite/Postgres database file, skip this and just point DATABASE_URL
at it (see app/db.py).

Usage:
    python -m scripts.load_dataset "C:/Users/dell/Desktop/Text-to-SQL"

It scans the folder (non-recursive) for *.csv, infers columns/types with
pandas, and writes each into the DB. Re-running replaces existing tables.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

from app.db import get_engine


def load_folder(folder: str) -> None:
    path = Path(folder)
    if not path.exists():
        raise SystemExit(f"Folder not found: {folder}")

    csvs = sorted(path.glob("*.csv"))
    if not csvs:
        raise SystemExit(
            f"No .csv files in {folder}. "
            "If your data is a SQLite/Postgres DB instead, set DATABASE_URL "
            "to point at it and skip this loader."
        )

    engine = get_engine()
    for csv in csvs:
        table = csv.stem.lower().replace(" ", "_").replace("-", "_")
        df = pd.read_csv(csv)
        df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
        df.to_sql(table, engine, if_exists="replace", index=False)
        print(f"  loaded {csv.name:40s} -> table '{table}'  ({len(df)} rows, "
              f"{len(df.columns)} cols)")

    print(f"\nDone. Loaded {len(csvs)} table(s). "
          f"Start the API and hit GET /v1/schema to verify.")


if __name__ == "__main__":
    folder = sys.argv[1] if len(sys.argv) > 1 else "."
    load_folder(folder)
