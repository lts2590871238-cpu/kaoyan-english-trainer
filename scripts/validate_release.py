#!/usr/bin/env python3
import json,sys
from pathlib import Path
from collections import Counter
from release_contract import validate_manifest
ROOT=Path(__file__).resolve().parents[1]
TARGET=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'data/candidate'
def load(p): return json.loads(p.read_text(encoding='utf8'))
errors=[]
manifest,merr=validate_manifest(TARGET)
errors.extend(merr)
if errors:
    print('RELEASE VALIDATION: FAIL'); print('\n'.join('- '+e for e in errors)); sys.exit(1)
lex=load(TARGET/'lexicon.json'); dlookup=load(TARGET/'dictionary_lookup.json'); lexi=load(TARGET/'lexicon_index.json'); sent=load(TARGET/'sentences.json'); smeta=load(TARGET/'sentence_meta.json'); corpus=load(TARGET/'corpus.json'); ana=load(TARGET/'analysis.json'); ctx=load(TARGET/'context_translations.json'); sch=load(TARGET/'schedule.json'); meta=load(TARGET/'meta.json')
N=len(lex); terms=[x.get('term') for x in lex]; ids=[x.get('item_id') for x in lex]
def dups(xs): return [k for k,v in Counter(xs).items() if v>1][:20]
if N!=3000: errors.append(f'unique lexicon must be exactly 3000: {N}')
if dups(terms): errors.append(f'duplicate lexicon terms: {dups(terms)}')
if dups(ids): errors.append(f'duplicate lexicon ids: {dups(ids)}')
if len(dlookup)<N: errors.append(f'local dictionary too small: {len(dlookup)} < {N}')
dmap={x.get('term'):x for x in dlookup if x.get('term')}
missdict=[t for t in terms if t not in dmap]
if missdict: errors.append(f'scheduled terms absent from local dictionary: {missdict[:20]}')
baddict=[t for t in terms if not dmap.get(t,{}).get('dict_zh')]
if baddict: errors.append(f'scheduled dictionary terms without Chinese meaning: {baddict[:20]}')
if len(lexi)!=N: errors.append(f'lexicon_index != unique lexicon: {len(lexi)} vs {N}')
misszh=[x['term'] for x in lex if not x.get('sense_zh') or not x.get('dict_zh')]
if misszh: errors.append(f'missing Chinese meanings: {misszh[:20]}')
missdef=[x['term'] for x in lex if x.get('type')=='word' and not x.get('definition_en')]
if missdef: errors.append(f'missing English definitions: {missdef[:20]}')
misstts=[x['term'] for x in lex if not str(x.get('tts_text') or '').strip()]
if misstts: errors.append(f'missing pronunciation/TTS targets: {misstts[:20]}')
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
word_days=sch.get('words',[])
if len(word_days)!=100: errors.append(f'word schedule days={len(word_days)}')
term_band={x['term']:x.get('freq_band') for x in lex}; word_terms=[]
for d in word_days:
    items=d.get('items',[])
    if len(items)!=30: errors.append(f'day {d.get("day")} has {len(items)} words'); break
    if Counter(term_band.get(t) for t in items)!=Counter({'high':15,'mid':9,'low':6}): errors.append(f'daily 5:3:2 broken day={d.get("day")}'); break
    word_terms+=items
if len(word_terms)!=3000: errors.append(f'word new-item slots !=3000: {len(word_terms)}')
if len(set(word_terms))!=3000: errors.append(f'word schedule contains repeated new items: unique={len(set(word_terms))}')
if set(word_terms)!=set(terms): errors.append(f'word schedule unique coverage mismatch missing={list(set(terms)-set(word_terms))[:20]} unknown={list(set(word_terms)-set(terms))[:20]}')
if Counter(term_band[t] for t in word_terms if t in term_band)!=Counter({'high':1500,'mid':900,'low':600}): errors.append('100-day exposure band totals broken')
if len(sch.get('sentences',[]))!=100: errors.append('sentence 100-day schedule broken')
for d in sch.get('sentences',[]):
    if len(d.get('en_to_zh',[]))!=2 or len(d.get('zh_to_en',[]))!=2 or len(d.get('focus_ids',[]))!=2: errors.append(f'daily sentence quota broken day={d.get("day")}'); break
if meta.get('counts',{}).get('vocab')!=3000: errors.append('meta vocab count != 3000')
if manifest and manifest.get('counts')!=meta.get('counts'): errors.append('manifest counts differ from meta counts')
if errors:
    print('RELEASE VALIDATION: FAIL'); print('\n'.join('- '+e for e in errors)); sys.exit(1)
print('RELEASE VALIDATION: PASS')
print('ATOMIC RELEASE CONTRACT: PASS release_id='+manifest['release_id'])
print('3000 unique vocab items; TTS target 3000/3000; 600 mutually exclusive sentences; 100 analyses; 100-day schedules exact; all release files hash-verified.')
