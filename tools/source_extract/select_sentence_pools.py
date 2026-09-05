import json,re,math,random
from pathlib import Path
base=Path('/mnt/data/v6_final')
sents=json.loads((base/'sentences.json').read_text(encoding='utf8'))

# Filter obvious remaining garbage
bad_terms=['ANSWER SHEET','Directions','Write your answer','Dear Li Ming','Yours,','pastpapers','懒笔记','Section ','Part ','Question','[A]','[B]','[C]','[D]']
def ok(s):
    t=s['text'].strip(); low=t.lower()
    if any(b.lower() in low for b in bad_terms): return False
    if re.search(r'\b(?:21|22|23|24|25|26|27|28|29|30|31|32|33|34|35|36|37|38|39|40)\.',t): return False
    if s['source'] in ('写作','完形'): return False
    # User-facing sentence pools use complete, substantive sentences only.
    if s['word_count'] < 8: return False
    # Remove exam-question stems and email/writing-prompt fragments that share PDF pages with reading text.
    qstarts=(
      'what can be learned','what did the study','what should an author','which of the following',
      'according to paragraph','in paragraph ','why did ','how does ','what does ','what is the text',
      'what can be inferred','the function of the ','could you please','can you give me','and are they currently'
    )
    if low.startswith(qstarts): return False
    # Multiple lower-case fragments after full stops are usually concatenated A/B/C/D options.
    if len(re.findall(r'\.\s+[a-z]{2,}',t)) >= 2: return False
    # Known PDF artifacts / non-sentential appositive fragment.
    if low.startswith('winston, a professor of artificial intelligence'): return False
    if any(x in low for x in ['年考研','44.43.42.']): return False
    return True
sents=[s for s in sents if ok(s)]

# score for user-facing training quality
def base_score(s):
    y=s['year']; src=s['source']; n=s['word_count']
    score=0
    score += 4 if y>=2023 else 2
    score += {'翻译C':6,'阅读A':5,'阅读B':4,'完形':3}.get(src,0)
    # ideal 15-42 words, penalize extremes
    if 15<=n<=42: score+=4
    elif 10<=n<=50: score+=2
    else: score-=3
    # complex-clause hints
    t=' '+s['text'].lower()+' '
    markers=[' which ',' that ',' although ',' while ',' because ',' if ',' when ',' where ',' who ',' whose ',' despite ',' as ',' but ',' however ',' therefore ',' unless ',' whether ',' not only ',' rather than ',' in order to ']
    score += min(5,sum(t.count(m) for m in markers))
    # punctuation complexity
    score += min(2,t.count(',')*0.3)
    return score

# choose specific pools sequentially with different length/difficulty targets.
remaining={s['id']:s for s in sents}

def choose(n, target_len, complex_weight=0, prefer_recent=True):
    arr=[]
    for s in remaining.values():
        score=base_score(s)
        score -= abs(s['word_count']-target_len)*0.12
        if complex_weight:
            t=s['text'].lower()
            c=sum(t.count(m) for m in [' which ',' that ',' although ',' while ',' because ',' if ',' when ',' where ',' who ',' despite ',' unless ',' whether ',' as '])
            score += complex_weight*c
        # slight deterministic jitter for diversity
        score += (sum(map(ord,s['id']))%13)/100
        arr.append((score,s))
    arr.sort(key=lambda x:(-x[0],-x[1]['year'],x[1]['id']))
    picked=[]
    # cap per exact source/year to maintain diversity: greedily allow max 55 per year for 200 pools, 35 per year for 100 pools
    yearcap=55 if n>=200 else 35
    yc={}
    for _,s in arr:
        if yc.get(s['year'],0)>=yearcap: continue
        picked.append(s); yc[s['year']]=yc.get(s['year'],0)+1
        if len(picked)==n:break
    if len(picked)<n:
        for _,s in arr:
            if s in picked:continue
            picked.append(s)
            if len(picked)==n:break
    for s in picked:remaining.pop(s['id'],None)
    return picked

# More complex/long sentences reserved first for analysis and free translation
analysis=choose(100,32,complex_weight=1.5)
free_translation=choose(100,30,complex_weight=1.0)
en_to_zh=choose(200,24,complex_weight=.5)
zh_to_en=choose(200,21,complex_weight=.3)

# assign analysis stages by complexity/length, 30 precise, 30 coarse, 40 main-stem
def complexity(s):
    t=' '+s['text'].lower()+' '
    m=sum(t.count(x) for x in [' which ',' that ',' although ',' while ',' because ',' if ',' when ',' where ',' who ',' whose ',' despite ',' unless ',' whether ',' as ',';','—'])
    return s['word_count']+5*m
analysis_sorted=sorted(analysis,key=complexity,reverse=True)
for i,s in enumerate(analysis_sorted):
    s['stage']='precise' if i<30 else ('coarse' if i<60 else 'main_stem')

pools={'en_to_zh':en_to_zh,'zh_to_en':zh_to_en,'free_translation':free_translation,'analysis':analysis_sorted}
# final invariant checks
ids=[]
for k,v in pools.items():
    assert len(v)=={'en_to_zh':200,'zh_to_en':200,'free_translation':100,'analysis':100}[k]
    ids += [x['id'] for x in v]
assert len(ids)==len(set(ids))==600

# Day allocation: 2 per day for 200 pools; free/analysis alternate days and 2 each active day.
days=[]
for d in range(1,101):
    rec={'day':d,'en_to_zh':[en_to_zh[2*(d-1)+i]['id'] for i in range(2)],'zh_to_en':[zh_to_en[2*(d-1)+i]['id'] for i in range(2)]}
    if d%2==1:
        idx=(d-1)//2*2; rec['focus']='translation'; rec['focus_ids']=[free_translation[idx]['id'],free_translation[idx+1]['id']]
    else:
        idx=(d//2-1)*2; rec['focus']='analysis'; rec['focus_ids']=[analysis_sorted[idx]['id'],analysis_sorted[idx+1]['id']]
    days.append(rec)

(base/'sentence_pools.json').write_text(json.dumps(pools,ensure_ascii=False,indent=2),encoding='utf8')
(base/'days_sentences.json').write_text(json.dumps(days,ensure_ascii=False,indent=2),encoding='utf8')

from collections import Counter
report={k:{'count':len(v),'years':dict(sorted(Counter(x['year'] for x in v).items())),'avg_words':round(sum(x['word_count'] for x in v)/len(v),1)} for k,v in pools.items()}
report['analysis_stages']=dict(Counter(x['stage'] for x in analysis_sorted))
report['unique_total']=len(set(ids))
(base/'pool_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(report,ensure_ascii=False,indent=2))
