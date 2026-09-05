#!/usr/bin/env python3
import json, os, time, urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]; WORK=ROOT/'data/work'; CKPT=ROOT/'data/checkpoints'; CKPT.mkdir(parents=True,exist_ok=True)
KEY=os.environ.get('DEEPSEEK_API_KEY','').strip(); MODEL=os.environ.get('DEEPSEEK_BUILD_MODEL','deepseek-v4-flash')
URL='https://api.deepseek.com/chat/completions'
MOCK=os.environ.get('MOCK_DEEPSEEK','')=='1'
if not KEY and not MOCK: raise SystemExit('DEEPSEEK_API_KEY missing')

def load(p): return json.loads(p.read_text(encoding='utf8'))
def save_json(p,obj):
    p.parent.mkdir(parents=True,exist_ok=True); tmp=p.with_suffix(p.suffix+'.tmp'); tmp.write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf8'); tmp.replace(p)

def call_json(system,user,max_tokens=14000,retries=4):
    if MOCK:
        req=json.loads(user.split('INPUT_JSON=',1)[1]); items=[]
        for x in req:
            z={'term':x['term']}
            if 'dict_zh' in x['missing_fields']: z['dict_zh']='测试中文义'
            if 'definition_en' in x['missing_fields']: z['definition_en']='A concise learner-dictionary definition used for structural testing.'
            if 'pos' in x['missing_fields']: z['pos']='word' if x.get('type')!='phrase' else 'phrase'
            z['sense_zh']=z.get('dict_zh') or x.get('dict_zh') or '测试中文义'
            items.append(z)
        return {'items':items}
    payload={'model':MODEL,'thinking':{'type':'disabled'},'messages':[{'role':'system','content':system},{'role':'user','content':user}],
             'response_format':{'type':'json_object'},'temperature':0.05,'max_tokens':max_tokens,'stream':False}
    data=json.dumps(payload,ensure_ascii=False).encode('utf8'); last=None
    for attempt in range(retries):
        try:
            req=urllib.request.Request(URL,data=data,headers={'Content-Type':'application/json','Authorization':'Bearer '+KEY})
            with urllib.request.urlopen(req,timeout=180) as r: obj=json.loads(r.read().decode('utf8'))
            return json.loads(obj['choices'][0]['message']['content'])
        except Exception as e:
            last=e; time.sleep(min(2**attempt,12))
    raise RuntimeError(last)

def valid_field(k,v):
    v=str(v or '').strip()
    if not v:return False
    if k=='dict_zh': return len(v)>=1
    if k=='definition_en': return len(v.split())>=3 and len(v)<=600
    if k=='pos': return len(v)<=40
    return True

def missing_fields(entry,sense):
    out=[]
    for k in ('dict_zh','definition_en','pos'):
        if not valid_field(k,sense.get(k) or entry.get(k)): out.append(k)
    return out

lex=load(WORK/'lexicon.base.json'); senses=load(WORK/'lexicon.senses.json')
byterm={x['term']:x for x in lex}
ckpt_path=CKPT/'dictionary_backfill.json'
backfill={}
if ckpt_path.exists():
    try: backfill=load(ckpt_path); print('resume checkpoint dictionary_backfill.json:',len(backfill),flush=True)
    except Exception: backfill={}
# Drop stale keys from previous lexicon fingerprints.
backfill={k:v for k,v in backfill.items() if k in byterm and isinstance(v,dict)}

# Apply valid checkpoint values before deciding debt.
for term,z in backfill.items():
    s=senses.setdefault(term,{})
    for k in ('dict_zh','definition_en','pos','sense_zh'):
        if valid_field(k,z.get(k)) if k!='sense_zh' else bool(str(z.get(k) or '').strip()): s[k]=str(z[k]).strip()

def debt_terms():
    return [t for t,x in byterm.items() if missing_fields(x,senses.get(t,{}))]

pending=debt_terms()
print(f'dictionary backfill queue: {len(pending)} / 3000 (local complete={3000-len(pending)})',flush=True)
if not pending:
    save_json(WORK/'lexicon.senses.json',senses); print('DICTIONARY BACKFILL: PASS 0 calls needed'); raise SystemExit(0)

system='''你是考研英语词典数据校对员。输入是一组已经由本地 ECDICT/WordNet 尽量填充的真题词条，只补 missing_fields，绝不改写已有可靠字段。\n要求：\n1. dict_zh：简洁、准确、词典式中文核心义，不写长句，不编造语境。\n2. definition_en：简洁、自然、学习词典风格的英文释义，必须解释该词本身，不得写“a word that...”这类空话。\n3. pos：用 noun/verb/adjective/adverb/preposition/conjunction/phrase 等简洁英文。\n4. sense_zh：结合提供的真题 context，在该句中的最合适中文义；若无 context，则等于最常用 dict_zh。\n5. 不得把人名、地名解释成普通词；输入词条已经过专名过滤。\n6. 严格返回 JSON：{"items":[...]}，每个输入 term 恰好返回一次。'''

def make_req(terms):
    req=[]
    for t in terms:
        x=byterm[t]; s=senses.get(t,{})
        ctx=[c.get('text','') for c in x.get('contexts',[])[:2] if c.get('text')]
        req.append({'term':t,'type':x.get('type'),'forms':x.get('forms',[])[:8],
                    'dict_zh':s.get('dict_zh') or x.get('dict_zh',''),'definition_en':s.get('definition_en') or x.get('definition_en',''),
                    'pos':s.get('pos') or x.get('pos',''),'missing_fields':missing_fields(x,s),'context':ctx})
    return req

def accept(terms,obj):
    got={str(z.get('term','')).strip().lower():z for z in (obj.get('items',[]) if isinstance(obj,dict) else []) if isinstance(z,dict)}
    n=0
    for t in terms:
        z=got.get(t.lower())
        if not z: continue
        x=byterm[t]; s=senses.setdefault(t,{})
        before=missing_fields(x,s)
        for k in before:
            if valid_field(k,z.get(k)): s[k]=str(z[k]).strip()
        if str(z.get('sense_zh') or '').strip(): s['sense_zh']=str(z['sense_zh']).strip()
        elif not s.get('sense_zh'): s['sense_zh']=s.get('dict_zh') or x.get('match_zh') or ''
        after=missing_fields(x,s)
        if not after:
            backfill[t]={k:s.get(k,'') for k in ('dict_zh','definition_en','pos','sense_zh')}; n+=1
    save_json(ckpt_path,backfill); save_json(WORK/'lexicon.senses.json',senses)
    return n

def run_pass(terms,batch_size):
    total=len(terms)
    for i in range(0,total,batch_size):
        batch=terms[i:i+batch_size]
        req=make_req(batch)
        user='只补 missing_fields。INPUT_JSON='+json.dumps(req,ensure_ascii=False)
        try:
            obj=call_json(system,user)
            fixed=accept(batch,obj)
            print(f'dictionary backfill batch {min(i+batch_size,total)}/{total}; resolved_now={fixed}; remaining={len(debt_terms())}',flush=True)
        except Exception as e:
            print(f'dictionary backfill batch deferred {i}-{i+len(batch)}: {type(e).__name__}: {e}',flush=True)

# Two bounded batch passes. No 3000-word per-item AI loop.
run_pass(pending,40)
pending=debt_terms()
if pending:
    print('dictionary backfill repair pass:',len(pending),flush=True)
    run_pass(pending,15)
pending=debt_terms()
if pending:
    save_json(WORK/'dictionary_backfill_unresolved.json',[{'term':t,'missing':missing_fields(byterm[t],senses.get(t,{}))} for t in pending])
    raise RuntimeError(f'dictionary backfill unresolved after two batch passes: {len(pending)}; sample={pending[:30]}')

# Merge completed dictionary values into lexicon base and lookup base for downstream context builder/UI.
for x in lex:
    s=senses[x['term']]
    for k in ('dict_zh','definition_en','pos'):
        if s.get(k): x[k]=s[k]
    if not s.get('sense_zh'): s['sense_zh']=x.get('match_zh') or x.get('dict_zh','')
    x['missing_dictionary_fields']=[]
save_json(WORK/'lexicon.base.json',lex); save_json(WORK/'lexicon.senses.json',senses)
# Rebuild lookup map, preserving extra local entries but guaranteeing complete scheduled entries.
base=load(WORK/'dictionary.lookup.base.json') if (WORK/'dictionary.lookup.base.json').exists() else []
dmap={x.get('term'):x for x in base if x.get('term')}
for x in lex:
    dmap[x['term']]={'term':x['term'],'forms':x.get('forms',[]),'phonetic':x.get('phonetic',''),'dict_zh':x.get('dict_zh',''),'definition_en':x.get('definition_en',''),'pos':x.get('pos','')}
save_json(WORK/'dictionary.lookup.base.json',sorted(dmap.values(),key=lambda x:x['term']))
print(f'DICTIONARY BACKFILL: PASS complete=3000; AI-backed items={len(backfill)}')
