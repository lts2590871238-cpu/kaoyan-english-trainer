#!/usr/bin/env python3
import csv, json, re, sys
from pathlib import Path
from collections import defaultdict

ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'data/source'
OUT=ROOT/'data/generated'
OUT.mkdir(parents=True,exist_ok=True)
ECDICT=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'cache/ecdict.csv'

surface=json.loads((SRC/'words_surface.json').read_text(encoding='utf8'))
phrases=json.loads((SRC/'phrases_curated.json').read_text(encoding='utf8'))

# Extra simple/exam boilerplate removals beyond extraction stop list.
SIMPLE=set('''able above according act actually add allow almost alone already also always among another around away back become becomes became becoming better big both bring brought called came come comes coming common consider considered could current currently day days different does done each early enough especially even ever every fact few find found first following get gets getting give given gives go goes going good got great high however important increase increasingly just keep kind kinds know known large last later lead least less like likely little long look looked looking made make makes making many may mean means might more most much must need needs new next now number often old once one only order other others own part people perhaps place point possible probably put quite rather really result results right same say says said see seen several since small so some something still take taken takes taking than then there therefore thing things think thought three through time today together too two under use used uses using very want way ways well what when where whether while who why will within without work works world would year years young'''.split())
BOILER=set('''answer answers direction directions section part text question questions sheet mark numbered paragraph paragraphs write writing read reading choose choosing option options points page pages'''.split())
SKIP=SIMPLE|BOILER

def norm_word(w):
    return w.strip().lower()

def parse_lemma(exchange, word):
    if not exchange:return word
    for item in exchange.split('/'):
        if item.startswith('0:'):
            x=item[2:].strip().lower()
            if x:return x
    return word

def split_lines(s):
    return [x.strip() for x in (s or '').replace('\\n','\n').split('\n') if x.strip()]

def zh_short(translation):
    lines=split_lines(translation)
    if not lines:return ''
    # Keep a concise but not misleading first 1-2 senses; strip exam labels.
    joined='；'.join(lines[:2])
    joined=re.sub(r'\s+',' ',joined)
    return joined[:160]

def en_short(definition):
    lines=split_lines(definition)
    return ' '.join(lines[:2])[:320]

needed={norm_word(x['surface']) for x in surface}
rows={}
with ECDICT.open(encoding='utf8',errors='ignore',newline='') as f:
    r=csv.DictReader(f)
    for row in r:
        w=norm_word(row.get('word',''))
        if w in needed:
            rows[w]=row

# Determine lemmas, then fetch lemma rows if needed.
lemma_needed=set()
for w,row in rows.items():
    lemma_needed.add(parse_lemma(row.get('exchange',''),w))
missing_lemma=lemma_needed-set(rows)
if missing_lemma:
    with ECDICT.open(encoding='utf8',errors='ignore',newline='') as f:
        r=csv.DictReader(f)
        for row in r:
            w=norm_word(row.get('word',''))
            if w in missing_lemma:
                rows[w]=row

agg={}
for item in surface:
    w=norm_word(item['surface'])
    row=rows.get(w)
    if not row:continue
    lemma=parse_lemma(row.get('exchange',''),w)
    lrow=rows.get(lemma,row)
    if lemma in SKIP or len(lemma)<3 or not re.fullmatch(r"[a-z]+(?:[-'][a-z]+)*",lemma):
        continue
    trans=zh_short(lrow.get('translation') or row.get('translation'))
    definition=en_short(lrow.get('definition') or row.get('definition'))
    if not trans or not definition:
        continue
    rec=agg.setdefault(lemma,{
        'term':lemma,'type':'word','count':0,'year_counts':defaultdict(int),'contexts':[],
        'phonetic':(lrow.get('phonetic') or row.get('phonetic') or '').strip(),
        'dict_zh':trans,'definition_en':definition,
        'pos':(lrow.get('pos') or row.get('pos') or '').strip(),
        'collins':int(lrow.get('collins') or 0) if str(lrow.get('collins') or '').isdigit() else 0,
        'oxford':int(lrow.get('oxford') or 0) if str(lrow.get('oxford') or '').isdigit() else 0,
        'bnc':int(lrow.get('bnc') or 0) if str(lrow.get('bnc') or '').isdigit() else 0,
        'frq':int(lrow.get('frq') or 0) if str(lrow.get('frq') or '').isdigit() else 0,
        'forms':set(),
    })
    rec['count']+=int(item.get('count',0))
    rec['forms'].add(w)
    for y,c in item.get('year_counts',{}).items():rec['year_counts'][int(y)]+=int(c)
    existing={x['sentence_id'] for x in rec['contexts']}
    for ctx in item.get('contexts',[]):
        if ctx['sentence_id'] not in existing and len(rec['contexts'])<10:
            rec['contexts'].append(ctx); existing.add(ctx['sentence_id'])

# Build a local click-to-define dictionary for every source lemma successfully resolved by ECDICT.
# This is broader than the 3000-word study schedule, so words in review sentences remain clickable without any network request.
lookup_entries=[]
for lemma,r in agg.items():
    if not r.get('dict_zh'): continue
    lookup_entries.append({
      'term':lemma,'forms':sorted(r['forms']),'phonetic':r.get('phonetic',''),'dict_zh':r.get('dict_zh',''),
      'definition_en':r.get('definition_en',''),'pos':r.get('pos','')
    })
lookup_entries.sort(key=lambda x:x['term'])
(OUT/'dictionary.lookup.base.json').write_text(json.dumps(lookup_entries,ensure_ascii=False,indent=2),encoding='utf8')

# convert defaultdict/set and classify core/supplement
entries=[]
for lemma,r in agg.items():
    yc=dict(sorted(r['year_counts'].items()))
    core=sum(c for y,c in yc.items() if y>=2023)>0
    pre=sum(c for y,c in yc.items() if y<=2022)
    eligible = core or ((not core) and r['count']>=5 and pre>0)
    if not eligible:continue
    r['year_counts']=yc; r['forms']=sorted(r['forms']); r['core_2023_2026']=core
    r['supplement_2020_2022']=not core
    entries.append(r)

# Add curated phrases appearing in 2023-2026 corpus. Phrase frequency is counted in source sentences.
corpus=json.loads((SRC/'corpus_sentences.json').read_text(encoding='utf8'))
recent_text='\n'.join(s['text'].lower() for s in corpus if s['year']>=2023)
for phrase,zh in phrases.items():
    p=phrase.lower().strip()
    count=recent_text.count(p)
    if count<=0:continue
    ctx=[]; ycounts=defaultdict(int)
    for s in corpus:
        if p in s['text'].lower():
            ycounts[s['year']]+=s['text'].lower().count(p)
            if len(ctx)<8:ctx.append({'sentence_id':s['id'],'year':s['year'],'page':s['page'],'text':s['text']})
    entries.append({'term':p,'type':'phrase','count':sum(ycounts.values()),'year_counts':dict(sorted(ycounts.items())),
                    'contexts':ctx,'phonetic':'','dict_zh':zh,'definition_en':'','pos':'phrase','collins':0,'oxford':0,'bnc':0,'frq':0,
                    'forms':[p],'core_2023_2026':True,'supplement_2020_2022':False})

# Add curated true-paper phrases to click dictionary too.
for phrase,zh in phrases.items():
    p=phrase.lower().strip()
    if p and all(x['term']!=p for x in lookup_entries):
        lookup_entries.append({'term':p,'forms':[p],'phonetic':'','dict_zh':zh,'definition_en':'','pos':'phrase'})
lookup_entries.sort(key=lambda x:x['term'])
(OUT/'dictionary.lookup.base.json').write_text(json.dumps(lookup_entries,ensure_ascii=False,indent=2),encoding='utf8')

# Priority: core first; then exam frequency; then mainstream-dictionary evidence.
def priority(r):
    core=1 if r['core_2023_2026'] else 0
    freq=r['count']
    dict_weight=(r.get('collins',0)*3)+(10 if r.get('oxford',0) else 0)
    corpus_weight=(10_000/(r['bnc']+1000) if r.get('bnc',0)>0 else 0)+(10_000/(r['frq']+1000) if r.get('frq',0)>0 else 0)
    phrase_bonus=2 if r['type']=='phrase' else 0
    return core*10000+freq*25+dict_weight+corpus_weight+phrase_bonus
entries.sort(key=lambda r:(-priority(r),-r['count'],r['term']))

# Exactly 3000 scheduled items if available. Keep all eligible in dictionary, but schedule first 3000.
scheduled=entries[:3000]
for i,r in enumerate(scheduled):
    if i<1500:r['freq_band']='high'
    elif i<2400:r['freq_band']='mid'
    else:r['freq_band']='low'
    r['scheduled']=True
for r in entries[3000:]:
    r['freq_band']='extra'; r['scheduled']=False

# Daily 15/9/6 = 5:3:2, deterministic interleaving by band.
high=[r for r in scheduled if r['freq_band']=='high']
mid=[r for r in scheduled if r['freq_band']=='mid']
low=[r for r in scheduled if r['freq_band']=='low']
days=[]
for d in range(100):
    hs=high[d*15:(d+1)*15]; ms=mid[d*9:(d+1)*9]; ls=low[d*6:(d+1)*6]
    items=[]
    # interleave 5:3:2 in each block of 10, repeated 3 times
    for b in range(3):
        items += [x['term'] for x in hs[b*5:(b+1)*5]]
        items += [x['term'] for x in ms[b*3:(b+1)*3]]
        items += [x['term'] for x in ls[b*2:(b+1)*2]]
    days.append({'day':d+1,'items':items})

(OUT/'lexicon.base.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2),encoding='utf8')
(OUT/'days_words.json').write_text(json.dumps(days,ensure_ascii=False,indent=2),encoding='utf8')
report={
    'ecdict_resolved_surfaces':len(rows),'eligible_entries':len(entries),'scheduled_entries':len(scheduled),
    'scheduled_words':sum(r['type']=='word' for r in scheduled),'scheduled_phrases':sum(r['type']=='phrase' for r in scheduled),
    'core_entries':sum(r['core_2023_2026'] for r in entries),'supplement_entries':sum(r['supplement_2020_2022'] for r in entries),
    'missing_to_3000':max(0,3000-len(entries)),
    'days_with_30':sum(len(d['items'])==30 for d in days),
}
(OUT/'lexicon_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(report,ensure_ascii=False,indent=2))
if len(scheduled)<3000:
    raise SystemExit('ERROR: fewer than 3000 reliable scheduled entries; adjust source/filtering before publishing')
