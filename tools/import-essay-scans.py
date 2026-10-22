#!/usr/bin/env python3
"""Download public annual English-I papers and render their Part B writing question page.
Use source scans from user-supplied handoff as the authoritative QA reference.
Run only in repository CI. It never affects unrelated generated training data.
"""
from __future__ import annotations

import io
import sys
import time
from pathlib import Path

import fitz
import requests
from PIL import Image

OUT = Path("essay-scans")
OUT.mkdir(parents=True, exist_ok=True)
failed = []
for year in range(2005, 2026):
    target = OUT / f"{year}.jpg"
    url = "https://static.zmxiaodao.com/downloads/%s-%s.pdf" % (
        year, "eng1" if year >= 2010 else "eng"
    )
    try:
        response = requests.get(
            url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; essay-archive-import/1.0)"},
            timeout=(15, 50),
        )
        response.raise_for_status()
        if response.content[:4] != b"%PDF":
            raise RuntimeError("response is not a PDF")
        with fitz.open(stream=response.content, filetype="pdf") as paper:
            # Writing is the last section; choose the final page that actually
            # includes Part B directions, rather than a preceding reading page.
            candidates = list(range(max(0, len(paper) - 5), len(paper)))
            strong = [
                p for p in candidates
                if "part b" in paper[p].get_text().lower()
                and ("writing" in paper[p].get_text().lower()
                     or "52. directions" in paper[p].get_text().lower())
            ]
            chosen = strong[-1] if strong else len(paper) - 1
            pix = paper[chosen].get_pixmap(
                matrix=fitz.Matrix(1.65, 1.65), alpha=False
            )
            with Image.open(io.BytesIO(pix.tobytes("png"))) as raw:
                raw.convert("RGB").save(
                    target, "JPEG", quality=83, optimize=True, progressive=True
                )
        if target.stat().st_size < 18000:
            raise RuntimeError("scan unexpectedly small")
        print(f"OK {year} page {chosen + 1}: {target.stat().st_size} bytes")
    except Exception as exc:
        failed.append(f"{year}: {exc}")
        if target.exists():
            target.unlink()
    time.sleep(0.2)

if failed:
    print("\n".join(failed), file=sys.stderr)
    sys.exit("Missing original exam pages; refusing incomplete publish")
assert len(list(OUT.glob("*.jpg"))) == 21, "must have all 21 pages"
print("All 21 visual papers rendered.")
