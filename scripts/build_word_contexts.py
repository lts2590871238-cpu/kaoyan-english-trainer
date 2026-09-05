#!/usr/bin/env python3
import json, os, time, urllib.request
from pathlib import Path
from lexicon_rules import example_mentions_entry

ROOT=Path(__file__).resolve().parents[1]
WORK=ROOT/'data/work'; CKPT=ROOT/'data/checkpoints'; CKPT.mkdir(parents=True,exist_ok=True)
KEY=os.environ.get('DEEPSEEK_API_KEY','').strip()
MODEL=os.environ.get('DEEPSEEK_BUILD_MODEL','deepseek-v4-flash')
URL='https://api.deepseek.com/chat/completions'
MOCK=os.environ.get('MOCK_DEEPSEEK','')=='1'
WORDNET=Path(os.environ.get('WORDNET_DEFS', str(ROOT/'cache/wordnet_defs.json')))
wordnet=json.loads(WORDNET.read_text(encoding='utf8')) if WORDNET.exists() else {}
if not KEY and not MOCK:
    raise SystemExit('DEEPSEEK_API_KEY missing')

def load(p): return json.loads(p.read_text(encoding='utf8'))
def save_json(p,obj):
    p.parent.mkdir(parents=True,exist_ok=True)
    tmp=p.with_suffix(p.suffix+'.tmp')
    tmp.write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf8')
    tmp.replace(p)

def call_json(system,user,max_tokens=12000,retries=4):
    if MOCK:
        # Deterministic mock: generate a valid lexical sentence for every request.
        # This is used only for pipeline tests, never published as learning content.
        if 'INPUT_JSON=' in user:
            req=json.loads(user.split('INPUT_JSON=',1)[1])
        else:
            start=user.find('['); req=json.loads(user[start:])
        items=[]
        drop_batch={x.strip().lower() for x in os.environ.get('MOCK_DROP_BATCH_TERMS','').split(',') if x.strip()}
        drop_always={x.strip().lower() for x in os.environ.get('MOCK_DROP_ALWAYS_TERMS','').split(',') if x.strip()}
        for x in req:
            term=x['term']; forms=x.get('allowed_forms') or [term]
            if term.lower() in drop_always or (len(req)>1 and term.lower() in drop_batch):
                continue
            form=forms[0] if forms else term
            items.append({'term':term,'example_en':f'The passage uses {form} in a clear academic context.',
                          'example_zh':f'这句话在清晰的学术语境中使用了“{term}”。'})
        return {'items':items}
    payload={'model':MODEL,'thinking':{'type':'disabled'},
             'messages':[{'role':'system','content':system},{'role':'user','content':user}],
             'response_format':{'type':'json_object'},'temperature':0.05,'max_tokens':max_tokens,'stream':False}
    data=json.dumps(payload,ensure_ascii=False).encode('utf8'); last=None
    for attempt in range(retries):
        try:
            req=urllib.request.Request(URL,data=data,headers={'Content-Type':'application/json','Authorization':'Bearer '+KEY})
            with urllib.request.urlopen(req,timeout=180) as r:
                obj=json.loads(r.read().decode('utf8'))
            return json.loads(obj['choices'][0]['message']['content'])
        except Exception as e:
            last=e; time.sleep(min(2**attempt,12))
    raise RuntimeError(last)

def load_ckpt():
    p=CKPT/'word_contexts.json'
    if not p.exists(): return {}
    try:
        x=load(p); print('resume checkpoint word_contexts.json:',len(x),flush=True); return x
    except Exception:
        return {}

def valid(entry,item):
    return bool(isinstance(item,dict)
                and str(item.get('example_en') or '').strip()
                and str(item.get('example_zh') or '').strip()
                and example_mentions_entry(entry,item.get('example_en','')))

def allowed_forms(entry):
    forms=[]
    for f in (entry.get('forms') or [])+[entry.get('term')]:
        f=str(f or '').strip()
        if f and f not in forms: forms.append(f)
    return forms[:12]

def safe_fallback(entry):
    """Never let one flaky AI reply kill a multi-thousand-item build.

    This is deliberately marked as a dictionary fallback rather than a true-paper
    sentence or AI-created exam-style example.  It is used only after bounded
    batch + individual repair attempts fail.  The sentence is semantically honest
    because it quotes the dictionary definition rather than inventing usage.
    """
    term=entry['term']
    de=str(entry.get('definition_en') or '').strip().rstrip('.')
    zh=str(entry.get('dict_zh') or entry.get('match_zh') or '').strip()
    if not de or not zh:
        return None
    en=f'In this vocabulary note, "{term}" means {de[0].lower()+de[1:] if len(de)>1 else de}.'
    cn=f'在这条词汇注释中，“{term}”的词典义为：{zh}。'
    item={'example_en':en,'example_zh':cn,'source':'词典兜底例句'}
    return item if valid(entry,item) else None

lex=load(WORK/'lexicon.base.json')
need=[x for x in lex if not x.get('contexts')]
byterm={x['term']:x for x in need}
out=load_ckpt()
out={k:v for k,v in out.items() if k in byterm and valid(byterm[k],v)}
save_json(CKPT/'word_contexts.json',out)
print(f'practice context queue: {len(need)}; already valid: {len(out)}',flush=True)

system='''你是考研英语词汇例句编辑。为给定词条生成一句简洁、自然、适合考研阅读语境的英文例句及准确汉译。必须实际使用 allowed_forms 中至少一个形式。不要写元语言解释。不要把普通词改造成专有名词。严格 JSON。'''

def make_req(terms):
    req=[]
    for t in terms:
        x=byterm[t]
        req.append({'term':t,'allowed_forms':allowed_forms(x),'dict_zh':x.get('dict_zh',''),
                    'definition_en':x.get('definition_en',''),'pos':x.get('pos','')})
    return req

def accept(terms,obj,source='AI练习例句'):
    got={str(z.get('term','')).strip().lower():z for z in (obj.get('items',[]) if isinstance(obj,dict) else []) if isinstance(z,dict)}
    fixed=0
    for t in terms:
        z=got.get(t.lower())
        if valid(byterm[t],z):
            out[t]={'example_en':str(z['example_en']).strip(),'example_zh':str(z['example_zh']).strip(),'source':source}
            fixed+=1
    save_json(CKPT/'word_contexts.json',out)
    return fixed

def run_batch_pass(terms,batch_size):
    total=len(terms)
    for i in range(0,total,batch_size):
        batch=terms[i:i+batch_size]
        req=make_req(batch)
        user='返回 {"items":[{"term":"...","example_en":"...","example_zh":"..."}]}。每个输入 term 必须恰好返回一次。INPUT_JSON='+json.dumps(req,ensure_ascii=False)
        try:
            obj=call_json(system,user,max_tokens=14000,retries=4)
            fixed=accept(batch,obj)
        except Exception as e:
            fixed=0; print('practice batch deferred:',type(e).__name__,e,flush=True)
        print(f'practice contexts {len(out)} / {len(need)}; batch_fixed={fixed}',flush=True)

def repair_single(term):
    x=byterm[term]
    req=make_req([term])
    sys='''你正在修复一个词汇例句。只能返回一个 JSON 对象：{"items":[{"term":"...","example_en":"...","example_zh":"..."}]}。英文例句必须自然，并且逐字包含 allowed_forms 中至少一个形式；中文必须准确翻译该英文句子。不要省略该词条。'''
    user='INPUT_JSON='+json.dumps(req,ensure_ascii=False)
    last=None
    for k in range(6):
        try:
            obj=call_json(sys,user,max_tokens=1800,retries=2)
            if accept([term],obj):
                print('practice context individually repaired:',term,flush=True)
                return True
            last='invalid lexical form/output'
        except Exception as e:
            last=e
        time.sleep(min(k+1,5))
    print('practice context individual repair exhausted:',term,last,flush=True)
    return False

pending=[x['term'] for x in need if x['term'] not in out]
run_batch_pass(pending,40)
pending=[x['term'] for x in need if x['term'] not in out]
if pending:
    print('practice context smaller-batch repair:',len(pending),flush=True)
    run_batch_pass(pending,12)
pending=[x['term'] for x in need if x['term'] not in out]
if pending:
    print('practice context individual repair:',len(pending),flush=True)
    for t in list(pending):
        repair_single(t)

pending=[x['term'] for x in need if x['term'] not in out]
fallback=[]
for t in list(pending):
    z=safe_fallback(byterm[t])
    if z:
        out[t]=z; fallback.append(t)
save_json(CKPT/'word_contexts.json',out)
pending=[x['term'] for x in need if x['term'] not in out]
report={'requested':len(need),'resolved':len(out),'dictionary_fallback_count':len(fallback),'dictionary_fallback_terms':fallback,'unresolved':pending}
save_json(WORK/'word_contexts_report.json',report)
if pending:
    save_json(WORK/'word_contexts_unresolved.json',pending)
    raise RuntimeError(f'practice context unresolved after batch, individual and deterministic fallback: {len(pending)}; sample={pending[:30]}')
save_json(WORK/'word_contexts.json',out)
print('WORD PRACTICE CONTEXTS: PASS',len(out),f'fallback={len(fallback)}')
