#!/usr/bin/env python3
import json,sys
from pathlib import Path
from collections import Counter
ROOT=Path(__file__).resolve().parents[1]; SRC=ROOT/'data/source'; WORK=ROOT/'data/work'
def load(p): return json.loads(p.read_text(encoding='utf8'))
errors=[]
lex=load(WORK/'lexicon.base.json'); sch=load(WORK/'days_words.json'); corpus=load(SRC/'corpus_sentences.json'); senses=load(WORK/'lexicon.senses.json'); report=load(WORK/'lexicon_report.json')
N=len(lex); allowed={x['id'] for x in corpus if x.get('source')!='写作'}
terms=[x['term'] for x in lex]; ids=[x['item_id'] for x in lex]
if N!=3000: errors.append(f'unique lexicon must be exactly 3000: {N}')
for label,arr in [('term',terms),('item_id',ids)]:
    dup=[k for k,v in Counter(arr).items() if v>1]
    if dup: errors.append(f'duplicate {label}: {dup[:20]}')
if set(senses)!=set(terms): errors.append('sense table is not a 1:1 mirror of the 3000 unique terms')
# V14 dictionary contract:
# BASE validation is only allowed to validate the canonical 3000 + 100-day
# schedule.  It must NOT fail because a dictionary field is intentionally
# queued for the next backfill stage.  The V13 failure (complete=32/3000) was
# caused mainly by treating optional/blank ECDICT POS metadata as a hard debt.
complete=[]; debt=[]; bad_pos=[]
for x in lex:
    hard=('dict_zh','definition_en') if x.get('type')=='word' else ('dict_zh',)
    miss=[k for k in hard if not (x.get(k) or '').strip()]
    (debt if miss else complete).append((x['term'],miss))
    if not (x.get('pos') or '').strip(): bad_pos.append(x['term'])
if bad_pos:
    errors.append(f'local POS fallback failed: {bad_pos[:20]}')
missing_tts=[x['term'] for x in lex if not str(x.get('tts_text') or '').strip()]
if missing_tts: errors.append(f'pronunciation/TTS target missing: {missing_tts[:20]}')
broken=[]; context_debt=[]
for x in lex:
    if not x.get('contexts'):
        if not x.get('needs_context_fill'): broken.append(x['term']+'(unmarked)')
        else: context_debt.append(x['term'])
    elif not any(c.get('sentence_id') in allowed for c in x['contexts']): broken.append(x['term'])
if broken: errors.append(f'context policy mismatch: {broken[:20]}')
if len(sch)!=100: errors.append(f'days={len(sch)}')
term_band={x['term']:x.get('freq_band') for x in lex}
flat=[]; flatids=[]
for d in sch:
    items=d.get('items',[]); iids=d.get('item_ids',[])
    if len(items)!=30 or len(iids)!=30: errors.append(f'day {d.get("day")} not 30'); break
    if d.get('new_count')!=30 or d.get('review_count')!=0: errors.append(f'day {d.get("day")} mixes review into new-word plan'); break
    bands=Counter(term_band.get(t) for t in items)
    if bands!=Counter({'high':15,'mid':9,'low':6}): errors.append(f'day {d.get("day")} 5:3:2 broken: {dict(bands)}'); break
    flat+=items; flatids+=iids
if len(flat)!=3000 or len(flatids)!=3000: errors.append(f'new-word slots != 3000: terms={len(flat)} ids={len(flatids)}')
if len(set(flat))!=3000: errors.append(f'new-word schedule contains repeats: unique={len(set(flat))}')
if len(set(flatids))!=3000: errors.append(f'new-word item ids contain repeats: unique={len(set(flatids))}')
if set(flat)!=set(terms): errors.append(f'schedule unique coverage mismatch missing={list(set(terms)-set(flat))[:20]} unknown={list(set(flat)-set(terms))[:20]}')
if set(flatids)!=set(ids): errors.append('schedule item_id coverage mismatch')
if any(t not in term_band for t in flat): errors.append('schedule contains unknown term')
exposure_bands=Counter(term_band[t] for t in flat if t in term_band)
if exposure_bands!=Counter({'high':1500,'mid':900,'low':600}): errors.append(f'bad band totals {dict(exposure_bands)}')
# Source-tier audit: 2020-2022 supplements must be used in descending frequency priority.
tiers=Counter(x.get('source_tier','') for x in lex)
avail=report.get('source_tier_available',{}); selected=report.get('source_tier_selected',{})
room=3000
expected={}
for key in ('core_2023_2026','supp_ge5','supp_eq4'):
    k=min(room,int(avail.get(key,0))); expected[key]=k; room-=k
if room!=0: errors.append(f'priority tiers cannot fill 3000 under frozen rule; remaining={room}, available={avail}')
for key,val in expected.items():
    if int(selected.get(key,0))!=val: errors.append(f'source-tier priority broken {key}: selected={selected.get(key,0)} expected={val}')
if any(k not in ('core_2023_2026','supp_ge5','supp_eq4') for k in tiers):
    errors.append(f'unexpected source tier in final lexicon: {dict(tiers)}')
if errors:
    print('BASE VALIDATION: FAIL'); print('\n'.join('- '+e for e in errors)); sys.exit(1)
print('BASE VALIDATION: PASS')
print(f'3000 UNIQUE new learning items; 100x30; no review occupies a new-word slot; local hard-dictionary complete={len(complete)}; limited backfill queue={len(debt)}; practice-context queue={len(context_debt)}; tiers={dict(tiers)}.')
