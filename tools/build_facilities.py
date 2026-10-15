#!/usr/bin/env python3
"""build_facilities.py — validate data/facilities.csv and write data/facilities.json.

Usage:
    python3 tools/build_facilities.py data/facilities.csv data/facilities.json
    python3 tools/build_facilities.py data/facilities.csv data/facilities.json --include-unverified

Rules (spec §13, FR-20, AC-13):
  * required: name, type, address, city, zip, lat, lon, source_url, verified_on
  * type must be one of TYPES
  * zip must be 5 digits
  * lat/lon must be inside California (32–42 N, -125 to -114 E)
  * source_url must start with https://
  * verified_on must be an ISO date (YYYY-MM-DD) not in the future
  * duplicates by (name, zip) are rejected
  * no network calls — rows missing coordinates are listed for the student to fix by hand

Only verified rows ship. --include-unverified keeps rows with a blank verified_on
(marked "verified": false) so the map can be tried before the phone calls are done.
Standard library only.
"""
import csv
import json
import re
import sys
from collections import Counter
from datetime import date, datetime, timezone

TYPES = {"library", "community_center", "senior_center", "cooling_center", "indoor_rec"}
REQUIRED = ["name", "type", "address", "city", "zip", "lat", "lon", "source_url", "verified_on"]
CA_LAT = (32.0, 42.0)
CA_LON = (-125.0, -114.0)


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def parse_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def validate_row(row, line_no, include_unverified):
    """Return (item, errors, warnings). item is None when the row is rejected."""
    errors, warnings = [], []
    get = lambda k: (row.get(k) or "").strip()

    for key in REQUIRED:
        if key in ("lat", "lon", "verified_on"):
            continue  # handled below with specific messages
        if not get(key):
            errors.append(f"missing {key}")

    if get("type") and get("type") not in TYPES:
        errors.append(f"type '{get('type')}' not in {sorted(TYPES)}")
    if get("zip") and not re.fullmatch(r"\d{5}", get("zip")):
        errors.append(f"zip '{get('zip')}' is not 5 digits")
    if get("source_url") and not get("source_url").startswith("https://"):
        errors.append("source_url must start with https://")

    lat, lon = parse_float(get("lat")), parse_float(get("lon"))
    if lat is None or lon is None:
        errors.append("missing coordinates (lat/lon) — look them up by hand on the official page or a map")
    else:
        if not (CA_LAT[0] <= lat <= CA_LAT[1]):
            errors.append(f"lat {lat} outside California ({CA_LAT[0]}–{CA_LAT[1]})")
        if not (CA_LON[0] <= lon <= CA_LON[1]):
            errors.append(f"lon {lon} outside California ({CA_LON[0]}–{CA_LON[1]})")

    verified = True
    v = get("verified_on")
    if not v:
        if include_unverified:
            verified = False
            warnings.append("no verified_on — included as UNVERIFIED (dev build only)")
        else:
            errors.append("missing verified_on (only verified rows ship)")
    else:
        try:
            d = datetime.strptime(v, "%Y-%m-%d").date()
            if d > date.today():
                errors.append(f"verified_on {v} is in the future")
        except ValueError:
            errors.append(f"verified_on '{v}' is not an ISO date (YYYY-MM-DD)")

    if errors:
        return None, errors, warnings

    item = {
        "id": slugify(f"{get('name')}-{get('zip')}"),
        "name": get("name"),
        "type": get("type"),
        "address": get("address"),
        "city": get("city"),
        "zip": get("zip"),
        "lat": round(lat, 5),
        "lon": round(lon, 5),
        "hoursNote": get("hours_note"),
        "sourceUrl": get("source_url"),
        "verifiedOn": v or None,
        "verified": verified,
    }
    if get("notes"):
        item["notes"] = get("notes")
    return item, errors, warnings


def build(csv_path, json_path, include_unverified=False):
    items, rejected, seen = [], [], set()
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        missing_cols = [c for c in REQUIRED if c not in (reader.fieldnames or [])]
        if missing_cols:
            raise SystemExit(f"CSV is missing required columns: {missing_cols}")
        for line_no, row in enumerate(reader, start=2):
            if not any((v or "").strip() for v in row.values()):
                continue  # blank line
            item, errors, warnings = validate_row(row, line_no, include_unverified)
            label = (row.get("name") or f"line {line_no}").strip()
            for w in warnings:
                print(f"  warn  line {line_no} {label}: {w}")
            if item is None:
                rejected.append((line_no, label, errors))
                continue
            key = (item["name"].lower(), item["zip"])
            if key in seen:
                rejected.append((line_no, label, ["duplicate of an earlier row (same name + zip)"]))
                continue
            seen.add(key)
            items.append(item)

    items.sort(key=lambda i: (i["type"], i["name"]))
    out = {
        "builtAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source": csv_path,
        "count": len(items),
        "items": items,
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write("\n")

    print(f"\nWrote {json_path}: {len(items)} facilities")
    for t, n in sorted(Counter(i["type"] for i in items).items()):
        print(f"  {t:18s} {n}")
    if rejected:
        print(f"\nRejected {len(rejected)} row(s) — fix these by hand:")
        for line_no, label, errors in rejected:
            print(f"  line {line_no} {label}:")
            for e in errors:
                print(f"      - {e}")
    return len(items), len(rejected)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    if len(args) != 2:
        print(__doc__)
        sys.exit(2)
    n_ok, n_bad = build(args[0], args[1], include_unverified="--include-unverified" in flags)
    sys.exit(0)
