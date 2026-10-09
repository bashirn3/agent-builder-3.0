#!/usr/bin/env python3
"""Turn the crawled station snapshot into the compact directory embedded in the Muster Code node.

Input : design/k1-fresh/data/k1-stations.json (from k1-stations.py)
Output: design/k1-fresh/data/k1-directory.json
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
snapshot = json.loads((ROOT / "data/k1-stations.json").read_text())

entries = []
for station in snapshot["stations"]:
    title = station["title"]
    closed = station["closed_on_site"] or title.upper().startswith("SULJETTU")
    clean = re.sub(r"^SULJETTU\s+", "", title, flags=re.I)
    heavy = bool(re.search(r"\((raskas|heavy)\)|\braskas\b", clean, re.I))
    city = re.search(r"\d{5}\s+(.+)$", station["address"] or "")
    entries.append({
        "slug": station["slug"],
        "name": f"K1 Katsastus {clean}",
        "address": re.sub(r"\s+,", ",", station["address"] or ""),
        "city": city.group(1).strip() if city else clean.split()[0],
        "url": station["url"],
        "k1_id": station.get("k1_booking_station_id"),
        "closed": closed or None,
        "heavy": heavy or None,
        "aliases": [],
    })

by_slug = {e["slug"]: e for e in entries}
for slug, extra in snapshot["reminder_only_stations"].items():
    reminder = re.sub(r"^SULJETTU\s+", "", extra["reminder_name"], flags=re.I)
    reminder = re.sub(r"^K1\s+(Katsastus\s+)?", "", reminder)
    target = by_slug.get(slug) or by_slug.get(f"{slug}-raskas")
    if target:
        target["aliases"].append(f"K1 Katsastus {reminder}")
    else:
        entries.append({
            "slug": slug, "name": f"K1 Katsastus {reminder}", "address": "", "city": reminder.split()[0],
            "url": None, "k1_id": None, "closed": extra["closed"] or None, "heavy": "raskas" in reminder.lower() or None, "aliases": [],
        })

for entry in entries:
    for key in [k for k, v in entry.items() if v in (None, [])]:
        del entry[key]
    entry.setdefault("aliases", [])

(ROOT / "data/k1-directory.json").write_text(json.dumps(entries, ensure_ascii=False, indent=1) + "\n")
print(f"{len(entries)} stations, {sum(1 for e in entries if not e.get('closed'))} open, {sum(1 for e in entries if e.get('k1_id') and not e.get('closed'))} readable")
