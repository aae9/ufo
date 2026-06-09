#!/usr/bin/env python3
"""Build a JSON manifest of UAP files in Release_1 and uapvideos folders."""

import json
import os
import re
from collections import Counter

BASE = "/sessions/eloquent-jolly-dijkstra/mnt/ufo"
FOLDERS = ["Release_1", "uapvideos"]
OUT_PATH = os.path.join(BASE, "uap_files_manifest.json")

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}
MONTH_PATTERN = re.compile(
    r"\b(January|February|March|April|May|June|July|August|September|October|November|December)\b",
    re.IGNORECASE,
)
YEAR_PATTERN = re.compile(r"(?<!\d)(1[89]\d{2}|20\d{2})(?!\d)")
MONTH_YEAR_PATTERN = re.compile(
    r"\b(January|February|March|April|May|June|July|August|September|October|November|December)[-_ ]?(\d{0,2}[-_ ]?)?(1[89]\d{2}|20\d{2})\b",
    re.IGNORECASE,
)
ISO_DATE_PATTERN = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")
DXX_PATTERN = re.compile(r"\b(D\d{1,3}|VM\d{1,3})\b")


def detect_agency(name: str) -> str:
    upper = name.upper()
    if upper.startswith("DOS"):
        return "DOS"
    if upper.startswith("DOW"):
        return "DOW"
    if upper.startswith("NASA"):
        return "NASA"
    if upper.startswith("FBI"):
        return "FBI"
    if upper.startswith("DOD_") or upper.startswith("DOD-"):
        return "DOD"
    if upper.startswith("65_"):
        return "FBI"
    if upper.startswith(("342_", "18_", "38_")):
        return "ARMY"
    if re.match(r"^\d+_", name):
        return "ARMY"
    return "OTHER"


def extract_year(stem: str):
    # Prefer year preceded by month name
    m = MONTH_YEAR_PATTERN.search(stem)
    if m:
        try:
            return int(m.group(3))
        except Exception:
            pass
    # Fallback: any 4-digit year
    matches = YEAR_PATTERN.findall(stem)
    if matches:
        try:
            return int(matches[-1])
        except Exception:
            pass
    return None


def extract_month(stem: str):
    m = MONTH_PATTERN.search(stem)
    if m:
        return MONTHS[m.group(1).lower()]
    return None


def extract_day(stem: str):
    m = ISO_DATE_PATTERN.match(stem)
    if m:
        try:
            d = int(m.group(3))
            if 1 <= d <= 31:
                return d
        except Exception:
            pass
    return None


def extract_location(stem: str, agency: str):
    if agency not in ("DOS", "DOW"):
        return None
    patterns = [
        r"^(?:DOS|DOW)-UAP-D\d+-Cable-\d+-(.+?)(?:-(?:January|February|March|April|May|June|July|August|September|October|November|December)|-\d{4}|$)",
        r"^(?:DOS|DOW)-UAP-D\d+-Mission-Report[,-]+(.+?)(?:-(?:January|February|March|April|May|June|July|August|September|October|November|December)|-\d{4}|-NA|$)",
        r"^(?:DOS|DOW)-UAP-D\d+-Range-Fouler-Debrief-(.+?)(?:-(?:January|February|March|April|May|June|July|August|September|October|November|December)|-\d{4}|-NA|$)",
        r"^(?:DOS|DOW)-UAP-D\d+-Range-Fouler-(.+?)(?:-(?:January|February|March|April|May|June|July|August|September|October|November|December)|-\d{4}|-NA|$)",
        r"^(?:DOS|DOW)-UAP-D\d+-Email-Correspond[ae]nce-(.+?)(?:-(?:January|February|March|April|May|June|July|August|September|October|November|December)|-\d{4}|-NA|$)",
        r"^(?:DOS|DOW)-UAP-D\d+-Launch-Summary-(.+?)(?:-(?:January|February|March|April|May|June|July|August|September|October|November|December)|-\d{4}|$)",
    ]
    for pat in patterns:
        m = re.search(pat, stem, re.IGNORECASE)
        if m:
            loc = m.group(1)
            loc = loc.strip("-_ ").replace("-", " ").replace("_", " ").strip()
            if loc and loc.upper() != "NA":
                return loc
    return None


def extract_id(stem: str):
    m = DXX_PATTERN.search(stem)
    if m:
        return m.group(1)
    return None


def clean_title(stem: str, agency: str, doc_id):
    s = stem
    s = re.sub(r"^(DOS|DOW|NASA|FBI|DOD)[-_]?UAP[-_]?", "", s, flags=re.IGNORECASE)
    s = re.sub(r"^(DOS|DOW|NASA|FBI|DOD)[-_]", "", s, flags=re.IGNORECASE)
    s = re.sub(r"^\d+[_-]", "", s)
    if doc_id:
        s = re.sub(r"\b" + re.escape(doc_id) + r"\b[-_]?", "", s)
    s = re.sub(
        r"[-_,\s]+(January|February|March|April|May|June|July|August|September|October|November|December)([-_ ]?\d{0,2})?[-_ ]?\d{4}\s*$",
        "",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(r"[-_,\s]+\d{4}\s*$", "", s)
    s = re.sub(r"[-_,\s]+NA\s*$", "", s)
    s = s.replace("_", " ").replace("-", " ")
    s = re.sub(r"\s+", " ", s).strip(" ,-_")
    if not s:
        return stem.replace("_", " ").replace("-", " ").strip()
    words = s.split(" ")
    preserve = {"UAP", "UFO", "US", "USA", "FBI", "NASA", "DOD", "DOS", "DOW",
                "INDOPACOM", "USPER", "NA", "TS", "HQ", "DE", "SP"}
    out = []
    for w in words:
        if w.upper() in preserve:
            out.append(w.upper())
        elif w.isupper() and len(w) <= 4:
            out.append(w)
        else:
            out.append(w[:1].upper() + w[1:] if w else w)
    return " ".join(out)


def parse_file(filename: str, folder: str):
    stem, ext = os.path.splitext(filename)
    ext_clean = ext.lstrip(".").lower()
    agency = detect_agency(filename)
    year = extract_year(stem)
    month = extract_month(stem)
    day = extract_day(stem)
    doc_id = extract_id(stem)
    location = extract_location(stem, agency)
    title = clean_title(stem, agency, doc_id)
    return {
        "filename": filename,
        "folder": folder,
        "extension": ext_clean,
        "agency": agency,
        "year": year,
        "month": month,
        "day": day,
        "location": location,
        "title": title,
        "id": doc_id,
    }


def main():
    entries = []
    for folder in FOLDERS:
        folder_path = os.path.join(BASE, folder)
        if not os.path.isdir(folder_path):
            continue
        for name in os.listdir(folder_path):
            full = os.path.join(folder_path, name)
            if os.path.isfile(full):
                entries.append(parse_file(name, folder))

    entries.sort(
        key=lambda e: (
            -(e["year"] if e["year"] is not None else -9999),
            e["agency"],
            e["filename"],
        )
    )

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2, ensure_ascii=False)

    total = len(entries)
    by_agency = Counter(e["agency"] for e in entries)
    by_year = Counter(e["year"] for e in entries)
    by_ext = Counter(e["extension"] for e in entries)

    print(f"Wrote {OUT_PATH}")
    print(f"Total files: {total}")
    print()
    print("By agency:")
    for k, v in sorted(by_agency.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"  {k}: {v}")
    print()
    print("By extension:")
    for k, v in sorted(by_ext.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"  {k}: {v}")
    print()
    print("By year:")
    for k, v in sorted(by_year.items(), key=lambda kv: (kv[0] is None, -(kv[0] or 0))):
        print(f"  {k}: {v}")

    examples = [e for e in entries if e["year"] is not None][:5]
    print()
    print("5 example entries:")
    for e in examples:
        print(json.dumps(e, ensure_ascii=False))

    no_year = [e["filename"] for e in entries if e["year"] is None]
    print()
    print(f"Files with no year ({len(no_year)}):")
    for n in no_year:
        print(f"  {n}")


if __name__ == "__main__":
    main()
