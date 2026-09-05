#!/usr/bin/env python3
import json,re,sys
from pathlib import Path
from collections import Counter
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'data/generated'
errors=[]
def load(p):return json.loads(p.read_text(encoding='utf8'))
required=['lexicon.json','lexicon_index.json','dictionary_lookup.json','sentences.json','sentence_meta.json','corpus.json','analysis.json','context_translations.json','schedule.json','meta.json']
for f in required:
    if not (OUT/f).exists():errors.append('missing '+f)
if errors:
    print('\n'.join(errors));sys.exit(1)
lex=load(OUT/'lexicon.json'); dlookup=load(OUT/'dictionary_lookup.json'); lexi=load(OUT/'lexicon_index.json'); sent=load(OUT/'sentences.json'); smeta=load(OUT/'sentence_meta.json'); corpus=load(OUT/'corpus.json'); ana=load(OUT/'analysis.json'); ctx=load(OUT/'context_translations.json'); sch=load(OUT/'schedule.json')
if len(lex)!=3000:errors.append(f'lexicon != 3000: {len(lex)}')
if len(dlookup)<3000:errors.append(f'local dictionary too small: {len(dlookup)}')
if any(not x.get('dict_zh') for x in dlookup):errors.append('local dictionary missing Chinese meaning')
if len(lexi)!=3000:errors.append(f'lexicon_index != 3000: {len(lexi)}')
if any(not x.get('sense_zh') or not x.get('dict_zh') for x in lex):errors.append('missing word Chinese meanings')
if any(x['type']=='word' and not x.get('definition_en') for x in lex):errors.append('missing English definitions')
if any(x['type']=='word' and not x.get('contexts') for x in lex):errors.append('word without context')
# Context refs must resolve to a clean true-paper sentence, without sentence text duplication in lexicon.
for x in lex:
    for c in x.get('contexts',[]):
        if 'text' in c: errors.append(f'duplicated context text in lexicon: {x["term"]}'); break
        if c.get('sentence_id') not in corpus: errors.append(f'broken context ref: {x["term"]}'); break
if len(sent)!=600:errors.append(f'sentences != 600: {len(sent)}')
expected={'en_to_zh':200,'zh_to_en':200,'free_translation':100,'analysis':100}
c=Counter(x['pool'] for x in sent.values())
if dict(c)!=expected:errors.append(f'bad pools {dict(c)}')
if len(smeta)!=600: errors.append(f'sentence_meta != 600: {len(smeta)}')
if any(not x.get('zh') or not x.get('en_chunks') or not x.get('zh_chunks') for x in sent.values()):errors.append('missing sentence bilingual/chunks')
if len(corpus)<700:errors.append(f'clean corpus too small: {len(corpus)}')
if len(ctx)<700:errors.append(f'context translations too few: {len(ctx)}')
if not set(corpus).issubset(set(ctx)): errors.append('not every clean corpus sentence has a Chinese translation')
if len(ana)!=100:errors.append(f'analysis != 100: {len(ana)}')
if Counter(x['stage'] for x in ana.values())!=Counter({'precise':30,'coarse':30,'main_stem':40}):errors.append('bad analysis stages')
if len(sch['words'])!=100 or any(len(x['items'])!=30 for x in sch['words']):errors.append('word 100-day schedule broken')
# Every word appears exactly once in the 100-day new-word schedule.
word_ids=[t for d in sch['words'] for t in d['items']]
if len(word_ids)!=3000 or len(set(word_ids))!=3000: errors.append('word schedule has duplicates/missing words')
if len(sch['sentences'])!=100:errors.append('sentence 100-day schedule broken')
for d in sch['sentences']:
    if len(d['en_to_zh'])!=2 or len(d['zh_to_en'])!=2 or len(d['focus_ids'])!=2:errors.append('daily sentence quota broken');break
ids=list(sent.keys())
if len(ids)!=len(set(ids)):errors.append('duplicate sentence ids')
if errors:
    print('RELEASE VALIDATION: FAIL')
    print('\n'.join('- '+e for e in errors));sys.exit(1)
print('RELEASE VALIDATION: PASS')
print('3000 vocab; 600 mutually exclusive sentence items; 100 analysis; 100-day schedule; clean corpus references all valid.')
