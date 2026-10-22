#!/usr/bin/env python3
"""Import the English-I 2026 writing page; compare with the user-provided exam scan before publishing."""
from pathlib import Path
import io
import requests
import pymupdf
from PIL import Image

destination=Path("essay-scans/2026.jpg")
destination.parent.mkdir(parents=True,exist_ok=True)
candidates=[
 "https://static.zmxiaodao.com/downloads/2026-eng1.pdf",
 "https://static.zmxiaodao.com/downloads/2026-english1.pdf"
]
last=None
for url in candidates:
 try:
  res=requests.get(url,timeout=(15,45),headers={"User-Agent":"Mozilla/5.0"})
  print(f"GET {url} -> {res.status_code} bytes={len(res.content)}")
  res.raise_for_status()
  if not res.content.startswith(b"%PDF"):raise ValueError("not a PDF")
  with pymupdf.open(stream=res.content,filetype="pdf") as doc:
   pages=list(range(max(0,len(doc)-6),len(doc)))
   good=[i for i in pages if "section iii" in doc[i].get_text().lower() and "part b" in doc[i].get_text().lower()]
   if not good:
    print("No text-searchable Part A/B page; rendering final page for human visual review")
    for n in pages: print("candidate",n+1,"text sample",repr(doc[n].get_text()[:100]))
   i=good[-1] if good else len(doc)-1
   t=doc[i].get_text().lower()
   if good and "charts" not in t:raise ValueError("Not the 2026 charts question")
   pix=doc[i].get_pixmap(matrix=pymupdf.Matrix(1.85,1.85),alpha=False)
   with Image.open(io.BytesIO(pix.tobytes("png"))) as im:
    im.convert("RGB").save(destination,"JPEG",quality=86,optimize=True,progressive=True)
   print(f"2026 writing page={i+1}/{len(doc)}, bytes={destination.stat().st_size}")
  if destination.stat().st_size<20000:raise ValueError("image too small")
  break
 except Exception as exc:
  last=exc;print(f"FAIL: {type(exc).__name__}: {exc}")
else:raise SystemExit(f"Could not import source scan; manual image is required. Last error: {last}")
