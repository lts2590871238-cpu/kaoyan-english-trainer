#!/usr/bin/env python3
"""Reuse only structurally complete AI outputs from an older partial release.
Never trusts old meta.ready and never reuses lexicon/dictionary release files.
"""
import json, shutil
from pathlib import Path
from collections import Counter
ROOT=Path(__file__).resolve().parents[1]
GEN=ROOT/'data/generated'; CKPT=ROOT/'data/checkpoints'; CKPT.mkdir(parents=True,exist_ok=True)

def load(name):
    p=GEN/name
    if not p.is_file(): return None
    try:return json.loads(p.read_text(encoding='utf8'))
    except:return None

def save_if(name,obj,ok):
    dst=CKPT/name
    if dst.exists() or not ok: return False
    dst.write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf8'); return True

sent=load('sentences.json')
ok_sent=isinstance(sent,dict) and len(sent)==600 and Counter(v.get('pool') for v in sent.values())==Counter({'en_to_zh':200,'zh_to_en':200,'free_translation':100,'analysis':100}) and all(v.get('en') and v.get('zh') and v.get('en_chunks') and v.get('zh_chunks') for v in sent.values())
ana=load('analysis.json')
ok_ana=isinstance(ana,dict) and len(ana)==100 and Counter(v.get('stage') for v in ana.values())==Counter({'precise':30,'coarse':30,'main_stem':40})
ctx=load('context_translations.json')
ok_ctx=isinstance(ctx,dict) and len(ctx)>=700 and all(isinstance(k,str) and isinstance(v,str) and v.strip() for k,v in list(ctx.items())[:700])
seeded=[]
if save_if('sentences.json',sent,ok_sent): seeded.append('sentences.json')
if save_if('analysis.json',ana,ok_ana): seeded.append('analysis.json')
if save_if('corpus_translations.json',ctx,ok_ctx): seeded.append('corpus_translations.json')
print('LEGACY SAFE CACHE SEED:', ', '.join(seeded) if seeded else 'nothing reusable')
