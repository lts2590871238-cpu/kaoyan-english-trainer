#!/usr/bin/env python3
import json,sys,re
from pathlib import Path
from collections import Counter
ROOT=Path(__file__).resolve().parents[1]; SRC=ROOT/'data/source'
errors=[]
corpus=json.loads((SRC/'corpus_sentences.json').read_text(encoding='utf8'))
pools=json.loads((SRC/'sentence_pools.json').read_text(encoding='utf8'))
days=json.loads((SRC/'days_sentences.json').read_text(encoding='utf8'))
words=json.loads((SRC/'words_surface.json').read_text(encoding='utf8'))
if len(corpus)<700:errors.append('corpus too small')
expected={'en_to_zh':200,'zh_to_en':200,'free_translation':100,'analysis':100}
ids=[]
for k,n in expected.items():
    if len(pools.get(k,[]))!=n:errors.append(f'{k} count {len(pools.get(k,[]))}')
    ids += [x['id'] for x in pools.get(k,[])]
if len(ids)!=600 or len(set(ids))!=600:errors.append('sentence pools overlap or wrong total')
if Counter(x.get('stage') for x in pools['analysis'])!=Counter({'precise':30,'coarse':30,'main_stem':40}):errors.append('analysis stage counts wrong')
if len(days)!=100:errors.append('days != 100')
for d in days:
    if len(d['en_to_zh'])!=2 or len(d['zh_to_en'])!=2 or len(d['focus_ids'])!=2:errors.append(f'day quota broken {d["day"]}')
if len(words)<4000:errors.append('word surface pool too small')
# reject obvious exam boilerplate / extraction artifacts in the 600 selected pool
bad=['ANSWER SHEET','Directions:','Write your answer','Choose the best','年考研','44.43.42.']
qstarts=('what can be learned','what did the study','what should an author','which of the following',
         'according to paragraph','in paragraph ','why did ','how does ','what does ','what is the text',
         'what can be inferred','the function of the ','could you please','can you give me','and are they currently')
for k,arr in pools.items():
    for item in arr:
        t=item['text']; low=t.lower()
        if item.get('word_count',0)<8: errors.append(f'too short in {item["id"]}')
        if any(b.lower() in low for b in bad):errors.append(f'boilerplate in {item["id"]}')
        if low.startswith(qstarts): errors.append(f'question/prompt fragment in {item["id"]}')
        if len(re.findall(r'\.\s+[a-z]{2,}',t))>=2: errors.append(f'option-list contamination in {item["id"]}')
if errors:
    print('SOURCE PREFLIGHT: FAIL');print('\n'.join('- '+x for x in errors));sys.exit(1)
print('SOURCE PREFLIGHT: PASS')
print(f'corpus={len(corpus)}, selected=600 unique, analysis=30/30/40, surface_word_candidates={len(words)}, days=100')
