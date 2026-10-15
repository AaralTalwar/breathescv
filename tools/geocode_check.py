#!/usr/bin/env python3
"""geocode_check.py — compare each facility's lat/lon with the US Census Bureau geocoder.

Usage:
    python3 tools/geocode_check.py data/facilities.csv            # report only
    python3 tools/geocode_check.py data/facilities.csv --apply    # write Census coords into the CSV

This is the ONLY script that uses the network, and it is opt-in. It calls the free,
keyless Census geocoder (geocoding.geo.census.gov) once per row, prints the CSV's
coordinates next to the geocoder's, and the distance between them. You decide which
to keep; --apply overwrites lat/lon only for rows the geocoder matched.

Standard library only.
"""
import csv
import json
import math
import sys
import time
import urllib.parse
import urllib.request

CENSUS = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"


def haversine_mi(lat1, lon1, lat2, lon2):
    r = 3958.7613
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def geocode(address):
    q = urllib.parse.urlencode({"address": address, "benchmark": "Public_AR_Current", "format": "json"})
    req = urllib.request.Request(f"{CENSUS}?{q}", headers={"User-Agent": "BreatheSCV/0.1 (student project)"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.load(resp)
    matches = data.get("result", {}).get("addressMatches", [])
    if not matches:
        return None
    m = matches[0]
    return {"lat": m["coordinates"]["y"], "lon": m["coordinates"]["x"], "matched": m["matchedAddress"]}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    apply = "--apply" in sys.argv
    if len(args) != 1:
        print(__doc__)
        sys.exit(2)
    path = args[0]
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        rows = list(reader)

    print(f"{'name':42s} {'csv lat,lon':22s} {'census lat,lon':22s} {'diff mi':>8s}")
    changed = 0
    for row in rows:
        name = (row.get("name") or "")[:40]
        if name.startswith("Example rejected"):
            continue
        addr = f"{row['address']}, {row['city']}, CA {row['zip']}"
        try:
            g = geocode(addr)
        except Exception as e:  # network or parse error
            print(f"{name:42s} {'':22s} ERROR {e}")
            continue
        time.sleep(0.5)  # be polite
        if not g:
            print(f"{name:42s} {row['lat']},{row['lon']:<12s} no match — fix the address by hand")
            continue
        try:
            d = haversine_mi(float(row["lat"]), float(row["lon"]), g["lat"], g["lon"])
            dtxt = f"{d:8.2f}"
        except ValueError:
            dtxt = "     n/a"
        print(f"{name:42s} {row['lat']},{row['lon']:<12s} {g['lat']:.5f},{g['lon']:.5f}  {dtxt}")
        if apply:
            row["lat"], row["lon"] = f"{g['lat']:.5f}", f"{g['lon']:.5f}"
            changed += 1

    if apply:
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames)
            w.writeheader()
            w.writerows(rows)
        print(f"\nWrote Census coordinates for {changed} rows into {path}. Re-run tools/build_facilities.py.")
    else:
        print("\nReport only. Re-run with --apply to write the Census coordinates into the CSV.")


if __name__ == "__main__":
    main()
