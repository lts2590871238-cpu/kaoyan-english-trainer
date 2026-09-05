#!/usr/bin/env python3
import json, re, sys, os
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'data/source'
LEMMA=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'cache/lemma.en.txt'
NLTK_DIR=Path(sys.argv[2]) if len(sys.argv)>2 else ROOT/'cache/nltk_data'
OUT=Path(sys.argv[3]) if len(sys.argv)>3 else ROOT/'cache/wordnet_defs.json'

surface=json.loads((SRC/'words_surface.json').read_text(encoding='utf8'))
phrases=json.loads((SRC/'phrases_curated.json').read_text(encoding='utf8'))

def norm(w): return (w or '').strip().lower()
def lexical(w): return bool(re.fullmatch(r"[a-z]+(?:-[a-z]+)*",w or ''))
needed={norm(x.get('surface')) for x in surface if lexical(norm(x.get('surface')))}

# ECDICT lemma map: surface -> canonical lemma.
fmap={}
with LEMMA.open(encoding='utf8',errors='ignore') as f:
    for line in f:
        line=line.strip()
        if not line or line.startswith(';') or '->' not in line: continue
        left,right=line.split('->',1)
        lemma=norm(left.split('/',1)[0])
        if not lemma: continue
        if lemma in needed: fmap.setdefault(lemma,lemma)
        for raw in right.split(','):
            form=norm(raw)
            if form in needed and form not in fmap:
                fmap[form]=lemma
terms={fmap.get(w,w) for w in needed}
terms.update(norm(p) for p in phrases if norm(p))

os.environ['NLTK_DATA']=str(NLTK_DIR)
try:
    import nltk
    nltk.data.path.insert(0,str(NLTK_DIR))
    from nltk.corpus import wordnet as wn
    # Force resource check before the loop.
    _=wn.synsets('study')
except Exception as e:
    raise SystemExit(f'WORDNET CACHE FAIL: local WordNet unavailable: {e}')

POS={'n':'noun','v':'verb','a':'adjective','s':'adjective','r':'adverb'}
out={}
for i,term in enumerate(sorted(terms),1):
    keys=[term.replace(' ','_').replace('-','_')]
    # A hyphenated word can sometimes be stored without punctuation.
    if '-' in term: keys.append(term.replace('-',''))
    syns=[]
    for k in keys:
        syns=wn.synsets(k)
        if syns: break
    if syns:
        s=syns[0]
        out[term]={'definition_en':s.definition().strip(),'pos':POS.get(s.pos(),s.pos()),'source':'wordnet'}
    if i%1000==0: print(f'wordnet cache {i}/{len(terms)}',flush=True)
OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'candidate_terms':len(terms),'wordnet_definitions':len(out),'output':str(OUT)},ensure_ascii=False,indent=2))
print('WORDNET CACHE: PASS')
