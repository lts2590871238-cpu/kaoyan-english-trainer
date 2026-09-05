#!/usr/bin/env python3
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'data/source'
adds=json.loads((SRC/'v16_core_phrase_additions.json').read_text(encoding='utf8'))
phr=json.loads((SRC/'phrases_curated.json').read_text(encoding='utf8'))
corpus=json.loads((SRC/'corpus_sentences.json').read_text(encoding='utf8'))
errs=[]
if len(adds)!=81: errs.append(f'addition manifest count != 81: {len(adds)}')
for p,zh in adds.items():
    if phr.get(p)!=zh: errs.append(f'curated phrase missing/mismatched: {p}')
    hits=[s for s in corpus if int(s.get('year',0))>=2023 and s.get('source')!='写作' and p.lower() in s.get('text','').lower()]
    if not hits: errs.append(f'no 2023-2026 source evidence: {p}')
if errs:
    print('V16 CORE PHRASE PREFLIGHT: FAIL')
    for e in errs[:30]: print('-',e)
    raise SystemExit(1)
print('V16 CORE PHRASE PREFLIGHT: PASS additions=81 grounded=81')
