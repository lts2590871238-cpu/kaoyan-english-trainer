#!/usr/bin/env python3
# Structural CI only: creates deterministic fake bilingual fields so pipeline invariants can be tested without API calls.
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; SRC=ROOT/'data/source'; WORK=ROOT/'data/work'; WORK.mkdir(parents=True,exist_ok=True)
def load(p): return json.loads(p.read_text(encoding='utf8'))
lex=load(WORK/'lexicon.base.json'); pools=load(SRC/'sentence_pools.json'); corpus=load(SRC/'corpus_sentences.json'); byid={x['id']:x for x in corpus}
senses={}
for x in lex:
    senses[x['term']]={'sense_zh':'测试义','dict_zh':x.get('dict_zh') or '测试义','definition_en':x.get('definition_en') or 'A deterministic test definition.','pos':x.get('pos') or ('phrase' if x['type']=='phrase' else 'word'),'example_en':('Learners can study '+x['term']+' in context.') if x.get('needs_context_fill') else '', 'example_zh':'学习者可以在语境中学习这个词。' if x.get('needs_context_fill') else ''}
sent={}
for pool,items in pools.items():
    for item in items:
        sid=item['id']; s=byid[sid]; words=s['text'].split(); mid=max(1,len(words)//2)
        sent[sid]={'id':sid,'pool':pool,'year':s['year'],'page':s['page'],'source':s['source'],'word_count':s['word_count'],'en':s['text'],'zh':'结构测试译文','en_chunks':[' '.join(words[:mid]),' '.join(words[mid:]) or '.'],'zh_chunks':['结构','测试']}
ctx={x['id']:'结构测试译文' for x in corpus if x.get('source')!='写作'}
ana={}
for item in pools['analysis']:
    sid=item['id']; ana[sid]={'id':sid,'stage':item['stage'],'main_stem':'test','zh':'结构测试译文'}
for n,obj in [('lexicon.senses.json',senses),('sentences.enriched.json',sent),('corpus.translations.json',ctx),('analysis.enriched.json',ana)]: (WORK/n).write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf8')
print('MOCK AI STRUCTURE DATA: COMPLETE')
