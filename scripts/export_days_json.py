#!/usr/bin/env python3
"""Export only the `days` table of mead_prices.db as compact website JSON.

Usage:
  python3 export_days_json.py mead_prices.db public/data/days.json

Read-only with respect to the SQLite database. The JSON output is replaced
atomically only after a successful export.
"""

import argparse
import json
import os
import sqlite3
import sys
import tempfile
from datetime import date, datetime, timezone
from urllib.parse import quote

PRICE_COLUMNS = ["he" + str(i).zfill(2) for i in range(1, 26)]
REQUIRED_COLUMNS = ["date_key", "date_display", *PRICE_COLUMNS, "imported_at", "source"]


def export_days(db_path, output_path):
    db_abs = os.path.abspath(db_path)
    if not os.path.isfile(db_abs):
        raise FileNotFoundError("Database file not found: " + db_abs)

    uri = "file:" + quote(db_abs, safe="/") + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    try:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "days" not in tables:
            raise ValueError("Database does not contain a 'days' table")
        columns = {r[1] for r in conn.execute("PRAGMA table_info(\"days\")")}
        missing = [c for c in REQUIRED_COLUMNS if c not in columns]
        if missing:
            raise ValueError("'days' table is missing expected columns: " + ", ".join(missing))

        select_columns = ", ".join('"' + col + '"' for col in REQUIRED_COLUMNS)
        rows = conn.execute(
            "SELECT " + select_columns + " FROM \"days\" ORDER BY \"date_key\" ASC"
        ).fetchall()

        records = []
        for row in rows:
            key = row["date_key"]
            try:
                date.fromisoformat(key)
            except (TypeError, ValueError):
                raise ValueError("Invalid date_key in days table: " + repr(key))

            hours = {}
            for column in PRICE_COLUMNS:
                value = row[column]
                if value is not None and not isinstance(value, (int, float)):
                    raise ValueError("Non-numeric value in " + column + " for " + key)
                hours[column.upper()] = value

            records.append({
                "key": key,
                "date": row["date_display"],
                "hours": hours,
                "importedAt": row["imported_at"],
                "source": row["source"],
            })

        payload = {
            "schemaVersion": 1,
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "rowCount": len(records),
            "records": records,
        }
        content = json.dumps(payload, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n"
    finally:
        conn.close()

    out_abs = os.path.abspath(output_path)
    os.makedirs(os.path.dirname(out_abs), exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix=".days-", suffix=".json.tmp", dir=os.path.dirname(out_abs))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_path, out_abs)
    except Exception:
        try:
            os.unlink(temp_path)
        except FileNotFoundError:
            pass
        raise

    return len(records), len(content.encode("utf-8")), payload["generatedAt"]


def main():
    parser = argparse.ArgumentParser(description="Export only the days table as JSON.")
    parser.add_argument("database", help="Path to mead_prices.db")
    parser.add_argument("output", help="Output JSON file, e.g. public/data/days.json")
    args = parser.parse_args()
    try:
        count, size, generated = export_days(args.database, args.output)
        print(json.dumps({"status": "ok", "rows": count, "output_bytes": size, "generated_at": generated}))
    except (OSError, sqlite3.Error, ValueError) as exc:
        print("Export failed: " + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
