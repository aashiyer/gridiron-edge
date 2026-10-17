"""Rough read on how much data the app is pulling from Postgres (Supabase's free
tier allows 5 GB of egress a month).

Reads pg_stat_statements: the total rows the database has returned since its
counters were last reset, the biggest queries, and a projection to a month.
Bytes are estimated from rows, so treat the numbers as a ballpark.

Usage:
    DATABASE_URL=... python -m scripts.db_usage            # report
    DATABASE_URL=... python -m scripts.db_usage --reset    # start counting from now
"""
import argparse
import os
import sys
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

BYTES_PER_ROW = 250
FREE_TIER_GB = 5.0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true", help="reset the counters")
    args = parser.parse_args()

    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("Set DATABASE_URL to the Postgres connection string.")
    conn = psycopg2.connect(url)
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    if args.reset:
        cur.execute("SELECT pg_stat_statements_reset()")
        print("Counters reset. Run again in a day or two for a projection.")
        return

    cur.execute("SELECT stats_reset FROM pg_stat_statements_info")
    since = cur.fetchone()["stats_reset"]
    days = max((datetime.now(timezone.utc) - since).total_seconds() / 86400, 0.01)
    cur.execute("SELECT SUM(rows) AS rows FROM pg_stat_statements WHERE query NOT ILIKE '%pg_timezone_names%'")
    rows = int(cur.fetchone()["rows"] or 0)
    mb = rows * BYTES_PER_ROW / 1e6
    month_gb = mb / days * 30 / 1000

    print(f"Counting since {since:%Y-%m-%d %H:%M} UTC ({days:.1f} days)")
    print(f"Rows returned: {rows:,}  (~{mb:,.0f} MB at ~{BYTES_PER_ROW} bytes/row)")
    print(f"Projected: ~{month_gb:.2f} GB/month vs {FREE_TIER_GB:.0f} GB free-tier limit ({month_gb / FREE_TIER_GB * 100:.0f}%)")
    if days < 2:
        print("(Less than 2 days of data, so the projection is rough.)")
    print("\nBiggest queries by rows returned:")
    cur.execute(
        """SELECT calls, rows, LEFT(REGEXP_REPLACE(query, '\\s+', ' ', 'g'), 100) AS q
           FROM pg_stat_statements WHERE query NOT ILIKE '%pg_timezone_names%' ORDER BY rows DESC LIMIT 8"""
    )
    for r in cur.fetchall():
        print(f"  {int(r['rows']):>9,} rows  {int(r['calls']):>7,} calls  {r['q']}")


if __name__ == "__main__":
    main()
