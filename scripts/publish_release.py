#!/usr/bin/env python3
import shutil,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; CAND=ROOT/'data/candidate'; GEN=ROOT/'data/generated'; CKPT=ROOT/'data/checkpoints'
required=['lexicon.json','lexicon_index.json','dictionary_lookup.json','sentences.json','sentence_meta.json','corpus.json','analysis.json','context_translations.json','schedule.json','meta.json']
for f in required:
    if not (CAND/f).exists(): raise SystemExit('candidate missing '+f)
GEN.mkdir(parents=True,exist_ok=True)
# Remove only release JSONs; do not expose partially generated work/checkpoints to the website.
for f in required:
    shutil.copy2(CAND/f,GEN/f)
# Successful publish makes old recovery checkpoints unnecessary.
if CKPT.exists(): shutil.rmtree(CKPT)
legacy=GEN/'checkpoints'
if legacy.exists(): shutil.rmtree(legacy)
print('PUBLISH RELEASE: COMPLETE')
