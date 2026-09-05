#!/usr/bin/env python3
import json,sys
from pathlib import Path
from collections import Counter
from lexicon_rules import example_mentions_entry
ROOT=Path(__file__).resolve().parents[1]; SRC=ROOT/'data/source'; WORK=ROOT/'data/work'
def load(p): return json.loads(p.read_text(encoding='utf8'))
errors=[]
lex=load(WORK/'lexicon.base.json'); senses=load(WORK/'lexicon.senses.json'); sent=load(WORK/'sentences.enriched.json'); ana=load(WORK/'analysis.enriched.json'); ctx=load(WORK/'corpus.translations.json'); wordctx=load(WORK/'word_contexts.json') if (WORK/'word_contexts.json').exists() else {}
terms={x['term'] for x in lex}
if set(senses)!=terms: errors.append(f'local lexicon sense key mismatch missing={list(terms-set(senses))[:10]} extra={list(set(senses)-terms)[:10]}')
bad=[]
for x in lex:
    s=senses.get(x['term'],{})
    if not s.get('sense_zh') or not s.get('dict_zh'): bad.append((x['term'],'zh'))
    if x.get('type')=='word' and not s.get('definition_en'): bad.append((x['term'],'definition_en'))
if bad: errors.append(f'incomplete dictionary/senses after backfill: {bad[:20]}')
need=[x for x in lex if not x.get('contexts')]
missing_ctx=[]
for x in need:
    z=wordctx.get(x['term'])
    if not z or not z.get('example_en') or not z.get('example_zh') or not example_mentions_entry(x,z.get('example_en','')):
        missing_ctx.append(x['term'])
if missing_ctx: errors.append(f'practice contexts missing/invalid {len(missing_ctx)}: {missing_ctx[:20]}')
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
print(f'Lexicon dictionary is complete (local-first + limited missing-field backfill); DeepSeek sentence stage covers 600 sentence content, 100 analyses, and {len(need)} missing practice contexts.')
