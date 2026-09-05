import re,json,unicodedata
from pathlib import Path
from pypdf import PdfReader
from collections import Counter,defaultdict
BASE=Path('/mnt/data')
FILES={2020:'2020-1.pdf',2021:'2021-1.pdf',2022:'2022-1.pdf',2023:'2023-1.pdf',2024:'2024-1.pdf',2025:'2025-1.pdf',2026:'考研英语一2026年真题（整卷）.pdf'}
RANGES={
2020:[(2,3,'完形'),(4,11,'阅读A'),(12,14,'阅读B'),(15,15,'翻译C'),(16,16,'写作')],
2021:[(2,3,'完形'),(4,11,'阅读A'),(12,13,'阅读B'),(14,14,'翻译C'),(15,15,'写作')],
2022:[(1,2,'完形'),(3,8,'阅读A'),(9,10,'阅读B'),(11,11,'翻译C'),(12,12,'写作')],
2023:[(1,2,'完形'),(3,9,'阅读A'),(9,11,'阅读B'),(12,12,'翻译C'),(13,13,'写作')],
2024:[(1,2,'完形'),(3,10,'阅读A'),(11,13,'阅读B'),(13,14,'翻译C'),(14,15,'写作')],
2025:[(1,2,'完形'),(3,10,'阅读A'),(11,12,'阅读B'),(13,13,'翻译C'),(14,14,'写作')],
2026:[(1,3,'完形'),(4,9,'阅读A'),(9,10,'阅读B'),(10,11,'翻译C'),(11,12,'写作')],
}

CLOZE_ANSWERS={
2020:['On','match','enjoyment','guaranteed','issued','at','avoid','partially','While','conclusive','likely','On the basis of','advisable','After all','connection','served','To be fair','entirely','campaign','end up'],
2021:['peaks','generally','while','accumulation','possibility','delay','included','compared','with','scored','went by','attributable','involved','explain','treatments','Meanwhile','take','wellbeing','level','diet'],
2022:['coined','compared','Though','hinted at','differs','evidence','argued','forming','analogous','even','perspective','reducing','However','superficially','level','added','chances','danger','recognizes','poor'],
2023:['located','privately','combination','describe','such as','construction','faced','subjected','so that','meeting','As a result','exchange','as well as','influencing','aided','Indeed','stock up on','believed','although','ruins'],
2024:['Without','improving','convenience','previously','started out','benefits','useful','act as','As well as','occupied','allow','clear','relying on','Although','principles','analyses','complement','For example','suit','appropriate'],
2025:['prone','gradually','submerged','remains','off','currents','protected','gathering','when','structures','examine','Despite','undisturbed','resumed','techniques','employed','light','connected','suggesting','robust'],
2026:['Still','dominating','area','Combining','outcomes','For instance','test','before','explore','analyze','customized','In this way','concerns','pressures','Additionally','contribute to','relying','such as','appreciation','replace']
}

def normalize(s):
    s=unicodedata.normalize('NFKC',s).replace('\u00ad','').replace('￾','')
    s=s.replace('“','"').replace('”','"').replace('’',"'").replace('‘',"'")
    s=re.sub(r'pastpapers\.\s*cn(?:\s*年考研\s*真题)?',' ',s,flags=re.I)
    s=re.sub(r'\b(?:20\d{2}\s*)?年考研\s*真题\b',' ',s)
    # Known PDF/OCR joins in the seven source papers. These are deterministic source repairs, not language generation.
    fixes={
      'andthequestioningof':'and the questioning of','Churchideals':'Church ideals','beencouraged':'be encouraged',
      'computer-to-computeractivities':'computer-to-computer activities','biasfrom':'bias from','ownenergy':'own energy',
      'avant-gardesculptures':'avant-garde sculptures','anassistant':'an assistant','inmuseums':'in museums',
      'tocollect':'to collect','inthe future':'in the future','isalready':'is already','tomake':'to make',
      'doom-andgloom':'doom-and-gloom','institution-this':'institution—this','caregivers-this':'caregivers—this',
      'anon-committal':'non-committal','bum down':'burn down','follow-village':'follow—village'
    }
    for a,b in fixes.items(): s=s.replace(a,b)
    s=s.replace('curiosity, Scientific method','curiosity. Scientific method')
    s=s.replace('suppress. this new generation','suppress this new generation')
    s=s.replace('Light was a something','Light was something')
    # Quotation marks frequently span several PDF-split sentences. Drop only the quote glyphs, not apostrophes.
    s=s.replace('\"','')
    # OCR/PDF often separates initials and line-broken compounds.
    s=re.sub(r'\bU\.\s*S\.', 'U.S.', s); s=re.sub(r'\bU\.\s*K\.', 'U.K.', s); s=re.sub(r'\bE\.\s*U\.', 'E.U.', s)
    s=re.sub(r'([A-Za-z])-\s*\n\s*([A-Za-z])',r'\1-\2',s)
    s=re.sub(r'([A-Za-z])-\s+([A-Za-z])',r'\1-\2',s)
    s=re.sub(r'\s+',' ',s)
    s=re.sub(r'\s+([,.;:!?])',r'\1',s)
    s=re.sub(r'([,.;:!?])(?=[A-Za-z])',r'\1 ',s)
    return s.strip()

def clean_page(raw,year,page):
    s=normalize(raw)
    # remove leading page counters and text headings
    s=re.sub(r'^\.?\d+\.?\s*', '', s)
    s=re.sub(r'^Text\s+\d+\s*', '', s, flags=re.I)
    patterns=[
      r'绝密★启用前',r'pastpapers\.cn',r'懒笔记\s*·\s*https?://\S+.*?(?=\s|$)',
      rf'{year}\s*年?全国硕士研究生招生考试英语\s*\(?一\)?试题',rf'{year}\s*年考研英语\s*\(?一\)?真题\s*第\s*\d+\s*页\s*共\s*\d+\s*页',
      r'第\s*\d+\s*页\s*共\s*\d+\s*页',r'\(科目代码:\s*201\)',r'英语\s*\(一\)',
      r'Section\s+[ⅠIVX]+\s+Use\s+of\s+English',r'Section\s+II\s+Reading\s+Comprehension',r'Section\s+III\s+Writing',
    ]
    for p in patterns:s=re.sub(p,' ',s,flags=re.I)
    # remove recurring standalone headings without deleting content after them
    s=re.sub(r'\bPart\s+[ABC]\b',' ',s,flags=re.I)
    s=re.sub(r'\bText\s+[1-4]\b',' ',s,flags=re.I)
    return normalize(s)

# protect abbreviations. Replacement tokens contain no period.
ABBR_PATTERNS=[
 (re.compile(r'\bU\.S\.',re.I),'§US§'),(re.compile(r'\bU\.K\.',re.I),'§UK§'),(re.compile(r'\bE\.U\.',re.I),'§EU§'),
 (re.compile(r'\b(?:Mr|Mrs|Ms|Dr|Prof|St|vs|etc|Inc)\.',re.I),None),
 (re.compile(r'\be\.g\.',re.I),'§EG§'),(re.compile(r'\bi\.e\.',re.I),'§IE§')]

def protect(text):
    mapping={}; t=text
    idx=0
    for pat,fixed in ABBR_PATTERNS:
        def repl(m):
            nonlocal idx
            key=fixed or f'§AB{idx}§'; idx+=1;mapping[key]=m.group(0);return key
        t=pat.sub(repl,t)
    t=re.sub(r'(\d)\.(\d)',lambda m:f'{m.group(1)}§DOT§{m.group(2)}',t)
    return t,mapping

def restore(s,mapping):
    for k,v in mapping.items():s=s.replace(k,v)
    return s.replace('§DOT§','.')

def split_sentences(text):
    t,m=protect(text)
    # split at punctuation + whitespace, retaining closing quote in prior sentence
    parts=re.split(r'(?<=[.!?]["\'])\s+(?=[A-Z0-9"\'])|(?<=[.!?])\s+(?=[A-Z0-9"\'])',t)
    return [restore(x.strip(),m) for x in parts if x.strip()]

BAD_SUBSTR=['ANSWER SHEET','Directions:','Choose the best','Mark your answers','Which of the following','According to Paragraph','Write your answer','Do not use your own name','You should write','There are two extra','Dear Li Ming','Yours,','考生','试题','http://','lazynote','questions after each text']
BAD_START=re.compile(r'^(?:\(?\d{2}\)?\s*[.:]|\[?[A-G]\]\s*|[A-G]\.)')

def clean_sentence(s):
    s=normalize(s)
    s=re.sub(r'^\d+\s+(?=[A-Z][a-z])','',s) # leftover page number
    s=re.sub(r'^Text\s+[1-4]\s+','',s,flags=re.I)
    return s.strip(' -')

def valid(s,source):
    if any(x.lower() in s.lower() for x in BAD_SUBSTR):return False
    if BAD_START.match(s):return False
    if not re.search(r'[.!?]["\']?$',s):return False
    words=re.findall(r"[A-Za-z]+(?:[-'][A-Za-z]+)*",s)
    if len(words)<4 or len(words)>85:return False
    if re.search(r'\[[A-G]\]',s) or '_' in s:return False
    # Reject cloze passage sentences with numbered holes; they are not complete sentences.
    if source=='完形' and re.search(r'(?<!\d)\b(?:[1-9]|1\d|20)\b(?!\d)',s):return False
    # reject suspicious OCR single-letter debris except a/I
    singles=[x for x in re.findall(r'(?<![A-Za-z])([A-Za-z])(?![A-Za-z])',s) if x.lower() not in ('a','i')]
    if singles:return False
    return True

all_sent=[]; page_texts={}; raw_token_pages=[]
for year,fn in FILES.items():
    r=PdfReader(BASE/fn); pages={i+1:clean_page(p.extract_text() or '',year,i+1) for i,p in enumerate(r.pages)};page_texts[year]=pages
    # token source includes all cleaned English text (including options), later stop/lemma filters remove boilerplate.
    for p,t in pages.items():raw_token_pages.append((year,p,t))
    for a,b,src in RANGES[year]:
        section=' '.join(pages[p] for p in range(a,b+1) if p in pages)
        section=re.sub(r'\(\s*(?:4[1-9]|50)\s*\)',' ',section)
        if src=='阅读B':
            section=re.sub(r'\[\s*[A-H]\s*\]',' ',section)
            for nm in ['Hannah','Buck','Sara','Victor','Julia','Teri Byrd','Karen R. Sime','Greg Newberry','Dean Gallea','John Fraser']:
                section=re.sub(rf'\b{re.escape(nm)}\b',' ',section)
        for s in split_sentences(section):
            s=clean_sentence(s)
            if not valid(s,src):continue
            # approximate originating page by searching a distinctive prefix in pages.
            prefix=re.sub(r'\s+',' ',s[:70]).strip(); page=a
            for p in range(a,b+1):
                if prefix[:35] and prefix[:35] in pages.get(p,''):
                    page=p;break
            wc=len(re.findall(r"[A-Za-z]+(?:[-'][A-Za-z]+)*",s))
            all_sent.append({'year':year,'page':page,'source':src,'text':s,'word_count':wc})

# Reconstruct the seven cloze passages with externally verified correct answer words.
# These become complete sentence material; the original blanked versions are not used for sentence training.
for year,answers in CLOZE_ANSWERS.items():
    a,b,_=RANGES[year][0]
    joined=' '.join(page_texts[year][p] for p in range(a,b+1) if p in page_texts[year])
    # Keep only passage before the first option list.
    cut=re.search(r'(?<!\d)1\s*\.\s*(?:\[|【)\s*A',joined,re.I)
    if cut: joined=joined[:cut.start()]
    joined=re.sub(r'Directions:.*?\(10 points\)',' ',joined,flags=re.I)
    # Replace one occurrence of each numbered hole, in order.
    for n,ans in enumerate(answers,1):
        joined,repl=re.subn(rf'(?<![\dA-Za-z]){n}(?![\dA-Za-z])',ans,joined,count=1)
        if repl!=1:
            print('WARN cloze blank not replaced',year,n)
    joined=normalize(joined)
    for sentence in split_sentences(joined):
        sentence=clean_sentence(sentence)
        # use Reading-like validation now that blanks are filled
        if not valid(sentence,'重建完形'): continue
        wc=len(re.findall(r"[A-Za-z]+(?:[-'][A-Za-z]+)*",sentence))
        all_sent.append({'year':year,'page':a,'source':'完形重建','text':sentence,'word_count':wc})

seen=set();uniq=[]
for x in all_sent:
    key=re.sub(r'[^a-z0-9]+','',x['text'].lower())
    if key in seen:continue
    seen.add(key);uniq.append(x)
for i,x in enumerate(uniq,1):x['id']=f's{i:04d}'

# Build contexts index from complete sentences (exclude writing and incomplete cloze already removed).
context_by_word=defaultdict(list)
for s in uniq:
    if s['source'] in {'写作','完形'}:continue
    for w in set(x.lower() for x in re.findall(r"[A-Za-z]+(?:[-'][A-Za-z]+)*",s['text'])):
        if len(context_by_word[w])<10:context_by_word[w].append({'sentence_id':s['id'],'year':s['year'],'page':s['page'],'text':s['text']})

# Count all English surface forms across cleaned pages to include words appearing in options/questions too.
cnt=Counter();yc=defaultdict(Counter)
for year,page,t in raw_token_pages:
    # strip common direction/question boilerplate fragments before token counts
    z=re.sub(r'Directions:.*?(?=(?:[A-Z][a-z]{2,}\s+[a-z])|$)',' ',t,flags=re.I)
    for w in re.findall(r"[A-Za-z]+(?:[-'][A-Za-z]+)*",z):
        w=w.lower();cnt[w]+=1;yc[w][year]+=1

stop=set('a an the and or but if while although though because as of to in on at for from by with without into onto over under between among around through during before after is am are was were be been being have has had do does did will would can could may might must shall should this that these those it its they them their he him his she her we us our you your i me my who whom whose which what when where why how not no yes than then there here very more most less least much many some any all each every both either neither another other others such own same so too also only just even still yet already once ever never about against across along up down out off again further'.split())
boiler=set('section directions direction answer answers sheet question questions numbered mark choose choosing read reading text paragraph paragraphs part page pages points writing write following'.split())
inv=[]
for w,c in cnt.most_common():
    if w in stop or w in boiler or len(w)<3 or not re.fullmatch(r"[a-z]+(?:[-'][a-z]+)*",w):continue
    inv.append({'surface':w,'count':c,'year_counts':dict(sorted(yc[w].items())),'contexts':context_by_word.get(w,[])})

out=BASE/'v6_final';out.mkdir(exist_ok=True)
(out/'sentences.json').write_text(json.dumps(uniq,ensure_ascii=False,indent=2),encoding='utf8')
(out/'words_surface.json').write_text(json.dumps(inv,ensure_ascii=False,indent=2),encoding='utf8')
report={'sentences':len(uniq),'by_year':dict(Counter(x['year'] for x in uniq)),'by_source':dict(Counter(x['source'] for x in uniq)),'long_15plus':sum(x['word_count']>=15 for x in uniq),'surface_vocab_filtered':len(inv),'tokens':sum(cnt.values()),'sentences_without_terminal':sum(not re.search(r'[.!?]["\']?$',x['text']) for x in uniq)}
(out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(report,ensure_ascii=False,indent=2))
