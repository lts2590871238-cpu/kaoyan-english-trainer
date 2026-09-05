#!/usr/bin/env python3
import json,sys
from pathlib import Path
from collections import Counter
ROOT=Path(__file__).resolve().parents[1]; SRC=ROOT/'data/source'; WORK=ROOT/'data/work'
def load(p): return json.loads(p.read_text(encoding='utf8'))
errors=[]
lex=load(WORK/'lexicon.base.json'); senses=load(WORK/'lexicon.senses.json'); sent=load(WORK/'sentences.enriched.json'); ana=load(WORK/'analysis.enriched.json'); ctx=load(WORK/'corpus.translations.json')
terms={x['term'] for x in lex}
if set(senses)!=terms:
    errors.append(f'lexicon sense key mismatch missing={list(terms-set(senses))[:10]} extra={list(set(senses)-terms)[:10]}')
missing=[]
for x in lex:
    s=senses.get(x['term'],{})
    if not s.get('sense_zh') or not s.get('dict_zh') or (x['type']=='word' and not s.get('definition_en')) or (x.get('needs_context_fill') and (not s.get('example_en') or not s.get('example_zh'))): missing.append(x['term'])
if missing: errors.append(f'incomplete AI lexicon fields: {missing[:20]}')
if len(sent)!=600: errors.append(f'sentence enrichment count={len(sent)}')
bad_sent=[k for k,v in sent.items() if not v.get('zh') or not v.get('en_chunks') or not v.get('zh_chunks')]
if bad_sent: errors.append(f'incomplete sentence enrichment: {bad_sent[:20]}')
if len(ana)!=100: errors.append(f'analysis count={len(ana)}')
stages=Counter(v.get('stage') for v in ana.values())
if stages!=Counter({'precise':30,'coarse':30,'main_stem':40}): errors.append(f'analysis stages={dict(stages)}')
allowed={x['id'] for x in load(SRC/'corpus_sentences.json') if x.get('source')!='写作'}
if not allowed.issubset(set(ctx)): errors.append(f'context translations missing {len(allowed-set(ctx))}: {list(allowed-set(ctx))[:20]}')
if errors:
    print('AI OUTPUT VALIDATION: FAIL'); print('\n'.join('- '+e for e in errors)); sys.exit(1)
print('AI OUTPUT VALIDATION: PASS')
