#!/usr/bin/env python3
import json, os, re, time, urllib.request, urllib.error
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'data/source'; OUT=ROOT/'data/generated'; OUT.mkdir(exist_ok=True)
KEY=os.environ.get('DEEPSEEK_API_KEY','').strip()
if not KEY: raise SystemExit('DEEPSEEK_API_KEY is missing. Add it as a GitHub Actions secret; never put it in repository files.')
MODEL=os.environ.get('DEEPSEEK_BUILD_MODEL','deepseek-v4-flash')
URL='https://api.deepseek.com/chat/completions'

def call_json(system,user,max_tokens=8000,retries=5):
    payload={
      'model':MODEL,
      'thinking':{'type':'disabled'},
      'messages':[{'role':'system','content':system},{'role':'user','content':user}],
      'response_format':{'type':'json_object'},
      'temperature':0.1,
      'max_tokens':max_tokens,
      'stream':False,
    }
    data=json.dumps(payload,ensure_ascii=False).encode('utf8')
    last=None
    for attempt in range(retries):
        try:
            req=urllib.request.Request(URL,data=data,headers={'Content-Type':'application/json','Authorization':'Bearer '+KEY})
            with urllib.request.urlopen(req,timeout=120) as r:
                obj=json.loads(r.read().decode('utf8'))
            content=obj['choices'][0]['message']['content']
            if not content.strip(): raise ValueError('empty JSON content')
            return json.loads(content)
        except Exception as e:
            last=e; time.sleep(min(2**attempt,12))
    raise RuntimeError(f'DeepSeek failed after retries: {last}')

def batches(seq,n):
    for i in range(0,len(seq),n):yield seq[i:i+n]

def tokenize(s):
    # Frontend uses same regex; punctuation separate tokens.
    return re.findall(r"[A-Za-z]+(?:[-'][A-Za-z]+)*|\d+(?:\.\d+)?|[^\w\s]",s)

# ---------- 600 sentence translations + chunk exercises ----------
pools=json.loads((SRC/'sentence_pools.json').read_text(encoding='utf8'))
all_s=[]
for pool,arr in pools.items():
    for s in arr:
        x=dict(s); x['pool']=pool; all_s.append(x)
assert len(all_s)==600 and len({x['id'] for x in all_s})==600

sent_out={}
system='''你是考研英语一真题教学数据编辑。只处理用户给出的原句，不改写原句，不杜撰真题。输出严格 JSON。中文翻译要求准确、自然、保留逻辑关系；拼句块按语义切分，既不能细到单词堆，也不能整句只切两块。干扰块必须语法上像真答案但语义不合，且不能与正确块重复。'''
for batch in batches(all_s,10):
    payload=[{'id':x['id'],'pool':x['pool'],'year':x['year'],'text':x['text']} for x in batch]
    user='''请为下列句子生成训练数据。返回 JSON：{"items":[{"id":"...","zh":"完整准确汉译","en_chunks":["按原句顺序的英文语义块"],"zh_chunks":["按译文顺序的中文意群块"],"en_distractors":["2个英文干扰块"],"zh_distractors":["2个中文干扰块"],"key_points":["2-4个翻译关键点"]}]}。\n要求 en_chunks 连起来必须覆盖原句主要文字且保持原句顺序；不要加入原句不存在的正确块。JSON 数据如下：\n'''+json.dumps(payload,ensure_ascii=False)
    obj=call_json(system,user,12000)
    got={i['id']:i for i in obj.get('items',[]) if isinstance(i,dict) and i.get('id')}
    for x in batch:
        i=got.get(x['id'])
        if not i or not i.get('zh') or len(i.get('en_chunks',[]))<2 or len(i.get('zh_chunks',[]))<2:
            raise RuntimeError(f'invalid sentence enrichment: {x["id"]}')
        i.update({'year':x['year'],'page':x['page'],'source':x['source'],'en':x['text'],'pool':x['pool'],'word_count':x['word_count']})
        sent_out[x['id']]=i
    print('sentences',len(sent_out),'/',len(all_s),flush=True)

# ---------- translate every remaining corpus sentence for review explanations ----------
corpus_all=json.loads((SRC/'corpus_sentences.json').read_text(encoding='utf8'))
# Review explanations use only complete study text. Original blanked cloze snippets and writing prompts are deliberately excluded.
corpus=[x for x in corpus_all if x.get('source') not in ('完形','写作')]
context_zh={k:v['zh'] for k,v in sent_out.items()}
remaining_corpus=[x for x in corpus if x['id'] not in context_zh]
system_ctx='''你是考研英语一真题译文编辑。只翻译给定英文原句，不增加信息。中文准确、自然、逻辑关系清楚。只返回严格 JSON。'''
for batch in batches(remaining_corpus,18):
    payload=[{'id':x['id'],'text':x['text']} for x in batch]
    user='返回 JSON：{"items":[{"id":"...","zh":"完整准确汉译"}]}。输入：\n'+json.dumps(payload,ensure_ascii=False)
    obj=call_json(system_ctx,user,10000)
    got={i['id']:i.get('zh','').strip() for i in obj.get('items',[]) if isinstance(i,dict) and i.get('id')}
    for x in batch:
        zh=got.get(x['id'],'')
        if not zh: raise RuntimeError(f'missing corpus translation {x["id"]}')
        context_zh[x['id']]=zh
    print('corpus translations',len(context_zh),'/',len(corpus),flush=True)

# ---------- 100 analysis items with stage-specific structure ----------
analysis=pools['analysis']
analysis_out={}
system2='''你是严格的英语句法教师。只分析给定真题原句。必须使用用户提供的 token 列表及其 0 起始索引，不得改词、增词或漏掉关键主干。输出严格 JSON。主句、从句、非谓语、插入语等标签用中文。分析目标是从前期精细拆分逐步训练到后期只抓主干。'''
for batch in batches(analysis,4):
    req=[]
    for x in batch:
        toks=tokenize(x['text'])
        req.append({'id':x['id'],'stage':x['stage'],'sentence':x['text'],'tokens':[{'i':i,'t':t} for i,t in enumerate(toks)]})
    user='''按 stage 生成数据：
precise：groups 数组，每组 {label, token_indices, note}，所有 token 必须恰好有一个 primary group；另给 main_stem_indices、abridged_en、zh、main_stem_zh、logic。
coarse：segments 数组，每段 {label, token_indices, removable_first_pass:boolean, note}；另给 main_stem_indices、abridged_en、zh、main_stem_zh、logic。
main_stem：只给 main_stem_indices、abridged_en、zh、main_stem_zh、discard_notes（说明哪些修饰可先括掉）、logic。
返回 {"items":[...]}。不要把标点当作必须主干，main_stem_indices 只选最必要的主谓宾/主系表及不可缺少成分。输入：\n'''+json.dumps(req,ensure_ascii=False)
    obj=call_json(system2,user,14000)
    got={i['id']:i for i in obj.get('items',[]) if isinstance(i,dict) and i.get('id')}
    for x in batch:
        i=got.get(x['id']); toks=tokenize(x['text']); n=len(toks)
        if not i or not i.get('zh') or not i.get('main_stem_indices'):
            raise RuntimeError(f'invalid analysis {x["id"]}')
        inds=i['main_stem_indices']
        if any((not isinstance(k,int) or k<0 or k>=n) for k in inds):raise RuntimeError(f'bad indices {x["id"]}')
        if x['stage']=='precise':
            groups=i.get('groups',[]); assigned=[]
            for g in groups:assigned += g.get('token_indices',[])
            # Require coverage of all lexical tokens, allowing punctuation unassigned.
            lexical={j for j,t in enumerate(toks) if re.search(r'[A-Za-z0-9]',t)}
            if not lexical.issubset(set(assigned)):raise RuntimeError(f'precise lexical coverage failed {x["id"]}')
        if x['stage']=='coarse' and len(i.get('segments',[]))<2:raise RuntimeError(f'coarse segments failed {x["id"]}')
        i.update({'id':x['id'],'stage':x['stage'],'en':x['text'],'tokens':toks,'year':x['year'],'page':x['page']})
        analysis_out[x['id']]=i
    print('analysis',len(analysis_out),'/',len(analysis),flush=True)

# ---------- 3000 context-specific word senses ----------
lexpath=OUT/'lexicon.base.json'
if not lexpath.exists():raise SystemExit('Run build_lexicon.py before build_ai_content.py')
lex=json.loads(lexpath.read_text(encoding='utf8'))
scheduled=[x for x in lex if x.get('scheduled')]
assert len(scheduled)==3000
lex_out={}
system3='''你是考研英语词典编辑。根据词典释义和真题语境，选择“这个词在给定真题语境中的最准确、最短中文义”。不要发明词义。若是词组，按整体义处理。输出严格 JSON。sense_zh 通常 2-12 个汉字，可有分号但不要堆全部词典义。'''
for batch in batches(scheduled,40):
    req=[]
    for x in batch:
        ctx=x['contexts'][0]['text'] if x.get('contexts') else ''
        req.append({'term':x['term'],'type':x['type'],'dict_zh':x.get('dict_zh',''),'definition_en':x.get('definition_en',''),'context':ctx})
    user='返回 {"items":[{"term":"...","sense_zh":"本句准确义"}]}。输入：\n'+json.dumps(req,ensure_ascii=False)
    obj=call_json(system3,user,9000)
    got={i['term'].lower():i for i in obj.get('items',[]) if isinstance(i,dict) and i.get('term')}
    for x in batch:
        g=got.get(x['term'].lower())
        sense=(g or {}).get('sense_zh','').strip()
        if not sense:sense=x['dict_zh']
        if not sense:raise RuntimeError('missing sense '+x['term'])
        lex_out[x['term']]={'sense_zh':sense}
    print('lexicon senses',len(lex_out),'/',len(scheduled),flush=True)

(OUT/'sentences.enriched.json').write_text(json.dumps(sent_out,ensure_ascii=False,indent=2),encoding='utf8')
(OUT/'corpus.translations.json').write_text(json.dumps(context_zh,ensure_ascii=False,indent=2),encoding='utf8')
(OUT/'analysis.enriched.json').write_text(json.dumps(analysis_out,ensure_ascii=False,indent=2),encoding='utf8')
(OUT/'lexicon.senses.json').write_text(json.dumps(lex_out,ensure_ascii=False,indent=2),encoding='utf8')
print('AI enrichment complete')
