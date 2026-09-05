#!/usr/bin/env python3
import json, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
WORK=ROOT/'data/work'
lex=json.loads((WORK/'lexicon.base.json').read_text(encoding='utf8'))
report=json.loads((WORK/'lexicon_report.json').read_text(encoding='utf8'))
errors=[]
if len(lex)!=3000 or len({x.get('term') for x in lex})!=3000:
    errors.append('canonical lexicon is not 3000 unique items')
pos_missing=[x['term'] for x in lex if not str(x.get('pos') or '').strip()]
if pos_missing:
    errors.append(f'POS local fallback missing: {pos_missing[:20]}')
tts_missing=[x['term'] for x in lex if str(x.get('tts_text') or '').strip()!=str(x.get('term') or '').strip()]
if tts_missing:
    errors.append(f'TTS pronunciation target missing: {tts_missing[:20]}')
# V14 contract: POS must never be part of the AI debt queue.
bad_debt=[]
computed=0
for x in lex:
    hard=('dict_zh','definition_en') if x.get('type')=='word' else ('dict_zh',)
    miss=[k for k in hard if not str(x.get(k) or '').strip()]
    if any(k not in ('dict_zh','definition_en') for k in x.get('missing_dictionary_fields',[])):
        bad_debt.append((x['term'],x.get('missing_dictionary_fields')))
    if miss: computed+=1
if bad_debt:
    errors.append(f'non-hard field leaked into backfill debt: {bad_debt[:20]}')
if int(report.get('dictionary_backfill_items',-1))!=computed:
    errors.append(f'backfill report mismatch report={report.get("dictionary_backfill_items")} computed={computed}')
if errors:
    print('DICTIONARY CONTRACT SELFTEST: FAIL')
    print('\n'.join('- '+e for e in errors))
    sys.exit(1)
print('DICTIONARY CONTRACT SELFTEST: PASS')
print(f'3000 unique items; POS locally resolved for all; TTS pronunciation target=3000/3000; hard dictionary backfill queue={computed}; POS AI calls=0.')
