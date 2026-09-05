#!/usr/bin/env python3
import json, os, re, time, urllib.request, shutil
from pathlib import Path
from collections import Counter
from lexicon_rules import allowed_forms, example_mentions_entry, merge_lexicon_ai, lexicon_output_issues

ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'data/source'
WORK=ROOT/'data/work'; WORK.mkdir(parents=True,exist_ok=True)
CKPT=ROOT/'data/checkpoints'; CKPT.mkdir(parents=True,exist_ok=True)
LEGACY=ROOT/'data/generated/checkpoints'
if LEGACY.exists():
    for _p in LEGACY.glob('*.json'):
        _dst=CKPT/_p.name
        if not _dst.exists(): shutil.copy2(_p,_dst)
KEY=os.environ.get('DEEPSEEK_API_KEY','').strip()
if not KEY:
    raise SystemExit('DEEPSEEK_API_KEY is missing. Add it as a GitHub Actions secret; never put it in repository files.')
MODEL=os.environ.get('DEEPSEEK_BUILD_MODEL','deepseek-v4-flash')
URL='https://api.deepseek.com/chat/completions'


def call_json(system,user,max_tokens=8000,retries=6):
    payload={
      'model':MODEL,
      'thinking':{'type':'disabled'},
      'messages':[{'role':'system','content':system},{'role':'user','content':user}],
      'response_format':{'type':'json_object'},
      'temperature':0.05,
      'max_tokens':max_tokens,
      'stream':False,
    }
    data=json.dumps(payload,ensure_ascii=False).encode('utf8')
    last=None
    for attempt in range(retries):
        try:
            req=urllib.request.Request(URL,data=data,headers={
                'Content-Type':'application/json',
                'Authorization':'Bearer '+KEY
            })
            with urllib.request.urlopen(req,timeout=150) as r:
                obj=json.loads(r.read().decode('utf8'))
            content=obj['choices'][0]['message']['content']
            if not content.strip():
                raise ValueError('empty JSON content')
            return json.loads(content)
        except Exception as e:
            last=e
            time.sleep(min(2**attempt,20))
    raise RuntimeError(f'DeepSeek failed after retries: {last}')


def batches(seq,n):
    for i in range(0,len(seq),n):
        yield seq[i:i+n]


def tokenize(s):
    return re.findall(r"[A-Za-z]+(?:[-'][A-Za-z]+)*|\d+(?:\.\d+)?|[^\w\s]",s)


def load_ckpt(name,default):
    p=CKPT/name
    if not p.exists():
        return default
    try:
        x=json.loads(p.read_text(encoding='utf8'))
        print(f'resume checkpoint {name}: {len(x) if hasattr(x,"__len__") else "ok"}',flush=True)
        return x
    except Exception:
        return default


def save_ckpt(name,obj):
    p=CKPT/name
    tmp=p.with_suffix(p.suffix+'.tmp')
    tmp.write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf8')
    tmp.replace(p)


def validate_main_indices(item,toks,item_id):
    inds=item.get('main_stem_indices') or []
    n=len(toks)
    if not inds:
        return False,'missing main_stem_indices'
    if any((not isinstance(k,int) or k<0 or k>=n) for k in inds):
        return False,'bad main_stem_indices'
    return True,''


def normalize_group_indices(groups,n):
    clean=[]
    for g in groups if isinstance(groups,list) else []:
        if not isinstance(g,dict):
            continue
        inds=[]
        for k in g.get('token_indices',[]):
            if isinstance(k,int) and 0<=k<n and k not in inds:
                inds.append(k)
        clean.append({
            'label':str(g.get('label') or '其他成分').strip(),
            'token_indices':inds,
            'note':str(g.get('note') or '').strip()
        })
    return clean


def precise_coverage(item,toks):
    groups=normalize_group_indices(item.get('groups',[]),len(toks))
    item['groups']=groups
    lexical={j for j,t in enumerate(toks) if re.search(r'[A-Za-z0-9]',t)}
    counts=Counter()
    for g in groups:
        for j in g['token_indices']:
            if j in lexical:
                counts[j]+=1
    missing=sorted(lexical-set(counts))
    duplicates=sorted(j for j,c in counts.items() if c>1)
    return missing,duplicates


def dedupe_primary_groups(item,toks):
    """Keep the first primary assignment when the model duplicated a token across groups."""
    seen=set()
    for g in item.get('groups',[]):
        keep=[]
        for j in g.get('token_indices',[]):
            if j in seen:
                continue
            keep.append(j)
            if re.search(r'[A-Za-z0-9]',toks[j]):
                seen.add(j)
        g['token_indices']=keep


def repair_precise_item(x,item,toks,missing,duplicates):
    system='''你是严格的考研英语句法数据校对员。你不是重新自由分析，而是在修复已有逐词句法标注。必须遵守给定 token 索引。每个含英文字母或数字的 lexical token 必须且只能属于一个 primary group。标点可以不分组。不要改动原句、token、id。输出严格 JSON。'''
    payload={
      'id':x['id'],'sentence':x['text'],
      'tokens':[{'i':i,'t':t} for i,t in enumerate(toks)],
      'current':item,'missing_indices':missing,'duplicated_indices':duplicates
    }
    user='''修复 current，并返回完整单项 JSON：{"id":"...","groups":[{"label":"中文结构标签","token_indices":[...],"note":"简短说明"}],"main_stem_indices":[...],"abridged_en":"...","zh":"...","main_stem_zh":"...","logic":"..."}。
硬要求：
1. 每一个 lexical token 索引必须在 groups 中恰好出现一次；
2. 不要为了嵌套关系重复同一 token，嵌套关系写进 note；
3. groups 要有教学意义，如主句、让步状语从句、定语从句、非谓语结构、插入语/介词修饰等；
4. main_stem_indices 只保留真正不可删的主谓宾/主系表及必要成分；
5. missing_indices 必须全部归位，duplicated_indices 必须消除重复。
输入：\n'''+json.dumps(payload,ensure_ascii=False)
    return call_json(system,user,9000)


def targeted_fill_missing(x,item,toks,missing):
    """Last constrained AI repair: assign only omitted tokens to one of the existing labels."""
    labels=[g.get('label','').strip() for g in item.get('groups',[]) if g.get('label','').strip()]
    if not labels:
        return item
    system='''你是英语句法标注修复器。只能从 allowed_labels 中选择标签。每个 missing token 必须恰好返回一次。输出严格 JSON，不解释。'''
    payload={
      'sentence':x['text'],
      'allowed_labels':labels,
      'missing':[{'i':i,'t':t} for i,t in enumerate(toks) if i in missing]
    }
    user='返回 {"assignments":[{"i":整数,"label":"allowed_labels中的一个原样标签"}]}。输入：\n'+json.dumps(payload,ensure_ascii=False)
    obj=call_json(system,user,3000)
    amap={a.get('i'):a.get('label') for a in obj.get('assignments',[]) if isinstance(a,dict)}
    label_map={g['label']:g for g in item['groups']}
    for i in missing:
        label=amap.get(i)
        if label in label_map:
            label_map[label]['token_indices'].append(i)
    return item



def sentence_item_valid(i):
    if not isinstance(i,dict):
        return False
    if not str(i.get('zh') or '').strip():
        return False
    en_chunks=i.get('en_chunks')
    zh_chunks=i.get('zh_chunks')
    if not isinstance(en_chunks,list) or len([x for x in en_chunks if str(x).strip()])<2:
        return False
    if not isinstance(zh_chunks,list) or len([x for x in zh_chunks if str(x).strip()])<2:
        return False
    return True


def enrich_sentence_single(x,retries=4):
    system='''你是考研英语一真题教学数据编辑。只处理这一句用户给出的真题原句，不改写原句，不杜撰内容。中文翻译必须准确、自然、保留原句逻辑。英文拼句块必须来自原句，按原句顺序切分；中文意群块必须完整覆盖译文。输出严格 JSON。'''
    base={"id":x['id'],"pool":x['pool'],"year":x['year'],"text":x['text']}
    last=None
    for attempt in range(retries):
        user='''为这一句生成训练数据，只返回单项 JSON：{"id":"...","zh":"完整准确汉译","en_chunks":["..."],"zh_chunks":["..."],"en_distractors":["...","..."],"zh_distractors":["...","..."],"key_points":["..."]}。
硬要求：
1. en_chunks 至少 2 块，且每块都必须是原句中连续出现的文字，顺序保持不变；
2. zh_chunks 至少 2 块，按译文顺序覆盖完整含义；
3. 不得省略 zh、en_chunks、zh_chunks；
4. 干扰块各 2 个，语法上像但语义不合；
5. 如果句子有倒装、插入、从句，翻译要恢复正常中文语序但不能丢逻辑。
输入：\n'''+json.dumps(base,ensure_ascii=False)
        try:
            i=call_json(system,user,6000)
            if i.get('id')!=x['id']:
                i['id']=x['id']
            if sentence_item_valid(i):
                return i
            last='schema incomplete'
        except Exception as e:
            last=e
        time.sleep(min(1+attempt,4))
    raise RuntimeError(f'invalid sentence enrichment after individual repair: {x["id"]}: {last}')


def translate_context_single(x,retries=4):
    system='''你是考研英语一真题译文编辑。只翻译这一句给定英文原句，不增加信息。中文准确、自然、逻辑关系清楚。只返回严格 JSON。'''
    for attempt in range(retries):
        try:
            obj=call_json(system,'返回 {"id":"'+x['id']+'","zh":"完整准确汉译"}。原句：\n'+x['text'],3500)
            zh=str(obj.get('zh') or '').strip()
            if zh:
                return zh
        except Exception:
            pass
        time.sleep(min(1+attempt,4))
    raise RuntimeError(f'missing corpus translation after individual repair {x["id"]}')


def generate_nonprecise_single(x,retries=4):
    toks=tokenize(x['text'])
    system='''你是严格的英语句法教师。只分析这一句给定考研英语真题。必须使用给定 token 的 0 起始索引，不得改词或增词。输出严格 JSON。目标是训练从粗略层级识别到只抓主干。'''
    req={'id':x['id'],'stage':x['stage'],'sentence':x['text'],'tokens':[{'i':i,'t':t} for i,t in enumerate(toks)]}
    for attempt in range(retries):
        if x['stage']=='coarse':
            task='''返回 {"id":"...","segments":[{"label":"中文结构标签","token_indices":[...],"removable_first_pass":true,"note":"..."}],"main_stem_indices":[...],"abridged_en":"...","zh":"完整汉译","main_stem_zh":"...","logic":"..."}。segments 至少 2 段。main_stem_indices 只保留不可删主干。'''
        else:
            task='''返回 {"id":"...","main_stem_indices":[...],"abridged_en":"...","zh":"完整汉译","main_stem_zh":"...","discard_notes":["..."],"logic":"..."}。main_stem_indices 只保留不可删主谓宾/主系表及必要成分。'''
        try:
            i=call_json(system,task+'\n输入：\n'+json.dumps(req,ensure_ascii=False),7000)
            i['id']=x['id']
            ok,_=validate_main_indices(i,toks,x['id'])
            if i.get('zh') and ok and (x['stage']!='coarse' or len(i.get('segments',[]))>=2):
                return i,toks
        except Exception:
            pass
        time.sleep(min(1+attempt,4))
    raise RuntimeError(f'invalid analysis after individual repair {x["id"]}')


def enrich_lexicon_single(x,retries=6):
    # Repair one lexicon item without making DeepSeek the dictionary of record.
    # Local dictionary fields survive every AI reply. AI supplies contextual sense and,
    # for option-only vocabulary, a practice example. Inflected forms are accepted.
    ctx=x['contexts'][0]['text'] if x.get('contexts') else ''
    forms=sorted(allowed_forms(x))
    system='''你是考研英语词汇语境校对员。词条已通过上游审计。不要判断 valid/invalid，不要改词条身份。可靠词典字段以输入为准；你主要负责给出本句最准确的短中文义。若 needs_context_fill=true，再生成一个自然、简短、语法正确的学习例句，例句必须实际使用 allowed_forms 中至少一个词形。输出严格 JSON。'''
    req={'term':x['term'],'type':x['type'],'forms':x.get('forms',[]),'allowed_forms':forms,'dict_zh':x.get('dict_zh',''),'definition_en':x.get('definition_en',''),'pos':x.get('pos',''),'context':ctx,'dictionary_source':x.get('dictionary_source',''),'needs_context_fill':bool(x.get('needs_context_fill'))}
    last=[]
    for attempt in range(retries):
        try:
            g=call_json(system,'返回 {"term":"...","sense_zh":"本句准确短义","dict_zh":"仅输入缺失时补充，否则可留空","definition_en":"仅输入缺失时补充，否则可留空","pos":"仅输入缺失时补充，否则可留空","example_en":"仅 needs_context_fill=true 时生成，必须使用 allowed_forms 中至少一个词形","example_zh":"对应汉译"}。输入：\n'+json.dumps(req,ensure_ascii=False),4200)
            out=merge_lexicon_ai(x,g)
            issues=lexicon_output_issues(x,out)
            if not issues:
                return out
            last=issues
            if set(issues).issubset({'example_en','example_zh','example_form'}):
                req['repair_note']='上一次例句未通过。请务必原样使用 allowed_forms 中的一个形式，例如：'+(', '.join(forms[:8]) if forms else x['term'])
        except Exception as e:
            last=[str(e)]
        time.sleep(min(1+attempt,4))
    raise RuntimeError(f'lexicon individual repair failed {x["term"]}: {last}')

def generate_precise(x):
    toks=tokenize(x['text'])
    system='''你是严格的英语句法教师。只分析给定考研英语真题原句。必须使用用户提供的 token 列表及 0 起始索引，不得改词、增词。输出严格 JSON。目标是教学用逐词精析：每一个含英文字母或数字的 lexical token 必须且只能分配到一个 primary group；嵌套关系通过 group 的 note 说明，不能把同一 token 重复放到多个 group。'''
    req={'id':x['id'],'stage':'precise','sentence':x['text'],'tokens':[{'i':i,'t':t} for i,t in enumerate(toks)]}
    user='''返回 {"id":"...","groups":[{"label":"中文结构标签","token_indices":[...],"note":"说明"}],"main_stem_indices":[...],"abridged_en":"...","zh":"完整准确汉译","main_stem_zh":"主干汉译","logic":"抓句逻辑"}。
必须满足：
- 所有 lexical token 索引在 groups 中恰好出现一次；标点可以不分组；
- group 标签应尽量体现主句、状语从句、定语从句、宾语从句、非谓语、插入语、介词修饰、并列等真实结构；
- main_stem_indices 只选不可缺的主谓宾/主系表及必要补足成分。
输入：\n'''+json.dumps(req,ensure_ascii=False)
    item=call_json(system,user,10000)
    if item.get('id')!=x['id']:
        item['id']=x['id']
    for attempt in range(3):
        ok,msg=validate_main_indices(item,toks,x['id'])
        missing,duplicates=precise_coverage(item,toks)
        if ok and not missing and not duplicates and item.get('zh'):
            return item,toks
        item=repair_precise_item(x,item,toks,missing,duplicates)
        if item.get('id')!=x['id']:
            item['id']=x['id']
    dedupe_primary_groups(item,toks)
    missing,duplicates=precise_coverage(item,toks)
    if missing:
        item=targeted_fill_missing(x,item,toks,missing)
    dedupe_primary_groups(item,toks)
    ok,msg=validate_main_indices(item,toks,x['id'])
    missing,duplicates=precise_coverage(item,toks)
    if not ok or missing or duplicates or not item.get('zh'):
        raise RuntimeError(f'precise repair failed {x["id"]}: missing={missing}, duplicates={duplicates}, main={msg}')
    item['repair_checked']=True
    return item,toks


# ---------- 600 sentence translations + chunk exercises ----------
pools=json.loads((SRC/'sentence_pools.json').read_text(encoding='utf8'))
all_s=[]
for pool,arr in pools.items():
    for s in arr:
        x=dict(s); x['pool']=pool; all_s.append(x)
assert len(all_s)==600 and len({x['id'] for x in all_s})==600

sent_out=load_ckpt('sentences.json',{})
system='''你是考研英语一真题教学数据编辑。只处理用户给出的原句，不改写原句，不杜撰真题。输出严格 JSON。中文翻译要求准确、自然、保留逻辑关系；拼句块按语义切分，既不能细到单词堆，也不能整句只切两块。干扰块必须语法上像真答案但语义不合，且不能与正确块重复。'''
pending=[x for x in all_s if x['id'] not in sent_out]
for batch in batches(pending,10):
    payload=[{'id':x['id'],'pool':x['pool'],'year':x['year'],'text':x['text']} for x in batch]
    user='''请为下列句子生成训练数据。返回 JSON：{"items":[{"id":"...","zh":"完整准确汉译","en_chunks":["按原句顺序的英文语义块"],"zh_chunks":["按译文顺序的中文意群块"],"en_distractors":["2个英文干扰块"],"zh_distractors":["2个中文干扰块"],"key_points":["2-4个翻译关键点"]}]}。\n要求 en_chunks 连起来必须覆盖原句主要文字且保持原句顺序；不要加入原句不存在的正确块。JSON 数据如下：\n'''+json.dumps(payload,ensure_ascii=False)
    obj=call_json(system,user,12000)
    got={i['id']:i for i in obj.get('items',[]) if isinstance(i,dict) and i.get('id')}
    for x in batch:
        i=got.get(x['id'])
        if not sentence_item_valid(i):
            print('repair sentence individually',x['id'],flush=True)
            i=enrich_sentence_single(x)
        i.update({'year':x['year'],'page':x['page'],'source':x['source'],'en':x['text'],'pool':x['pool'],'word_count':x['word_count']})
        sent_out[x['id']]=i
        save_ckpt('sentences.json',sent_out)
    print('sentences',len(sent_out),'/',len(all_s),flush=True)

# ---------- translate every remaining corpus sentence for review explanations ----------
corpus_all=json.loads((SRC/'corpus_sentences.json').read_text(encoding='utf8'))
corpus=[x for x in corpus_all if x.get('source')!='写作']
context_zh=load_ckpt('corpus_translations.json',{})
for k,v in sent_out.items():
    if k in {x['id'] for x in corpus}:
        context_zh.setdefault(k,v['zh'])
remaining_corpus=[x for x in corpus if x['id'] not in context_zh]
system_ctx='''你是考研英语一真题译文编辑。只翻译给定英文原句，不增加信息。中文准确、自然、逻辑关系清楚。只返回严格 JSON。'''
for batch in batches(remaining_corpus,18):
    payload=[{'id':x['id'],'text':x['text']} for x in batch]
    user='返回 JSON：{"items":[{"id":"...","zh":"完整准确汉译"}]}。输入：\n'+json.dumps(payload,ensure_ascii=False)
    obj=call_json(system_ctx,user,10000)
    got={i['id']:i.get('zh','').strip() for i in obj.get('items',[]) if isinstance(i,dict) and i.get('id')}
    for x in batch:
        zh=got.get(x['id'],'')
        if not zh:
            print('repair context translation individually',x['id'],flush=True)
            zh=translate_context_single(x)
        context_zh[x['id']]=zh
        save_ckpt('corpus_translations.json',context_zh)
    print('corpus translations',len(context_zh),'/',len(corpus),flush=True)

# ---------- 100 analysis items with stage-specific structure ----------
analysis=pools['analysis']
analysis_out=load_ckpt('analysis.json',{})

# Precise items are generated one-by-one and rigorously repaired so no lexical token is omitted.
for x in [z for z in analysis if z['stage']=='precise' and z['id'] not in analysis_out]:
    item,toks=generate_precise(x)
    item.update({'id':x['id'],'stage':x['stage'],'en':x['text'],'tokens':toks,'year':x['year'],'page':x['page']})
    analysis_out[x['id']]=item
    save_ckpt('analysis.json',analysis_out)
    print('analysis precise',len(analysis_out),'/',len(analysis),x['id'],flush=True)

# Coarse and main-stem stages remain batched; their schema is much less omission-prone.
system2='''你是严格的英语句法教师。只分析给定真题原句。必须使用用户提供的 token 列表及其 0 起始索引，不得改词、增词或漏掉关键主干。输出严格 JSON。主句、从句、非谓语、插入语等标签用中文。分析目标是从粗略层级识别逐步训练到只抓主干。'''
remaining=[z for z in analysis if z['stage']!='precise' and z['id'] not in analysis_out]
for batch in batches(remaining,4):
    req=[]
    for x in batch:
        toks=tokenize(x['text'])
        req.append({'id':x['id'],'stage':x['stage'],'sentence':x['text'],'tokens':[{'i':i,'t':t} for i,t in enumerate(toks)]})
    user='''按 stage 生成数据：
coarse：segments 数组，每段 {label, token_indices, removable_first_pass:boolean, note}；另给 main_stem_indices、abridged_en、zh、main_stem_zh、logic。
main_stem：只给 main_stem_indices、abridged_en、zh、main_stem_zh、discard_notes（说明哪些修饰可先括掉）、logic。
返回 {"items":[...]}。不要把标点当作必须主干，main_stem_indices 只选最必要的主谓宾/主系表及不可缺少成分。输入：\n'''+json.dumps(req,ensure_ascii=False)
    obj=call_json(system2,user,14000)
    got={i['id']:i for i in obj.get('items',[]) if isinstance(i,dict) and i.get('id')}
    for x in batch:
        i=got.get(x['id']); toks=tokenize(x['text'])
        ok,msg=validate_main_indices(i or {},toks,x['id'])
        if (not i or not i.get('zh') or not ok or (x['stage']=='coarse' and len(i.get('segments',[]))<2)):
            print('repair analysis individually',x['id'],flush=True)
            i,toks=generate_nonprecise_single(x)
        i.update({'id':x['id'],'stage':x['stage'],'en':x['text'],'tokens':toks,'year':x['year'],'page':x['page']})
        analysis_out[x['id']]=i
        save_ckpt('analysis.json',analysis_out)
    print('analysis',len(analysis_out),'/',len(analysis),flush=True)


# ---------- Lexicon dictionary/senses are LOCAL, not AI ----------
# build_lexicon.py already created data/work/lexicon.senses.json from ECDICT.
# We deliberately do not call DeepSeek 3000 times. This makes the build fast and
# removes a whole class of failures caused by inflected forms or missing AI fields.
lexpath=WORK/'lexicon.base.json'; sensepath=WORK/'lexicon.senses.json'
if not lexpath.exists() or not sensepath.exists():
    raise SystemExit('Run build_lexicon.py before build_ai_content.py')
lex=json.loads(lexpath.read_text(encoding='utf8'))
lex_out=json.loads(sensepath.read_text(encoding='utf8'))
if len(lex)!=3000 or len(lex_out)!=3000:
    raise RuntimeError(f'local lexicon incomplete: lex={len(lex)} senses={len(lex_out)}')
print('lexicon dictionary+senses 3000 / 3000 (local; zero DeepSeek word calls)',flush=True)

# ---------- publish complete enrichment files ----------
(WORK/'sentences.enriched.json').write_text(json.dumps(sent_out,ensure_ascii=False,indent=2),encoding='utf8')
(WORK/'corpus.translations.json').write_text(json.dumps(context_zh,ensure_ascii=False,indent=2),encoding='utf8')
(WORK/'analysis.enriched.json').write_text(json.dumps(analysis_out,ensure_ascii=False,indent=2),encoding='utf8')
# lexicon.senses.json is already canonical local output; rewrite only for formatting consistency.
(WORK/'lexicon.senses.json').write_text(json.dumps(lex_out,ensure_ascii=False,indent=2),encoding='utf8')
print('AI enrichment complete (sentences/analysis only; vocabulary dictionary is local)')
