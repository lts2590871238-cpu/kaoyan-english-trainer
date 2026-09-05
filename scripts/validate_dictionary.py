#!/usr/bin/env python3
import json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; WORK=ROOT/'data/work'
def load(p): return json.loads(p.read_text(encoding='utf8'))
errors=[]
lex=load(WORK/'lexicon.base.json'); senses=load(WORK/'lexicon.senses.json'); lookup=load(WORK/'dictionary.lookup.base.json')
terms=[x['term'] for x in lex]; dmap={x.get('term'):x for x in lookup if x.get('term')}
missing=[]
for x in lex:
    t=x['term']; s=senses.get(t,{})
    miss=[]
    if not str(s.get('dict_zh') or x.get('dict_zh') or '').strip(): miss.append('dict_zh')
    if x.get('type')=='word' and not str(s.get('definition_en') or x.get('definition_en') or '').strip(): miss.append('definition_en')
    if not str(s.get('pos') or x.get('pos') or '').strip(): miss.append('pos_local_fallback')
    if miss: missing.append((t,miss))
if missing: errors.append(f'incomplete dictionary after limited backfill: {missing[:30]}')
absent=[t for t in terms if t not in dmap]
if absent: errors.append(f'scheduled terms absent from lookup: {absent[:30]}')
if errors:
    print('DICTIONARY VALIDATION: FAIL'); print('\n'.join('- '+e for e in errors)); sys.exit(1)
print('DICTIONARY VALIDATION: PASS')
print(f'{len(lex)}/{len(lex)} unique learning items have required Chinese meanings; all ordinary words have English definitions; POS is locally resolved; lookup entries={len(lookup)}.')
