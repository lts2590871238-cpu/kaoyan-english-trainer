#!/usr/bin/env python3
import csv, json, re, sys
from pathlib import Path
from collections import defaultdict

ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'data/source'; OUT=ROOT/'data/generated'; OUT.mkdir(parents=True,exist_ok=True)
ECDICT=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'cache/ecdict.csv'

surface=json.loads((SRC/'words_surface.json').read_text(encoding='utf8'))
phrases=json.loads((SRC/'phrases_curated.json').read_text(encoding='utf8'))

# Only remove true function/exam boilerplate here.  Earlier versions were too aggressive
# and mistakenly removed useful exam vocabulary such as important/current/result/increase.
TRIVIAL=set('''the a an this that these those i you he she it we they me him her us them my your his its our their mine yours ours theirs am is are was were be been being do does did have has had can could may might must shall should will would and or but nor if as than then there here very too so not no yes one two three first second last new old good big small day days year years people thing things something get got make made go went come came say said says see seen know think want use used using way time now today'''.split())
BOILER=set('''answer answers direction directions section part text question questions sheet mark numbered paragraph paragraphs write writing read reading choose choosing option options points page pages exam examination candidate candidates'''.split())
SKIP=TRIVIAL|BOILER

def norm_word(w): return w.strip().lower()
def parse_lemma(exchange,word):
    if not exchange:return word
    for item in exchange.split('/'):
        if item.startswith('0:'):
            x=item[2:].strip().lower()
            if x:return x
    return word

def split_lines(s): return [x.strip() for x in (s or '').replace('\\n','\n').split('\n') if x.strip()]
def zh_short(s):
    lines=split_lines(s)
    return re.sub(r'\s+',' ','；'.join(lines[:2]))[:180] if lines else ''
def en_short(s):
    lines=split_lines(s)
    return ' '.join(lines[:2])[:360] if lines else ''
def lexical(w): return bool(len(w)>=3 and re.fullmatch(r"[a-z]+(?:[-'][a-z]+)*",w))

def looks_like_proper_noun(term,contexts):
    # Conservative heuristic for ECDICT-unresolved fallback terms. Ignore sentence-initial caps.
    if not contexts:return False
    hits=cap=0
    pat=re.compile(r'(?<![A-Za-z])'+re.escape(term)+r'(?![A-Za-z])',re.I)
    for c in contexts[:10]:
        text=c.get('text','')
        for m in pat.finditer(text):
            hits+=1
            token=text[m.start():m.end()]
            prefix=text[:m.start()].rstrip()
            sent_initial=(not prefix) or prefix.endswith(('.', '!', '?', ':', ';'))
            if token[:1].isupper() and not sent_initial: cap+=1
    return hits>=2 and cap/hits>=0.75

needed={norm_word(x['surface']) for x in surface}
rows={}
with ECDICT.open(encoding='utf8',errors='ignore',newline='') as f:
    for row in csv.DictReader(f):
        w=norm_word(row.get('word',''))
        if w in needed: rows[w]=row
lemma_needed={parse_lemma(row.get('exchange',''),w) for w,row in rows.items()}
missing_lemma=lemma_needed-set(rows)
if missing_lemma:
    with ECDICT.open(encoding='utf8',errors='ignore',newline='') as f:
        for row in csv.DictReader(f):
            w=norm_word(row.get('word',''))
            if w in missing_lemma: rows[w]=row

# Tier A/B: source terms resolved by ECDICT. Chinese OR English dictionary evidence is enough;
# any missing side is filled by DeepSeek in the next build stage and validated before publishing.
agg={}
for item in surface:
    w=norm_word(item['surface']); row=rows.get(w)
    if not row: continue
    lemma=parse_lemma(row.get('exchange',''),w); lrow=rows.get(lemma,row)
    if lemma in SKIP or not lexical(lemma): continue
    trans=zh_short(lrow.get('translation') or row.get('translation'))
    definition=en_short(lrow.get('definition') or row.get('definition'))
    if not trans and not definition: continue
    rec=agg.setdefault(lemma,{
      'term':lemma,'type':'word','count':0,'year_counts':defaultdict(int),'contexts':[],
      'phonetic':(lrow.get('phonetic') or row.get('phonetic') or '').strip(),
      'dict_zh':trans,'definition_en':definition,'pos':(lrow.get('pos') or row.get('pos') or '').strip(),
      'collins':int(lrow.get('collins') or 0) if str(lrow.get('collins') or '').isdigit() else 0,
      'oxford':int(lrow.get('oxford') or 0) if str(lrow.get('oxford') or '').isdigit() else 0,
      'bnc':int(lrow.get('bnc') or 0) if str(lrow.get('bnc') or '').isdigit() else 0,
      'frq':int(lrow.get('frq') or 0) if str(lrow.get('frq') or '').isdigit() else 0,
      'forms':set(),'ai_dictionary_fill':bool(not trans or not definition),'dictionary_source':'ecdict'
    })
    rec['count']+=int(item.get('count',0)); rec['forms'].add(w)
    for y,c in item.get('year_counts',{}).items(): rec['year_counts'][int(y)]+=int(c)
    seen={x['sentence_id'] for x in rec['contexts']}
    for ctx in item.get('contexts',[]):
        if ctx['sentence_id'] not in seen and len(rec['contexts'])<10:
            rec['contexts'].append(ctx);seen.add(ctx['sentence_id'])

# Convert to eligible entries first.
entries=[]
for lemma,r in agg.items():
    yc=dict(sorted(r['year_counts'].items())); core=sum(c for y,c in yc.items() if y>=2023)>0
    pre=sum(c for y,c in yc.items() if y<=2022)
    # Project rule: 2023-2026 is core; 2020-2022-only additions require >=5 total occurrences.
    if not (core or ((not core) and r['count']>=5 and pre>0)): continue
    r['year_counts']=yc;r['forms']=sorted(r['forms']);r['core_2023_2026']=core
    r['supplement_2020_2022']=not core;entries.append(r)

# Curated phrases from the core years.
corpus=json.loads((SRC/'corpus_sentences.json').read_text(encoding='utf8'))
recent_text='\n'.join(s['text'].lower() for s in corpus if s['year']>=2023)
for phrase,zh in phrases.items():
    p=phrase.lower().strip(); count=recent_text.count(p)
    if count<=0:continue
    ctx=[];yc=defaultdict(int)
    for s in corpus:
        n=s['text'].lower().count(p)
        if n:
            yc[s['year']]+=n
            if len(ctx)<8:ctx.append({'sentence_id':s['id'],'year':s['year'],'page':s['page'],'text':s['text']})
    entries.append({'term':p,'type':'phrase','count':sum(yc.values()),'year_counts':dict(sorted(yc.items())),
      'contexts':ctx,'phonetic':'','dict_zh':zh,'definition_en':'','pos':'phrase','collins':0,'oxford':0,'bnc':0,'frq':0,
      'forms':[p],'core_2023_2026':True,'supplement_2020_2022':False,'ai_dictionary_fill':True,'dictionary_source':'curated'})

# Tier C safety net: if dictionary coverage still leaves us short, take only genuine core-year
# lexical items with real-paper contexts and let DeepSeek create the missing dictionary fields.
# This is deliberately capped to exactly what is needed, and obvious proper nouns are rejected.
existing={x['term'] for x in entries}
if len(entries)<3000:
    fallback=[]
    for item in surface:
        w=norm_word(item['surface'])
        if w in existing or w in SKIP or not lexical(w):continue
        yc={int(y):int(c) for y,c in item.get('year_counts',{}).items()}
        core_count=sum(c for y,c in yc.items() if y>=2023)
        if core_count<=0:continue
        ctx=item.get('contexts',[])
        if not ctx or looks_like_proper_noun(w,ctx):continue
        fallback.append({'term':w,'type':'word','count':int(item.get('count',0)),'year_counts':dict(sorted(yc.items())),
          'contexts':ctx[:10],'phonetic':'','dict_zh':'','definition_en':'','pos':'','collins':0,'oxford':0,'bnc':0,'frq':0,
          'forms':[w],'core_2023_2026':True,'supplement_2020_2022':False,'ai_dictionary_fill':True,'dictionary_source':'ai_fallback'})
    fallback.sort(key=lambda r:(-r['count'],r['term']))
    need=3000-len(entries); entries.extend(fallback[:need])

# Priority: core, true-paper frequency, mainstream dictionary evidence. AI fallback stays behind ECDICT.
def priority(r):
    core=1 if r['core_2023_2026'] else 0; freq=r['count']
    dict_weight=(r.get('collins',0)*3)+(10 if r.get('oxford',0) else 0)
    corpus_weight=(10000/(r['bnc']+1000) if r.get('bnc',0)>0 else 0)+(10000/(r['frq']+1000) if r.get('frq',0)>0 else 0)
    phrase_bonus=2 if r['type']=='phrase' else 0
    source_bonus=3 if r.get('dictionary_source')=='ecdict' else (1 if r.get('dictionary_source')=='curated' else 0)
    return core*10000+freq*25+dict_weight+corpus_weight+phrase_bonus+source_bonus
entries.sort(key=lambda r:(-priority(r),-r['count'],r['term']))

scheduled=entries[:3000]
for i,r in enumerate(scheduled):
    r['freq_band']='high' if i<1500 else ('mid' if i<2400 else 'low');r['scheduled']=True
for r in entries[3000:]:r['freq_band']='extra';r['scheduled']=False

high=[r for r in scheduled if r['freq_band']=='high'];mid=[r for r in scheduled if r['freq_band']=='mid'];low=[r for r in scheduled if r['freq_band']=='low']
days=[]
for d in range(100):
    hs=high[d*15:(d+1)*15];ms=mid[d*9:(d+1)*9];ls=low[d*6:(d+1)*6];items=[]
    for b in range(3):
        items += [x['term'] for x in hs[b*5:(b+1)*5]]+[x['term'] for x in ms[b*3:(b+1)*3]]+[x['term'] for x in ls[b*2:(b+1)*2]]
    days.append({'day':d+1,'items':items})

# Base click dictionary. Missing fields for scheduled fallback items are completed at AI stage/compile stage.
lookup=[]
for r in entries:
    if r.get('dict_zh'):
        lookup.append({'term':r['term'],'forms':r['forms'],'phonetic':r.get('phonetic',''),'dict_zh':r.get('dict_zh',''),
          'definition_en':r.get('definition_en',''),'pos':r.get('pos','')})
lookup.sort(key=lambda x:x['term'])

(OUT/'dictionary.lookup.base.json').write_text(json.dumps(lookup,ensure_ascii=False,indent=2),encoding='utf8')
(OUT/'lexicon.base.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2),encoding='utf8')
(OUT/'days_words.json').write_text(json.dumps(days,ensure_ascii=False,indent=2),encoding='utf8')
report={
 'ecdict_rows_loaded':len(rows),'eligible_entries':len(entries),'scheduled_entries':len(scheduled),
 'scheduled_words':sum(r['type']=='word' for r in scheduled),'scheduled_phrases':sum(r['type']=='phrase' for r in scheduled),
 'core_entries':sum(r['core_2023_2026'] for r in entries),'supplement_entries':sum(r['supplement_2020_2022'] for r in entries),
 'needs_ai_dictionary_fill':sum(bool(r.get('ai_dictionary_fill')) for r in scheduled),
 'ai_fallback_entries':sum(r.get('dictionary_source')=='ai_fallback' for r in scheduled),
 'missing_to_3000':max(0,3000-len(entries)),'days_with_30':sum(len(d['items'])==30 for d in days)
}
(OUT/'lexicon_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(report,ensure_ascii=False,indent=2))
if len(scheduled)<3000 or report['days_with_30']!=100:
    raise SystemExit('ERROR: reliable 3000-word schedule still incomplete; do not publish')
