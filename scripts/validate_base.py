#!/usr/bin/env python3
import json,sys
from pathlib import Path
from collections import Counter
ROOT=Path(__file__).resolve().parents[1]; SRC=ROOT/'data/source'; WORK=ROOT/'data/work'
def load(p): return json.loads(p.read_text(encoding='utf8'))
errors=[]
lex=load(WORK/'lexicon.base.json'); sch=load(WORK/'days_words.json'); corpus=load(SRC/'corpus_sentences.json'); senses=load(WORK/'lexicon.senses.json')
allowed={x['id'] for x in corpus if x.get('source')!='写作'}
terms=[x['term'] for x in lex]; ids=[x['item_id'] for x in lex]
if len(lex)!=3000: errors.append(f'base lexicon count={len(lex)}')
for label,arr in [('term',terms),('item_id',ids)]:
    dup=[k for k,v in Counter(arr).items() if v>1]
    if dup: errors.append(f'duplicate {label}: {dup[:20]}')
if set(senses)!=set(terms): errors.append('sense table is not a 1:1 mirror of the 3000 terms')
# V11: dictionary completeness is NOT a prerequisite for selecting the 3000 learning items.
# We only require that local sources cover the large majority; the small debt is backfilled in one limited batch stage.
complete=[]; debt=[]
for x in lex:
    miss=[k for k in ('dict_zh','definition_en','pos') if not (x.get(k) or '').strip()]
    (debt if miss else complete).append((x['term'],miss))
if len(complete)<2400:
    errors.append(f'local dictionary coverage unexpectedly low: complete={len(complete)} / 3000; refuse to make AI the primary dictionary')
broken=[]; context_debt=[]
for x in lex:
    if not x.get('contexts'):
        if not x.get('needs_context_fill'): broken.append(x['term']+'(unmarked)')
        else: context_debt.append(x['term'])
    elif not any(c.get('sentence_id') in allowed for c in x['contexts']): broken.append(x['term'])
if broken: errors.append(f'context policy mismatch: {broken[:20]}')
if len(sch)!=100: errors.append(f'days={len(sch)}')
for d in sch:
    if len(d.get('items',[]))!=30 or len(d.get('item_ids',[]))!=30: errors.append(f'day {d.get("day")} not 30'); break
flat=[t for d in sch for t in d.get('items',[])]; flatids=[t for d in sch for t in d.get('item_ids',[])]
if len(flat)!=3000 or Counter(flat)!=Counter(terms): errors.append('schedule term mismatch')
if len(flatids)!=3000 or Counter(flatids)!=Counter(ids): errors.append('schedule item_id mismatch')
bands=Counter(x.get('freq_band') for x in lex)
if bands!=Counter({'high':1500,'mid':900,'low':600}): errors.append(f'bad bands {dict(bands)}')
if errors:
    print('BASE VALIDATION: FAIL'); print('\n'.join('- '+e for e in errors)); sys.exit(1)
print('BASE VALIDATION: PASS')
print(f'3000 unique canonical learning items; 100x30 schedule exact; local dictionary complete={len(complete)}; limited dictionary backfill queue={len(debt)}; practice-context queue={len(context_debt)}.')
