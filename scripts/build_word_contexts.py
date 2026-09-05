#!/usr/bin/env python3
import json, os, time, urllib.request, re
from pathlib import Path
from lexicon_rules import example_mentions_entry

ROOT=Path(__file__).resolve().parents[1]
WORK=ROOT/'data/work'; CKPT=ROOT/'data/checkpoints'; CKPT.mkdir(parents=True,exist_ok=True)
KEY=os.environ.get('DEEPSEEK_API_KEY','').strip()
MODEL=os.environ.get('DEEPSEEK_BUILD_MODEL','deepseek-v4-flash')
URL='https://api.deepseek.com/chat/completions'
if not KEY: raise SystemExit('DEEPSEEK_API_KEY missing')

def call_json(system,user,max_tokens=12000,retries=4):
    payload={'model':MODEL,'thinking':{'type':'disabled'},'messages':[{'role':'system','content':system},{'role':'user','content':user}],
             'response_format':{'type':'json_object'},'temperature':0.05,'max_tokens':max_tokens,'stream':False}
    data=json.dumps(payload,ensure_ascii=False).encode('utf8'); last=None
    for attempt in range(retries):
        try:
            req=urllib.request.Request(URL,data=data,headers={'Content-Type':'application/json','Authorization':'Bearer '+KEY})
            with urllib.request.urlopen(req,timeout=150) as r: obj=json.loads(r.read().decode('utf8'))
            return json.loads(obj['choices'][0]['message']['content'])
        except Exception as e:
            last=e; time.sleep(min(2**attempt,12))
    raise RuntimeError(last)

def load_ckpt():
    p=CKPT/'word_contexts.json'
    if not p.exists(): return {}
    try:
        x=json.loads(p.read_text(encoding='utf8')); print('resume checkpoint word_contexts.json:',len(x),flush=True); return x
    except Exception:return {}
def save(x):
    p=CKPT/'word_contexts.json'; tmp=p.with_suffix('.json.tmp'); tmp.write_text(json.dumps(x,ensure_ascii=False,indent=2),encoding='utf8'); tmp.replace(p)

def valid(entry,item):
    return bool(isinstance(item,dict) and str(item.get('example_en') or '').strip() and str(item.get('example_zh') or '').strip() and example_mentions_entry(entry,item.get('example_en','')))

lex=json.loads((WORK/'lexicon.base.json').read_text(encoding='utf8'))
need=[x for x in lex if not x.get('contexts')]
byterm={x['term']:x for x in need}
out=load_ckpt(); out={k:v for k,v in out.items() if k in byterm and valid(byterm[k],v)}; save(out)
print(f'practice context queue: {len(need)}; already valid: {len(out)}',flush=True)

system='''你是考研英语词汇例句编辑。为给定词条生成一句简洁、自然、适合考研阅读语境的英文例句及准确汉译。必须实际使用 allowed_forms 中至少一个形式。不要使用人名地名，不要写元语言解释，不要说“这个单词的意思是”。严格 JSON。'''

def run_pass(terms,batch_size=40):
    for i in range(0,len(terms),batch_size):
        batch=terms[i:i+batch_size]
        req=[]
        for t in batch:
            x=byterm[t]
            req.append({'term':t,'allowed_forms':x.get('forms') or [t],'dict_zh':x.get('dict_zh',''),'definition_en':x.get('definition_en',''),'pos':x.get('pos','')})
        user='返回 {"items":[{"term":"...","example_en":"...","example_zh":"..."}]}。每个输入 term 必须恰好返回一次。输入：\n'+json.dumps(req,ensure_ascii=False)
        try:
            obj=call_json(system,user)
            got={str(z.get('term','')).lower():z for z in obj.get('items',[]) if isinstance(z,dict)}
        except Exception as e:
            print('practice batch failed:',e,flush=True); got={}
        for t in batch:
            z=got.get(t.lower())
            if valid(byterm[t],z): out[t]={'example_en':z['example_en'].strip(),'example_zh':z['example_zh'].strip(),'source':'AI练习例句'}
        save(out)
        print(f'practice contexts {len(out)} / {len(need)}',flush=True)

pending=[x['term'] for x in need if x['term'] not in out]
run_pass(pending,40)
pending=[x['term'] for x in need if x['term'] not in out]
if pending:
    print('practice context repair pass:',len(pending),flush=True)
    run_pass(pending,20)
pending=[x['term'] for x in need if x['term'] not in out]
if pending:
    (WORK/'word_contexts_unresolved.json').write_text(json.dumps(pending,ensure_ascii=False,indent=2),encoding='utf8')
    raise RuntimeError(f'practice context unresolved after two batch passes: {len(pending)}; sample={pending[:20]}')
(WORK/'word_contexts.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf8')
print('WORD PRACTICE CONTEXTS: PASS',len(out))
