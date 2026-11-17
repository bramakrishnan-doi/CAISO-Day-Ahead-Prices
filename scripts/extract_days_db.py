#!/usr/bin/env python3
"""Create a standalone, compact SQLite database containing only `days`.

Usage:
  python3 extract_days_db.py mead_prices.db data/mead_daily.db

The source database is opened read-only. Only the `days` table and its explicit
indexes are copied; unrelated tables are not copied even temporarily. The
output is built in a temporary file, validated, then atomically replaced.
"""

import argparse
import os
import sqlite3
import sys
import tempfile
from urllib.parse import quote

EXPECTED_COLUMNS = ["date_key", "date_display"] + [
    "he" + str(i).zfill(2) for i in range(1, 26)
] + ["imported_at", "source"]


def readonly_connection(path):
    absolute = os.path.abspath(path)
    if not os.path.isfile(absolute):
        raise FileNotFoundError("Source database not found: " + absolute)
    uri = "file:" + quote(absolute, safe="/") + "?mode=ro"
    return sqlite3.connect(uri, uri=True)


def extract_days(source_path, output_path):
    source_abs = os.path.abspath(source_path)
    output_abs = os.path.abspath(output_path)
    if source_abs == output_abs:
        raise ValueError("Source and output paths must be different")

    source = readonly_connection(source_abs)
    try:
        table_sql_row = source.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='days'"
        ).fetchone()
        if not table_sql_row or not table_sql_row[0]:
            raise ValueError("Source database does not contain a creatable 'days' table")

        columns = source.execute("PRAGMA table_info(\"days\")").fetchall()
        actual_columns = [r[1] for r in columns]
        missing = [name for name in EXPECTED_COLUMNS if name not in actual_columns]
        if missing:
            raise ValueError("'days' table is missing expected columns: " + ", ".join(missing))

        # Preserve explicit indexes on days; primary-key autoindexes are recreated
        # automatically by the original CREATE TABLE statement.
        index_sql = [r[0] for r in source.execute(
            "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='days' "
            "AND sql IS NOT NULL ORDER BY name"
        ).fetchall()]

        os.makedirs(os.path.dirname(output_abs), exist_ok=True)
        fd, temp_path = tempfile.mkstemp(
            prefix=".mead_daily-", suffix=".db.tmp", dir=os.path.dirname(output_abs)
        )
        os.close(fd)
        try:
            destination = sqlite3.connect(temp_path)
            try:
                destination.execute(table_sql_row[0])
                for statement in index_sql:
                    destination.execute(statement)

                quoted_columns = ", ".join('"' + name.replace('"', '""') + '"' for name in actual_columns)
                placeholders = ", ".join("?" for _ in actual_columns)
                insert_sql = "INSERT INTO \"days\" (" + quoted_columns + ") VALUES (" + placeholders + ")"
                cursor = source.execute("SELECT " + quoted_columns + " FROM \"days\" ORDER BY \"date_key\"")
                while True:
                    batch = cursor.fetchmany(1000)
                    if not batch:
                        break
                    destination.executemany(insert_sql, batch)

                destination.commit()
                integrity = destination.execute("PRAGMA integrity_check").fetchone()[0]
                if integrity != "ok":
                    raise sqlite3.DatabaseError("Output integrity check failed: " + str(integrity))
                tables = [r[0] for r in destination.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
                )]
                if tables != ["days"]:
                    raise sqlite3.DatabaseError("Expected only 'days' table in output; found " + repr(tables))
                row_count = destination.execute("SELECT COUNT(*) FROM days").fetchone()[0]
            finally:
                destination.close()
            os.replace(temp_path, output_abs)
        except Exception:
            try:
                os.unlink(temp_path)
            except FileNotFoundError:
                pass
            raise
    finally:
        source.close()

    return row_count, os.path.getsize(output_abs)


def main():
    parser = argparse.ArgumentParser(description="Copy only the days table into a new SQLite database.")
    parser.add_argument("source", help="Original SQLite database, e.g. mead_prices.db")
    parser.add_argument("output", help="New daily-only database, e.g. data/mead_daily.db")
    args = parser.parse_args()
    try:
        rows, size = extract_days(args.source, args.output)
        print("Created " + args.output + " with only the days table: " + str(rows) + " rows, " + str(size) + " bytes")
    except (OSError, sqlite3.Error, ValueError) as exc:
        print("Extraction failed: " + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
