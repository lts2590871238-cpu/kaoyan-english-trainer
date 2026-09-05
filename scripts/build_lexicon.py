#!/usr/bin/env python3
import csv, json, re, sys, hashlib
from pathlib import Path
from collections import defaultdict, Counter

ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'data/source'; WORK=ROOT/'data/work'; WORK.mkdir(parents=True,exist_ok=True)
ECDICT=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'cache/ecdict.csv'
LEMMA=Path(sys.argv[2]) if len(sys.argv)>2 else ROOT/'cache/lemma.en.txt'
WORDNET=Path(sys.argv[3]) if len(sys.argv)>3 else ROOT/'cache/wordnet_defs.json'
wordnet_defs=json.loads(WORDNET.read_text(encoding='utf8')) if WORDNET.exists() else {}

surface=json.loads((SRC/'words_surface.json').read_text(encoding='utf8'))
phrases=json.loads((SRC/'phrases_curated.json').read_text(encoding='utf8'))
corpus=json.loads((SRC/'corpus_sentences.json').read_text(encoding='utf8'))
allowed_corpus={s['id']:s for s in corpus if s.get('source')!='写作'}
allowed_ids=set(allowed_corpus)

TRIVIAL=set('''the a an this that these those i you he she it we they me him her us them my your his its our their mine yours ours theirs am is are was were be been being do does did have has had can could may might must shall should will would and or but nor if as than then there here very too so not no yes one two three first second last new old good big small day days year years people thing things something get got make made go went come came say said says see seen know think want use used using way time now today'''.split())
BOILER=set('''answer answers direction directions section part text texts question questions sheet mark numbered paragraph paragraphs write writing read reading choose choosing option options points page pages exam examination candidate candidates translate translation underlined segment segments neatly carefully reply essay directions lazynote kaoyan english-one pastpapers cn a-g a-h filling boxes correctly'''.split())
JUNK=set('''ming paul peter greg julia hannah victor buck sara karen dean ferraro scovell hayden rutkowski texas california britain europe yellowstone shakespeare'''.split())
SKIP=TRIVIAL|BOILER|JUNK
FORM_MARKERS=('过去式','过去分词','现在分词','第三人称','复数形式','复数','比较级','最高级')


def norm(w): return (w or '').strip().lower()
def lexical(w): return bool(len(w)>=3 and re.fullmatch(r"[a-z]+(?:-[a-z]+)*",w))
def split_lines(s): return [x.strip() for x in (s or '').replace('\\n','\n').split('\n') if x.strip()]
def zh_short(s):
    lines=split_lines(s)
    if not lines:return ''
    z='；'.join(lines[:2]); z=re.sub(r'\s+',' ',z)
    return z[:220]
def en_short(s):
    lines=split_lines(s)
    return ' '.join(lines[:2])[:420] if lines else ''
def pos_main(s):
    s=(s or '').strip()
    return s.split('/')[0].split(':')[0].strip() if s else ''
def short_match_zh(s):
    s=(s or '').strip()
    if not s:return ''
    s=re.sub(r'^(?:n|v|vt|vi|adj|adv|prep|conj|pron|aux|a|r)\.?\s*','',s,flags=re.I)
    for m in FORM_MARKERS: s=s.replace(m,'')
    parts=[p.strip(' .；;,，') for p in re.split(r'[；;\n]|\s{2,}',s) if p.strip()]
    return (parts[0] if parts else s)[:60]


def parse_lemma_file(path, needed):
    fmap={}
    if not path.exists(): raise SystemExit(f'lemma file missing: {path}')
    with path.open(encoding='utf8',errors='ignore') as f:
        for line in f:
            line=line.strip()
            if not line or line.startswith(';') or '->' not in line: continue
            left,right=line.split('->',1); lemma=norm(left.split('/',1)[0])
            if not lemma: continue
            if lemma in needed: fmap.setdefault(lemma,lemma)
            for raw in right.split(','):
                form=norm(raw)
                if form in needed and form not in fmap: fmap[form]=lemma
    return fmap


def clean_contexts(contexts,limit=12):
    out=[]; seen=set()
    for c in contexts or []:
        sid=c.get('sentence_id')
        if sid not in allowed_ids or sid in seen: continue
        s=allowed_corpus[sid]
        out.append({'sentence_id':sid,'year':s.get('year'),'page':s.get('page'),'text':s.get('text',''),'source':s.get('source','')})
        seen.add(sid)
        if len(out)>=limit: break
    return out


def looks_like_proper_noun(term,contexts,translation=''):
    if any(k in (translation or '') for k in ('人名','地名','姓氏')): return True
    if not contexts:return False
    pat=re.compile(r'(?<![A-Za-z])'+re.escape(term)+r'(?![A-Za-z])',re.I)
    noninitial=mid_caps=0
    for c in contexts[:12]:
        text=c.get('text','')
        for m in pat.finditer(text):
            token=text[m.start():m.end()]; prefix=text[:m.start()].rstrip()
            sent_initial=(not prefix) or prefix.endswith(('.', '!', '?', ':', ';'))
            if not sent_initial:
                noninitial+=1
                if token[:1].isupper(): mid_caps+=1
    return bool(noninitial>=2 and mid_caps/noninitial>=.75)


def load_rows(terms):
    rows={}
    with ECDICT.open(encoding='utf8',errors='ignore',newline='') as f:
        for row in csv.DictReader(f):
            w=norm(row.get('word',''))
            if w in terms: rows[w]=row
    return rows


def standalone_surface(surface,lemma,row):
    if surface==lemma or not row:return False
    trans=row.get('translation') or ''
    if any(m in trans for m in FORM_MARKERS): return False
    p=row.get('pos') or ''
    coll=int(row.get('collins') or 0) if str(row.get('collins') or '').isdigit() else 0
    ox=str(row.get('oxford') or '').strip() not in ('','0')
    return bool((coll>=2 or ox) and re.search(r'(^|/)(n|a|adj|adv)(:|/|$)',p))


def merge(dst,src):
    dst['count']+=int(src.get('count',0))
    for y,c in src.get('year_counts',{}).items(): dst['year_counts'][int(y)]+=int(c)
    dst['forms'].update(src.get('forms',[]))
    seen={c['sentence_id'] for c in dst['contexts']}
    for c in src.get('contexts',[]):
        if c['sentence_id'] not in seen and len(dst['contexts'])<12:
            dst['contexts'].append(c); seen.add(c['sentence_id'])
    return dst

needed={norm(x['surface']) for x in surface if lexical(norm(x['surface']))}
fmap=parse_lemma_file(LEMMA,needed)
surface_rows=load_rows(needed)
canonical_needed=set(); canon_of={}
for w in needed:
    lemma=fmap.get(w,w); row=surface_rows.get(w)
    term=w if standalone_surface(w,lemma,row) else lemma
    canon_of[w]=term; canonical_needed.add(term)
canon_rows=load_rows(canonical_needed | set(norm(p) for p in phrases))

# IMPORTANT V11 RULE:
# Selection is based on corpus value, NOT on whether every dictionary field is already present.
# Local dictionaries are used first; missing fields are queued for a small batched backfill later.
agg={}
for item in surface:
    w=norm(item.get('surface'))
    if w not in needed: continue
    term=canon_of.get(w,w)
    if term in SKIP or not lexical(term): continue
    crow=canon_rows.get(term) or {}
    srow=surface_rows.get(w) or {}
    # Field-wise fallback instead of all-or-nothing row fallback.
    dz=zh_short(crow.get('translation')) or zh_short(srow.get('translation'))
    de=en_short(crow.get('definition'))
    def_source='ecdict' if de else ''
    if not de:
        wndef=wordnet_defs.get(term) or wordnet_defs.get(w) or {}
        de=en_short(wndef.get('definition_en'))
        if de: def_source='wordnet'
    if not de:
        de=en_short(srow.get('definition'))
        if de: def_source='ecdict_surface'
    phon=(crow.get('phonetic') or srow.get('phonetic') or '').strip()
    pos=pos_main(crow.get('pos') or srow.get('pos'))
    row_for_meta=crow or srow
    contexts=clean_contexts(item.get('contexts',[]))
    rec={'term':term,'type':'word','count':int(item.get('count',0)),'year_counts':defaultdict(int),'contexts':contexts,
         'phonetic':phon,'dict_zh':dz,'match_zh':short_match_zh(dz),'definition_en':de,'pos':pos,
         'collins':int(row_for_meta.get('collins') or 0) if str(row_for_meta.get('collins') or '').isdigit() else 0,
         'oxford':1 if str(row_for_meta.get('oxford') or '').strip() not in ('','0') else 0,
         'bnc':int(row_for_meta.get('bnc') or 0) if str(row_for_meta.get('bnc') or '').isdigit() else 0,
         'frq':int(row_for_meta.get('frq') or 0) if str(row_for_meta.get('frq') or '').isdigit() else 0,
         'forms':{w},'dictionary_source':'local' if (dz or de) else 'missing',
         'definition_source':def_source,'needs_context_fill':not bool(contexts)}
    for y,c in item.get('year_counts',{}).items(): rec['year_counts'][int(y)]+=int(c)
    if term not in agg: agg[term]=rec
    else:
        # Merge corpus counts and keep any stronger local dictionary fields discovered on another form.
        old=agg[term]; merge(old,rec)
        for key in ('dict_zh','match_zh','definition_en','pos','phonetic'):
            if not old.get(key) and rec.get(key): old[key]=rec[key]
        if old.get('dictionary_source')=='missing' and rec.get('dictionary_source')!='missing': old['dictionary_source']=rec['dictionary_source']
        if not old.get('definition_source') and rec.get('definition_source'): old['definition_source']=rec['definition_source']

entries=[]; proper_excluded=0
for term,r in agg.items():
    if looks_like_proper_noun(term,r['contexts'],r.get('dict_zh','')):
        proper_excluded+=1; continue
    yc=dict(sorted(r['year_counts'].items()))
    core=sum(c for y,c in yc.items() if int(y)>=2023)>0
    if not core and int(r['count'])<5: continue
    r['year_counts']=yc; r['forms']=sorted(r['forms']); r['core_2023_2026']=core; r['supplement_2020_2022']=not core
    entries.append(r)

# Curated phrases are valid learning units even if they lack an English dictionary gloss locally.
for phrase,zh in phrases.items():
    p=norm(phrase)
    if not p or p in SKIP: continue
    ctx=[]; yc=defaultdict(int)
    for s in allowed_corpus.values():
        if s.get('year',0)<2023: continue
        n=s.get('text','').lower().count(p)
        if n:
            yc[int(s['year'])]+=n
            if len(ctx)<10: ctx.append({'sentence_id':s['id'],'year':s['year'],'page':s['page'],'text':s['text'],'source':s.get('source','')})
    if not ctx: continue
    prow=canon_rows.get(p,{})
    pdef=en_short(prow.get('definition')) or en_short((wordnet_defs.get(p) or {}).get('definition_en'))
    entries.append({'term':p,'type':'phrase','count':sum(yc.values()),'year_counts':dict(sorted(yc.items())),'contexts':ctx,
        'phonetic':(prow.get('phonetic') or '').strip(),'dict_zh':zh,'match_zh':short_match_zh(zh),'definition_en':pdef,
        'pos':'phrase','collins':0,'oxford':0,'bnc':0,'frq':0,'forms':[p],'dictionary_source':'curated',
        'definition_source':'ecdict' if pdef else '', 'needs_context_fill':False,'core_2023_2026':True,'supplement_2020_2022':False})

# Canonical term dedupe.
canon={}
for r in entries:
    t=r['term']
    if t not in canon:
        q=dict(r); q['year_counts']=defaultdict(int,{int(y):int(c) for y,c in r.get('year_counts',{}).items()}); q['forms']=set(r.get('forms',[])); q['contexts']=list(r.get('contexts',[])); canon[t]=q
    else:
        if r.get('type')=='phrase':
            old=canon[t]; r2=dict(r); r2['year_counts']=defaultdict(int,{int(y):int(c) for y,c in old.get('year_counts',{}).items()}); r2['forms']=set(old.get('forms',[]))|set(r.get('forms',[])); r2['contexts']=list(r.get('contexts',[])); canon[t]=r2
        else:
            old=canon[t]; merge(old,r)
            for key in ('dict_zh','match_zh','definition_en','pos','phonetic'):
                if not old.get(key) and r.get(key): old[key]=r[key]

entries=[]
for r in canon.values():
    r['year_counts']=dict(sorted(r['year_counts'].items())); r['forms']=sorted(r['forms']); r['needs_context_fill']=not bool(r.get('contexts'))
    r['missing_dictionary_fields']=[k for k in ('dict_zh','definition_en','pos') if not (r.get(k) or '').strip()]
    entries.append(r)


def priority(r):
    core=1 if r.get('core_2023_2026') else 0
    freq=int(r.get('count',0)); dictw=int(r.get('collins',0))*3+(10 if r.get('oxford') else 0)
    corpusw=(10000/(int(r.get('bnc',0))+1000) if int(r.get('bnc',0) or 0)>0 else 0)+(10000/(int(r.get('frq',0))+1000) if int(r.get('frq',0) or 0)>0 else 0)
    context_bonus=5 if r.get('contexts') else 0
    phrase_bonus=2 if r.get('type')=='phrase' else 0
    # Prefer locally complete entries when learning value is otherwise similar, but never discard useful source words only for missing fields.
    complete_bonus=4 if not r.get('missing_dictionary_fields') else 0
    return (-core,-freq,-dictw,-context_bonus,-complete_bonus,-corpusw,-phrase_bonus,r['term'])

entries.sort(key=priority)
if len(entries)<3000:
    raise SystemExit(f'BASE FAIL: only {len(entries)} canonical learning candidates after source/quality filtering; need 3000')
scheduled=entries[:3000]
terms=[r['term'] for r in scheduled]
if len(set(terms))!=3000: raise SystemExit('BASE FAIL: duplicate canonical terms')
for i,r in enumerate(scheduled):
    r['item_id']=f'v{i+1:04d}'; r['rank']=i+1; r['freq_band']='high' if i<1500 else ('mid' if i<2400 else 'low'); r['scheduled']=True

high=scheduled[:1500]; mid=scheduled[1500:2400]; low=scheduled[2400:]
days=[]
for d in range(100):
    items=[]; ids=[]; hs=high[d*15:(d+1)*15]; ms=mid[d*9:(d+1)*9]; ls=low[d*6:(d+1)*6]
    for b in range(3):
        grp=hs[b*5:(b+1)*5]+ms[b*3:(b+1)*3]+ls[b*2:(b+1)*2]
        items.extend(x['term'] for x in grp); ids.extend(x['item_id'] for x in grp)
    days.append({'day':d+1,'items':items,'item_ids':ids})
flat=[t for d in days for t in d['items']]
if len(flat)!=3000 or len(set(flat))!=3000 or set(flat)!=set(terms): raise SystemExit('BASE FAIL: schedule not bijective')

# Initialize sense table from local sources. Missing fields are intentionally preserved for the LIMITED backfill stage.
senses={}
for x in scheduled:
    senses[x['term']]={'sense_zh':x.get('match_zh') or x.get('dict_zh',''),'dict_zh':x.get('dict_zh',''),
                      'definition_en':x.get('definition_en',''),'pos':x.get('pos',''),'example_en':'','example_zh':'',
                      'sense_source':'local_dictionary' if not x.get('missing_dictionary_fields') else 'local_partial'}

# Keep all useful lookup entries, even partial; scheduled items will be made complete in backfill stage.
lookup=[{'term':r['term'],'forms':r.get('forms',[]),'phonetic':r.get('phonetic',''),'dict_zh':r.get('dict_zh',''),
         'definition_en':r.get('definition_en',''),'pos':r.get('pos','')} for r in entries]
lookup.sort(key=lambda x:x['term'])

(WORK/'dictionary.lookup.base.json').write_text(json.dumps(lookup,ensure_ascii=False,indent=2),encoding='utf8')
(WORK/'lexicon.base.json').write_text(json.dumps(scheduled,ensure_ascii=False,indent=2),encoding='utf8')
(WORK/'lexicon.senses.json').write_text(json.dumps(senses,ensure_ascii=False,indent=2),encoding='utf8')
(WORK/'days_words.json').write_text(json.dumps(days,ensure_ascii=False,indent=2),encoding='utf8')
missing=Counter()
for r in scheduled:
    for k in r.get('missing_dictionary_fields',[]): missing[k]+=1
complete=sum(not r.get('missing_dictionary_fields') for r in scheduled)
report={'lemma_mapped_surfaces':sum(1 for w in needed if fmap.get(w,w)!=w),'eligible_unique_entries':len(entries),'scheduled_entries':3000,
        'scheduled_words':sum(r['type']=='word' for r in scheduled),'scheduled_phrases':sum(r['type']=='phrase' for r in scheduled),
        'proper_noun_excluded':proper_excluded,'days_with_30':100,'unique_scheduled_terms':3000,
        'contextless_scheduled_terms':sum(not r.get('contexts') for r in scheduled),'local_dictionary_complete_items':complete,
        'dictionary_backfill_items':3000-complete,'missing_fields':dict(missing),
        'lexicon_fingerprint':hashlib.sha256('\n'.join(terms).encode()).hexdigest()}
(WORK/'lexicon_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(report,ensure_ascii=False,indent=2))
print('CANONICAL 3000 BUILD: PASS')
