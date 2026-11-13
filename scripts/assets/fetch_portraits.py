#!/usr/bin/env python3
"""Fetch public-domain congressional portraits and convert to WebP.

Source photos: https://github.com/unitedstates/images (GPO / Bioguide photos).
Re-runnable: cached originals and existing outputs are skipped.
"""
import io
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import requests
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CACHE = HERE / ".cache"
OUT = ROOT / "web" / "public" / "portraits"
BASE = "https://unitedstates.github.io"
LEG = BASE + "/congress-legislators/legislators-{}.json"
IMG = BASE + "/images/congress/450x550/{}.jpg"
SINCE = "2000-01-01"
W, H = 300, 366
MAX_WORKERS = 8
UA = "congressional-trading-map-asset-fetch/1.0"

session = requests.Session()
session.headers["User-Agent"] = UA


def get(url, tries=5):
    """GET with backoff on transient errors. Returns response (404 included)."""
    for i in range(tries):
        try:
            r = session.get(url, timeout=30)
            if r.status_code == 404:
                return r
            if r.status_code in (429, 500, 502, 503, 504):
                raise requests.HTTPError(str(r.status_code))
            r.raise_for_status()
            return r
        except requests.RequestException:
            if i == tries - 1:
                raise
            time.sleep(2 ** i)


def load_members():
    members = {}
    for kind in ("current", "historical"):
        for p in get(LEG.format(kind)).json():
            terms = [t for t in p["terms"] if t["end"] >= SINCE]
            if not terms:
                continue
            bio = p["id"].get("bioguide")
            if not bio:
                continue
            last = p["terms"][-1]
            n = p["name"]
            members[bio] = {
                "id": bio,
                "name": n.get("official_full") or f'{n.get("first","")} {n.get("last","")}'.strip(),
                "state": last["state"],
                "chamber": "senate" if last["type"] == "sen" else "house",
                "current": kind == "current",
            }
    return members


def convert(raw, dest):
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    sw, sh = im.size
    scale = max(W / sw, H / sh)
    nw, nh = round(sw * scale), round(sh * scale)
    im = im.resize((nw, nh), Image.LANCZOS)
    left = (nw - W) // 2
    top = 0  # centre-top crop keeps faces
    im = im.crop((left, top, left + W, top + H))
    im.save(dest, "WEBP", quality=78, method=6, exif=b"", icc_profile=None)


def work(bio):
    dest = OUT / f"{bio}.webp"
    cached = CACHE / f"{bio}.jpg"
    miss = CACHE / f"{bio}.404"
    if dest.exists():
        return bio, True, None
    if miss.exists():
        return bio, False, None
    try:
        if cached.exists():
            raw = cached.read_bytes()
        else:
            r = get(IMG.format(bio))
            if r.status_code == 404:
                miss.touch()
                return bio, False, None
            raw = r.content
            cached.write_bytes(raw)
        convert(raw, dest)
        return bio, True, None
    except Exception as e:  # noqa: BLE001
        return bio, False, f"{type(e).__name__}: {e}"


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    members = load_members()
    print(f"{len(members)} members since {SINCE}")
    have, errors = [], {}
    with ThreadPoolExecutor(MAX_WORKERS) as ex:
        for bio, ok, err in ex.map(work, sorted(members)):
            if ok:
                have.append(bio)
            if err:
                errors[bio] = err
    have.sort()
    missing = sorted(
        ({k: m[k] for k in ("id", "name", "state", "chamber")}
         for b, m in members.items() if m["current"] and b not in set(have)),
        key=lambda m: m["id"])
    # Preserve retrieved_at if nothing changed, for stable diffs.
    idx_path = OUT / "index.json"
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    new = {"have": have, "missing_current": missing,
           "source": "https://github.com/unitedstates/images (GPO/Bioguide, public domain)"}
    if idx_path.exists():
        old = json.loads(idx_path.read_text())
        if {k: old.get(k) for k in new} == new:
            stamp = old.get("retrieved_at", stamp)
    new["retrieved_at"] = stamp
    idx_path.write_text(json.dumps(new, indent=1) + "\n")
    print(f"have={len(have)} missing_current={len(missing)} errors={len(errors)}")
    for b, e in errors.items():
        print("ERROR", b, e, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
