#!/usr/bin/env python3
import json
from pathlib import Path
from collections import Counter
ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'data/source'; OUT=ROOT/'data/generated'
lex=json.loads((OUT/'lexicon.base.json').read_text(encoding='utf8'))
senses=json.loads((OUT/'lexicon.senses.json').read_text(encoding='utf8'))
sent=json.loads((OUT/'sentences.enriched.json').read_text(encoding='utf8'))
analysis=json.loads((OUT/'analysis.enriched.json').read_text(encoding='utf8'))
ctxzh=json.loads((OUT/'corpus.translations.json').read_text(encoding='utf8'))
daysw=json.loads((OUT/'days_words.json').read_text(encoding='utf8'))
dict_lookup=json.loads((OUT/'dictionary.lookup.base.json').read_text(encoding='utf8'))
dayss=json.loads((SRC/'days_sentences.json').read_text(encoding='utf8'))
corpus_src=json.loads((SRC/'corpus_sentences.json').read_text(encoding='utf8'))

# Keep the large true-paper sentence text once in corpus.json. Lexicon contexts only keep references.
corpus_good=[x for x in corpus_src if x.get('source') not in ('完形','写作')]
corpus={x['id']:{'en':x['text'],'year':x['year'],'page':x['page'],'source':x['source'],'word_count':x['word_count']} for x in corpus_good}

scheduled=[]
for x in lex:
    if not x.get('scheduled'):continue
    y=dict(x); y['sense_zh']=senses.get(x['term'],{}).get('sense_zh') or x.get('dict_zh','')
    # Avoid repeating the full English sentence inside every word record.
    y['contexts']=[{k:c.get(k) for k in ('sentence_id','year','page') if c.get(k) is not None} for c in (x.get('contexts') or []) if c.get('sentence_id') in corpus][:8]
    scheduled.append(y)

lex_index=[{'term':x['term'],'count':x['count'],'freq_band':x['freq_band'],'type':x['type']} for x in scheduled]
sentence_meta={k:{'id':k,'pool':v['pool'],'year':v['year'],'page':v['page'],'source':v['source'],'word_count':v['word_count']} for k,v in sent.items()}

# Full user-facing static files.
(OUT/'lexicon.json').write_text(json.dumps(scheduled,ensure_ascii=False,separators=(',',':')),encoding='utf8')
(OUT/'dictionary_lookup.json').write_text(json.dumps(dict_lookup,ensure_ascii=False,separators=(',',':')),encoding='utf8')
(OUT/'lexicon_index.json').write_text(json.dumps(lex_index,ensure_ascii=False,separators=(',',':')),encoding='utf8')
(OUT/'sentences.json').write_text(json.dumps(sent,ensure_ascii=False,separators=(',',':')),encoding='utf8')
(OUT/'sentence_meta.json').write_text(json.dumps(sentence_meta,ensure_ascii=False,separators=(',',':')),encoding='utf8')
(OUT/'corpus.json').write_text(json.dumps(corpus,ensure_ascii=False,separators=(',',':')),encoding='utf8')
(OUT/'context_translations.json').write_text(json.dumps(ctxzh,ensure_ascii=False,separators=(',',':')),encoding='utf8')
(OUT/'analysis.json').write_text(json.dumps(analysis,ensure_ascii=False,separators=(',',':')),encoding='utf8')
(OUT/'schedule.json').write_text(json.dumps({'words':daysw,'sentences':dayss},ensure_ascii=False,separators=(',',':')),encoding='utf8')

meta={
 'version':'6.0',
 'ready':True,
 'title':'轩轩冲刺50分大作战！',
 'days':100,
 'daily':{'words':30,'en_to_zh':2,'zh_to_en':2,'focus':2,'focus_rotation':'odd=translation, even=analysis'},
 'counts':{'vocab':len(scheduled),'sentences':len(sent),'analysis':len(analysis),'corpus_contexts':len(corpus)},
 'bands':dict(Counter(x['freq_band'] for x in scheduled)),
 'sentence_pools':dict(Counter(x['pool'] for x in sent.values())),
 'analysis_stages':dict(Counter(x['stage'] for x in analysis.values())),
 'requirements':{'missing_word_sense':sum(not x.get('sense_zh') for x in scheduled),'missing_sentence_zh':sum(not x.get('zh') for x in sent.values())}
}
(OUT/'meta.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(meta,ensure_ascii=False,indent=2))
