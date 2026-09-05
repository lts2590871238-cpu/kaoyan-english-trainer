#!/usr/bin/env python3
import csv, json, re, sys, hashlib
from pathlib import Path
from collections import defaultdict

ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'data/source'; WORK=ROOT/'data/work'; WORK.mkdir(parents=True,exist_ok=True)
ECDICT=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'cache/ecdict.csv'

surface=json.loads((SRC/'words_surface.json').read_text(encoding='utf8'))
phrases=json.loads((SRC/'phrases_curated.json').read_text(encoding='utf8'))
corpus=json.loads((SRC/'corpus_sentences.json').read_text(encoding='utf8'))
# One canonical set of context sentences is used by selection, compilation and validation.
# Writing instructions/prompts are not vocabulary contexts; all genuine paper prose including cloze is allowed.
allowed_corpus={s['id']:s for s in corpus if s.get('source')!='写作'}
allowed_ids=set(allowed_corpus)

TRIVIAL=set('''the a an this that these those i you he she it we they me him her us them my your his its our their mine yours ours theirs am is are was were be been being do does did have has had can could may might must shall should will would and or but nor if as than then there here very too so not no yes one two three first second last new old good big small day days year years people thing things something get got make made go went come came say said says see seen know think want use used using way time now today'''.split())
BOILER=set('''answer answers direction directions section part text question questions sheet mark numbered paragraph paragraphs write writing read reading choose choosing option options points page pages exam examination candidate candidates'''.split())
SKIP=TRIVIAL|BOILER

def norm_word(w): return (w or '').strip().lower()
def parse_lemma(exchange,word):
    if not exchange:return word
    for item in exchange.split('/'):
        if item.startswith('0:'):
            x=item[2:].strip().lower()
            if x:return x
    return word

def split_lines(s): return [x.strip() for x in (s or '').replace('\\n','\n').split('\n') if x.strip()]
def zh_short(s):
    lines=split_lines(s); return re.sub(r'\s+',' ','；'.join(lines[:2]))[:180] if lines else ''
def en_short(s):
    lines=split_lines(s); return ' '.join(lines[:2])[:360] if lines else ''
def lexical(w): return bool(len(w)>=3 and re.fullmatch(r"[a-z]+(?:-[a-z]+)*",w))

def clean_contexts(contexts,limit=10):
    out=[]; seen=set()
    for c in contexts or []:
        sid=c.get('sentence_id')
        if sid not in allowed_ids or sid in seen: continue
        s=allowed_corpus[sid]
        out.append({'sentence_id':sid,'year':s.get('year'),'page':s.get('page'),'text':s.get('text',''),'source':s.get('source','')})
        seen.add(sid)
        if len(out)>=limit: break
    return out

def looks_like_proper_noun(term,contexts):
    if not contexts:return False
    noninitial=mid_caps=0
    pat=re.compile(r'(?<![A-Za-z])'+re.escape(term)+r'(?![A-Za-z])',re.I)
    for c in contexts[:12]:
        text=c.get('text','')
        for m in pat.finditer(text):
            token=text[m.start():m.end()]; prefix=text[:m.start()].rstrip()
            sent_initial=(not prefix) or prefix.endswith(('.', '!', '?', ':', ';'))
            if not sent_initial:
                noninitial+=1
                if token[:1].isupper(): mid_caps+=1
    return bool(noninitial>=1 and mid_caps==noninitial) or bool(noninitial>=2 and mid_caps/noninitial>=.75)

def merge_record(dst,src):
    dst['count']+=int(src.get('count',0))
    for y,c in src.get('year_counts',{}).items(): dst['year_counts'][int(y)]+=int(c)
    seen={c['sentence_id'] for c in dst['contexts']}
    for c in src.get('contexts',[]):
        if c['sentence_id'] not in seen and len(dst['contexts'])<10:
            dst['contexts'].append(c); seen.add(c['sentence_id'])
    dst['forms'].update(src.get('forms',[]))
    for k in ('phonetic','dict_zh','definition_en','pos'):
        if not dst.get(k) and src.get(k): dst[k]=src[k]
    for k in ('collins','oxford'):
        dst[k]=max(int(dst.get(k,0) or 0),int(src.get(k,0) or 0))
    for k in ('bnc','frq'):
        vals=[v for v in (int(dst.get(k,0) or 0),int(src.get(k,0) or 0)) if v>0]
        dst[k]=min(vals) if vals else 0
    dst['ai_dictionary_fill']=bool(dst.get('ai_dictionary_fill') or src.get('ai_dictionary_fill'))
    dst['needs_context_fill']=not bool(dst.get('contexts'))
    # Curated phrase semantics win on exact collision (e.g. state-of-the-art).
    if src.get('dictionary_source')=='curated':
        dst['type']='phrase'; dst['dict_zh']=src.get('dict_zh') or dst.get('dict_zh',''); dst['pos']='phrase'; dst['dictionary_source']='curated'
    return dst

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

agg={}
for item in surface:
    w=norm_word(item['surface']); row=rows.get(w)
    if not row: continue
    lemma=parse_lemma(row.get('exchange',''),w); lrow=rows.get(lemma,row)
    if lemma in SKIP or not lexical(lemma): continue
    contexts=clean_contexts(item.get('contexts',[]))
    trans=zh_short(lrow.get('translation') or row.get('translation'))
    definition=en_short(lrow.get('definition') or row.get('definition'))
    if not trans and not definition: continue
    rec={'term':lemma,'type':'word','count':int(item.get('count',0)),'year_counts':defaultdict(int),'contexts':contexts,
         'phonetic':(lrow.get('phonetic') or row.get('phonetic') or '').strip(),'dict_zh':trans,'definition_en':definition,
         'pos':(lrow.get('pos') or row.get('pos') or '').strip(),'collins':int(lrow.get('collins') or 0) if str(lrow.get('collins') or '').isdigit() else 0,
         'oxford':int(lrow.get('oxford') or 0) if str(lrow.get('oxford') or '').isdigit() else 0,
         'bnc':int(lrow.get('bnc') or 0) if str(lrow.get('bnc') or '').isdigit() else 0,
         'frq':int(lrow.get('frq') or 0) if str(lrow.get('frq') or '').isdigit() else 0,
         'forms':{w},'ai_dictionary_fill':bool(not trans or not definition),'dictionary_source':'ecdict','needs_context_fill':not bool(contexts)}
    for y,c in item.get('year_counts',{}).items(): rec['year_counts'][int(y)]+=int(c)
    if lemma not in agg: agg[lemma]=rec
    else: merge_record(agg[lemma],rec)

entries=[]; proper_noun_excluded=0
for lemma,r in agg.items():
    if looks_like_proper_noun(lemma,r['contexts']): proper_noun_excluded+=1; continue
    yc=dict(sorted(r['year_counts'].items())); core=sum(c for y,c in yc.items() if y>=2023)>0; pre=sum(c for y,c in yc.items() if y<=2022)
    if not (core or ((not core) and r['count']>=5 and pre>0)): continue
    r['year_counts']=yc; r['forms']=sorted(r['forms']); r['core_2023_2026']=core; r['supplement_2020_2022']=not core
    entries.append(r)

recent_text='\n'.join(s['text'].lower() for s in allowed_corpus.values() if s['year']>=2023)
for phrase,zh in phrases.items():
    p=phrase.lower().strip(); count=recent_text.count(p)
    if count<=0: continue
    ctx=[]; yc=defaultdict(int)
    for s in allowed_corpus.values():
        n=s['text'].lower().count(p)
        if n:
            yc[s['year']]+=n
            if len(ctx)<8:ctx.append({'sentence_id':s['id'],'year':s['year'],'page':s['page'],'text':s['text'],'source':s.get('source','')})
    if not ctx: continue
    entries.append({'term':p,'type':'phrase','count':sum(yc.values()),'year_counts':dict(sorted(yc.items())),'contexts':ctx,
      'phonetic':'','dict_zh':zh,'definition_en':'','pos':'phrase','collins':0,'oxford':0,'bnc':0,'frq':0,'forms':[p],
      'core_2023_2026':True,'supplement_2020_2022':False,'ai_dictionary_fill':True,'dictionary_source':'curated','needs_context_fill':False})

# Canonical dedupe BEFORE fallback/ranking/scheduling. This eliminates word/phrase collisions.
canon={}
for r in entries:
    t=r['term']
    if t not in canon:
        q=dict(r); q['year_counts']=defaultdict(int,{int(y):int(c) for y,c in r.get('year_counts',{}).items()}); q['forms']=set(r.get('forms',[])); q['contexts']=list(r.get('contexts',[])); canon[t]=q
    else: merge_record(canon[t],r)
entries=[]
for r in canon.values():
    r['year_counts']=dict(sorted(r['year_counts'].items())); r['forms']=sorted(r['forms']); entries.append(r)

existing=set(canon)
if len(entries)<3000:
    fallback=[]
    for item in surface:
        w=norm_word(item['surface'])
        if w in existing or w in SKIP or not lexical(w):continue
        yc={int(y):int(c) for y,c in item.get('year_counts',{}).items()}; core_count=sum(c for y,c in yc.items() if y>=2023)
        if core_count<=0:continue
        ctx=clean_contexts(item.get('contexts',[]))
        if not ctx or looks_like_proper_noun(w,ctx):continue
        fallback.append({'term':w,'type':'word','count':int(item.get('count',0)),'year_counts':dict(sorted(yc.items())),'contexts':ctx,
          'phonetic':'','dict_zh':'','definition_en':'','pos':'','collins':0,'oxford':0,'bnc':0,'frq':0,'forms':[w],
          'core_2023_2026':True,'supplement_2020_2022':False,'ai_dictionary_fill':True,'dictionary_source':'ai_fallback','needs_context_fill':False})
    fallback.sort(key=lambda r:(-r['count'],r['term']))
    need=3000-len(entries); entries.extend(fallback[:need])

def priority(r):
    core=1 if r['core_2023_2026'] else 0; freq=r['count']; dict_weight=(r.get('collins',0)*3)+(10 if r.get('oxford',0) else 0)
    corpus_weight=(10000/(r['bnc']+1000) if r.get('bnc',0)>0 else 0)+(10000/(r['frq']+1000) if r.get('frq',0)>0 else 0)
    phrase_bonus=2 if r['type']=='phrase' else 0; source_bonus=3 if r.get('dictionary_source')=='ecdict' else (1 if r.get('dictionary_source')=='curated' else 0)
    return core*10000+freq*25+dict_weight+corpus_weight+phrase_bonus+source_bonus
entries.sort(key=lambda r:(-priority(r),-r['count'],r['term']))
scheduled=entries[:3000]
# Final canonical gate before any AI money is spent.
terms=[r['term'] for r in scheduled]
if len(scheduled)!=3000: raise SystemExit(f'BASE FAIL: only {len(scheduled)} eligible entries')
if len(set(terms))!=3000:
    dup=[t for t in set(terms) if terms.count(t)>1]
    raise SystemExit(f'BASE FAIL: duplicate canonical terms: {dup[:20]}')
# Contextless option/question vocabulary is allowed only as an explicit build-time debt.
# DeepSeek must generate a clearly labelled AI practice example before publication.
for r in scheduled:
    r['needs_context_fill']=not bool(r.get('contexts'))

for i,r in enumerate(scheduled):
    r['item_id']=f'v{i+1:04d}'; r['rank']=i+1; r['freq_band']='high' if i<1500 else ('mid' if i<2400 else 'low'); r['scheduled']=True
high=scheduled[:1500]; mid=scheduled[1500:2400]; low=scheduled[2400:3000]
days=[]
for d in range(100):
    hs=high[d*15:(d+1)*15]; ms=mid[d*9:(d+1)*9]; ls=low[d*6:(d+1)*6]; items=[]; ids=[]
    for b in range(3):
        grp=hs[b*5:(b+1)*5]+ms[b*3:(b+1)*3]+ls[b*2:(b+1)*2]
        items.extend(x['term'] for x in grp); ids.extend(x['item_id'] for x in grp)
    days.append({'day':d+1,'items':items,'item_ids':ids})
flat=[t for d in days for t in d['items']]
if len(flat)!=3000 or len(set(flat))!=3000 or set(flat)!=set(terms):
    raise SystemExit('BASE FAIL: schedule is not a bijection of the 3000 canonical terms')

# Auxiliary dictionary base can contain extra eligible terms, but final compile MUST inject all 3000 enriched scheduled terms.
lookup=[]
for r in entries:
    if r.get('dict_zh') or r.get('definition_en'):
        lookup.append({'term':r['term'],'forms':r.get('forms',[]),'phonetic':r.get('phonetic',''),'dict_zh':r.get('dict_zh',''),
          'definition_en':r.get('definition_en',''),'pos':r.get('pos','')})
lookup.sort(key=lambda x:x['term'])

fingerprint=hashlib.sha256('\n'.join(terms).encode()).hexdigest()
(WORK/'dictionary.lookup.base.json').write_text(json.dumps(lookup,ensure_ascii=False,indent=2),encoding='utf8')
(WORK/'lexicon.base.json').write_text(json.dumps(scheduled,ensure_ascii=False,indent=2),encoding='utf8')
(WORK/'days_words.json').write_text(json.dumps(days,ensure_ascii=False,indent=2),encoding='utf8')
report={'ecdict_rows_loaded':len(rows),'eligible_unique_entries':len(entries),'scheduled_entries':3000,'scheduled_words':sum(r['type']=='word' for r in scheduled),
'scheduled_phrases':sum(r['type']=='phrase' for r in scheduled),'proper_noun_excluded':proper_noun_excluded,'needs_ai_dictionary_fill':sum(bool(r.get('ai_dictionary_fill')) for r in scheduled),
'ai_fallback_entries':sum(r.get('dictionary_source')=='ai_fallback' for r in scheduled),'days_with_30':100,'unique_scheduled_terms':len(set(terms)),
'contextless_scheduled_terms':sum(bool(r.get('needs_context_fill')) for r in scheduled),'lexicon_fingerprint':fingerprint}
(WORK/'lexicon_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(report,ensure_ascii=False,indent=2)); print('BASE LEXICON BUILD: PASS')
