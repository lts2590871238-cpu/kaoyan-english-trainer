#!/usr/bin/env python3
import json,shutil
from pathlib import Path
from collections import Counter
ROOT=Path(__file__).resolve().parents[1]; SRC=ROOT/'data/source'; WORK=ROOT/'data/work'; CAND=ROOT/'data/candidate'
if CAND.exists(): shutil.rmtree(CAND)
CAND.mkdir(parents=True)
def load(p): return json.loads(p.read_text(encoding='utf8'))
lex=load(WORK/'lexicon.base.json'); senses=load(WORK/'lexicon.senses.json'); sent=load(WORK/'sentences.enriched.json'); analysis=load(WORK/'analysis.enriched.json'); ctxzh=load(WORK/'corpus.translations.json'); daysw=load(WORK/'days_words.json'); dict_base=load(WORK/'dictionary.lookup.base.json'); dayss=load(SRC/'days_sentences.json'); corpus_src=load(SRC/'corpus_sentences.json'); wordctx=load(WORK/'word_contexts.json') if (WORK/'word_contexts.json').exists() else {}
# EXACT same corpus policy as build_lexicon.py and validators.
corpus_good=[x for x in corpus_src if x.get('source')!='写作']
corpus={x['id']:{'en':x['text'],'year':x['year'],'page':x['page'],'source':x['source'],'word_count':x['word_count'],'true_paper':True} for x in corpus_good}
final=[]
for x in lex:
    s=senses[x['term']]; y=dict(x)
    # AI enrichment is merged completely, not only sense_zh.
    y['sense_zh']=(s.get('sense_zh') or x.get('dict_zh') or '').strip()
    y['dict_zh']=(s.get('dict_zh') or x.get('dict_zh') or y['sense_zh']).strip()
    y['definition_en']=(s.get('definition_en') or x.get('definition_en') or '').strip()
    y['pos']=(s.get('pos') or x.get('pos') or ('phrase' if x.get('type')=='phrase' else '')).strip()
    refs=[]; seen=set()
    for c in x.get('contexts',[]):
        sid=c.get('sentence_id')
        if sid in corpus and sid not in seen:
            refs.append({k:c.get(k) for k in ('sentence_id','year','page') if c.get(k) is not None}); seen.add(sid)
        if len(refs)>=8: break
    if not refs and x.get('needs_context_fill'):
        pid='practice_'+x['item_id']
        w=wordctx.get(x['term'],{})
        ex_en=(w.get('example_en') or '').strip(); ex_zh=(w.get('example_zh') or '').strip()
        if not ex_en or not ex_zh: raise SystemExit('missing batched practice context for '+x['term'])
        corpus[pid]={'en':ex_en,'year':None,'page':None,'source':'AI练习例句','word_count':len(ex_en.split()),'true_paper':False}
        ctxzh[pid]=ex_zh
        refs=[{'sentence_id':pid}]
    y['contexts']=refs
    final.append(y)
# Build one canonical lookup map. Scheduled final items override base entries, guaranteeing >=3000 reliable entries.
dmap={x['term']:dict(x) for x in dict_base if x.get('term')}
for x in final:
    dmap[x['term']]={'term':x['term'],'forms':x.get('forms',[]),'phonetic':x.get('phonetic',''),'dict_zh':x.get('dict_zh',''),'definition_en':x.get('definition_en',''),'pos':x.get('pos','')}
dlookup=sorted(dmap.values(),key=lambda x:x['term'])
lex_index=[{'item_id':x['item_id'],'term':x['term'],'count':x['count'],'freq_band':x['freq_band'],'type':x['type']} for x in final]
sentence_meta={k:{'id':k,'pool':v['pool'],'year':v['year'],'page':v['page'],'source':v['source'],'word_count':v['word_count']} for k,v in sent.items()}
files={
'lexicon.json':final,'dictionary_lookup.json':dlookup,'lexicon_index.json':lex_index,'sentences.json':sent,'sentence_meta.json':sentence_meta,
'corpus.json':corpus,'context_translations.json':ctxzh,'analysis.json':analysis,'schedule.json':{'words':daysw,'sentences':dayss}}
for name,obj in files.items(): (CAND/name).write_text(json.dumps(obj,ensure_ascii=False,separators=(',',':')),encoding='utf8')
meta={'version':'11.0','ready':True,'title':'轩轩冲刺50分大作战！','days':100,
'daily':{'words':30,'en_to_zh':2,'zh_to_en':2,'focus':2,'focus_rotation':'odd=translation, even=analysis'},
'counts':{'vocab':len(final),'dictionary':len(dlookup),'sentences':len(sent),'analysis':len(analysis),'corpus_contexts':len(corpus)},
'bands':dict(Counter(x['freq_band'] for x in final)),'sentence_pools':dict(Counter(x['pool'] for x in sent.values())),
'analysis_stages':dict(Counter(x['stage'] for x in analysis.values())),
'requirements':{'missing_word_sense':sum(not x.get('sense_zh') for x in final),'missing_sentence_zh':sum(not x.get('zh') for x in sent.values()),'contextless_words':sum(not x.get('contexts') for x in final)},'practice_contexts':sum(1 for v in corpus.values() if not v.get('true_paper',True))}
(CAND/'meta.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(meta,ensure_ascii=False,indent=2)); print('CANDIDATE COMPILE: COMPLETE')
