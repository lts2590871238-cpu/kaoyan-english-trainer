#!/usr/bin/env python3
import json,sys
from pathlib import Path
from collections import Counter
ROOT=Path(__file__).resolve().parents[1]
TARGET=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'data/candidate'
def load(p): return json.loads(p.read_text(encoding='utf8'))
errors=[]
req=['lexicon.json','lexicon_index.json','dictionary_lookup.json','sentences.json','sentence_meta.json','corpus.json','analysis.json','context_translations.json','schedule.json','meta.json']
for f in req:
    if not (TARGET/f).exists(): errors.append('missing '+f)
if errors: print('RELEASE VALIDATION: FAIL'); print('\n'.join('- '+e for e in errors)); sys.exit(1)
lex=load(TARGET/'lexicon.json'); dlookup=load(TARGET/'dictionary_lookup.json'); lexi=load(TARGET/'lexicon_index.json'); sent=load(TARGET/'sentences.json'); smeta=load(TARGET/'sentence_meta.json'); corpus=load(TARGET/'corpus.json'); ana=load(TARGET/'analysis.json'); ctx=load(TARGET/'context_translations.json'); sch=load(TARGET/'schedule.json')
terms=[x.get('term') for x in lex]; ids=[x.get('item_id') for x in lex]
def dups(xs): return [k for k,v in Counter(xs).items() if v>1][:20]
if len(lex)!=3000: errors.append(f'lexicon != 3000: {len(lex)}')
if dups(terms): errors.append(f'duplicate lexicon terms: {dups(terms)}')
if dups(ids): errors.append(f'duplicate lexicon ids: {dups(ids)}')
if len(dlookup)<3000: errors.append(f'local dictionary too small: {len(dlookup)}')
dmap={x.get('term'):x for x in dlookup}
missdict=[t for t in terms if t not in dmap]
if missdict: errors.append(f'scheduled terms absent from local dictionary: {missdict[:20]}')
baddict=[t for t in terms if not dmap.get(t,{}).get('dict_zh')]
if baddict: errors.append(f'scheduled dictionary terms without Chinese meaning: {baddict[:20]}')
if len(lexi)!=3000: errors.append(f'lexicon_index != 3000: {len(lexi)}')
misszh=[x['term'] for x in lex if not x.get('sense_zh') or not x.get('dict_zh')]
if misszh: errors.append(f'missing Chinese meanings: {misszh[:20]}')
missdef=[x['term'] for x in lex if x.get('type')=='word' and not x.get('definition_en')]
if missdef: errors.append(f'missing English definitions: {missdef[:20]}')
ctxless=[x['term'] for x in lex if x.get('type')=='word' and not x.get('contexts')]
if ctxless: errors.append(f'word without context: {ctxless[:20]}')
broken=[]
for x in lex:
    for c in x.get('contexts',[]):
        if 'text' in c: broken.append(f'{x["term"]}: duplicated text'); break
        if c.get('sentence_id') not in corpus: broken.append(f'{x["term"]}: {c.get("sentence_id")}'); break
if broken: errors.append(f'broken context refs: {broken[:20]}')
if len(sent)!=600: errors.append(f'sentences != 600: {len(sent)}')
expected=Counter({'en_to_zh':200,'zh_to_en':200,'free_translation':100,'analysis':100}); pools=Counter(x['pool'] for x in sent.values())
if pools!=expected: errors.append(f'bad pools {dict(pools)}')
if len(smeta)!=600: errors.append(f'sentence_meta != 600: {len(smeta)}')
bads=[k for k,v in sent.items() if not v.get('zh') or not v.get('en_chunks') or not v.get('zh_chunks')]
if bads: errors.append(f'missing sentence bilingual/chunks: {bads[:20]}')
if len(corpus)<700: errors.append(f'clean corpus too small: {len(corpus)}')
if not set(corpus).issubset(set(ctx)): errors.append(f'context translations missing ids: {list(set(corpus)-set(ctx))[:20]}')
if len(ana)!=100: errors.append(f'analysis != 100: {len(ana)}')
stages=Counter(x['stage'] for x in ana.values())
if stages!=Counter({'precise':30,'coarse':30,'main_stem':40}): errors.append(f'bad analysis stages {dict(stages)}')
if len(sch.get('words',[]))!=100: errors.append(f'word schedule days={len(sch.get("words",[]))}')
for d in sch.get('words',[]):
    if len(d.get('items',[]))!=30: errors.append(f'day {d.get("day")} has {len(d.get("items",[]))} words'); break
word_terms=[t for d in sch.get('words',[]) for t in d.get('items',[])]
if Counter(word_terms)!=Counter(terms):
    missing=list((Counter(terms)-Counter(word_terms)).elements())[:20]; extra=list((Counter(word_terms)-Counter(terms)).elements())[:20]
    errors.append(f'word schedule mismatch missing={missing} extra_or_duplicates={extra}')
if len(sch.get('sentences',[]))!=100: errors.append('sentence 100-day schedule broken')
for d in sch.get('sentences',[]):
    if len(d.get('en_to_zh',[]))!=2 or len(d.get('zh_to_en',[]))!=2 or len(d.get('focus_ids',[]))!=2: errors.append(f'daily sentence quota broken day={d.get("day")}'); break
if errors:
    print('RELEASE VALIDATION: FAIL'); print('\n'.join('- '+e for e in errors)); sys.exit(1)
print('RELEASE VALIDATION: PASS')
print('3000 unique vocab; local dictionary covers every scheduled item; all contexts resolve; 600 mutually exclusive sentences; 100 analyses; 100-day schedules exact.')
