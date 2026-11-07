"""Local research price store. Imports are atomic and duplicates immutable."""
import csv
from contextlib import closing
from datetime import timezone
import sqlite3
from .research import number, timestamp


def import_prices(csv_path, database_path):
    rows = []
    with open(csv_path, newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            observed_time = timestamp(row["timestamp"])
            received_time = timestamp(row["receivedAt"])
            if received_time < observed_time:
                raise ValueError("Receipt cannot precede observation")
            ts = observed_time.astimezone(timezone.utc).isoformat()
            received = received_time.astimezone(timezone.utc).isoformat()
            price = number(float(row["close"]))
            if price <= 0 or not row["symbol"] or not row["source"] or not row["currency"]:
                raise ValueError("Positive close, symbol, source and currency required")
            rows.append((row["symbol"], ts, row["source"], row["currency"], price, received))
    with closing(sqlite3.connect(database_path, autocommit=False)) as db, db:
        db.execute("CREATE TABLE IF NOT EXISTS prices (symbol TEXT, timestamp TEXT, source TEXT, currency TEXT, close REAL, received_at TEXT, PRIMARY KEY(symbol,timestamp,source))")
        inserted = 0
        for row in rows:
            existing = db.execute("SELECT currency, close, received_at FROM prices WHERE symbol=? AND timestamp=? AND source=?", row[:3]).fetchone()
            if existing:
                if existing != row[3:]:
                    raise ValueError("Conflicting price revision; use a distinct versioned source")
            else:
                db.execute("INSERT INTO prices VALUES (?,?,?,?,?,?)", row)
                inserted += 1
    return {"inserted": inserted, "duplicates": len(rows)-inserted}

