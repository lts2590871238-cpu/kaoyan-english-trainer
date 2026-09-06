const VERSION = 'v20.0.0';
const API_ROOT = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-v4-flash';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') {
      if (!originAllowed(origin, env)) return json({ ok:false, error:{code:'origin_not_allowed',message:'Origin not allowed'} }, 403, cors);
      return new Response(null, { status:204, headers:cors });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({
        ok:true,
        worker:true,
        configured:Boolean(env.DEEPSEEK_API_KEY),
        model:env.DEEPSEEK_MODEL || DEFAULT_MODEL,
        version:VERSION,
        service:'xuanxuan-english-ai'
      }, 200, cors);
    }

    if (request.method === 'GET' && url.pathname === '/self-test') {
      return selfTest(env, cors);
    }

    if (!originAllowed(origin, env)) return json({ ok:false, error:{code:'origin_not_allowed',message:'Origin not allowed'} }, 403, cors);
    if (request.method !== 'POST') return json({ ok:false, error:{code:'method_not_allowed',message:'POST only'} }, 405, cors);
    if (!env.DEEPSEEK_API_KEY) return json({ ok:false, error:{code:'not_configured',message:'DEEPSEEK_API_KEY is not configured'} }, 503, cors);

    let body;
    try { body = await request.json(); }
    catch { return json({ ok:false, error:{code:'bad_json',message:'Invalid JSON body'} }, 400, cors); }

    try {
      if (url.pathname === '/score-translation') {
        const out = await scoreTranslation(body, env);
        return json({ ok:true, ...out, worker_version:VERSION }, 200, cors);
      }
      if (url.pathname === '/score-abridgement') {
        const out = await scoreAbridgement(body, env);
        return json({ ok:true, ...out, worker_version:VERSION }, 200, cors);
      }
      if (url.pathname === '/lookup-word') {
        const out = await lookupWord(body, env);
        return json({ ok:true, ...out, worker_version:VERSION }, 200, cors);
      }
      if (url.pathname === '/daily-plan') {
        const out = await dailyPlan(body, env);
        return json({ ok:true, ...out, worker_version:VERSION }, 200, cors);
      }
      return json({ ok:false, error:{code:'unknown_endpoint',message:'Unknown endpoint'} }, 404, cors);
    } catch (err) {
      const e = normalizeError(err);
      return json({ ok:false, error:e, worker_version:VERSION }, e.http_status || 502, cors);
    }
  }
};

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGIN || '')
    .split(',').map(x=>x.trim().replace(/\/+$/,'')).filter(Boolean);
}
function originAllowed(origin, env) {
  if (!origin) return false;
  const normalized = origin.replace(/\/+$/,'');
  const list = allowedOrigins(env);
  return list.includes('*') || list.includes(normalized);
}
function corsHeaders(origin, env) {
  const allow = origin && originAllowed(origin, env) ? origin : 'null';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin'
  };
}
function json(obj,status=200,headers={}) { return new Response(JSON.stringify(obj),{status,headers}); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

class UpstreamError extends Error {
  constructor(message,{status=0,code='upstream_error',retryable=false,detail=''}={}) {
    super(message); this.name='UpstreamError'; this.status=status; this.code=code; this.retryable=retryable; this.detail=detail;
  }
}
function normalizeError(err) {
  if (err instanceof UpstreamError) {
    const map={401:'auth_failed',402:'insufficient_balance',422:'invalid_parameters',429:'rate_limited',500:'server_error',503:'server_overloaded'};
    return {code:map[err.status]||err.code||'upstream_error',message:err.message,upstream_status:err.status||null,retryable:!!err.retryable,detail:String(err.detail||'').slice(0,240),http_status:err.status>=400&&err.status<600?err.status:502};
  }
  if (err?.name === 'AbortError') return {code:'timeout',message:'DeepSeek request timed out',retryable:true,http_status:504};
  return {code:'worker_error',message:String(err?.message||err||'Unknown error').slice(0,300),retryable:false,http_status:502};
}

async function deepseekRaw(path, options, env, timeoutMs=30000) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const r = await fetch(API_ROOT + path, {
      ...options,
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${env.DEEPSEEK_API_KEY}`,...(options.headers||{})},
      signal:controller.signal
    });
    const text = await r.text();
    let obj=null; try{obj=text?JSON.parse(text):null;}catch{}
    if(!r.ok){
      const detail=obj?.error?.message||obj?.message||text||`HTTP ${r.status}`;
      throw new UpstreamError(`DeepSeek HTTP ${r.status}`,{status:r.status,retryable:[429,500,503].includes(r.status),detail});
    }
    return obj;
  } finally { clearTimeout(timer); }
}

async function deepseekJson(messages, env, {maxTokens=1000,retries=1}={}) {
  let last;
  for(let attempt=0; attempt<=retries; attempt++){
    try{
      const obj=await deepseekRaw('/chat/completions',{
        method:'POST',
        body:JSON.stringify({
          model:env.DEEPSEEK_MODEL||DEFAULT_MODEL,
          thinking:{type:'disabled'},
          messages,
          response_format:{type:'json_object'},
          temperature:0.1,
          max_tokens:maxTokens,
          stream:false
        })
      },env,35000);
      let content=obj?.choices?.[0]?.message?.content;
      if(!content||!String(content).trim()) throw new UpstreamError('DeepSeek returned empty JSON content',{code:'empty_content',retryable:true});
      content=String(content).trim().replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/\s*```$/,'').trim();
      try{return JSON.parse(content);}catch{throw new UpstreamError('DeepSeek returned invalid JSON content',{code:'invalid_json_content',retryable:true,detail:content.slice(0,200)});}
    }catch(e){
      last=e;
      const retryable=e instanceof UpstreamError?e.retryable:e?.name==='AbortError';
      if(attempt>=retries||!retryable) throw e;
      await sleep(650*(attempt+1));
    }
  }
  throw last;
}

async function getBalance(env){
  const obj=await deepseekRaw('/user/balance',{method:'GET',headers:{'Content-Type':'application/json'}},env,12000);
  return Boolean(obj?.is_available);
}

async function selfTest(env,cors){
  if(!env.DEEPSEEK_API_KEY) return json({ok:false,worker:true,key:false,balance:false,model:false,json:false,version:VERSION,error:{code:'not_configured',message:'DEEPSEEK_API_KEY is not configured'}},200,cors);
  try{
    const balance=await getBalance(env);
    if(!balance) return json({ok:false,worker:true,key:true,balance:false,model:false,json:false,version:VERSION,error:{code:'insufficient_balance',message:'DeepSeek account has no available balance'}},200,cors);
    const out=await deepseekJson([
      {role:'system',content:'Return JSON only. JSON example: {"pong":"ok"}.'},
      {role:'user',content:'Reply with exactly one JSON object whose pong field is ok.'}
    ],env,{maxTokens:80,retries:1});
    const model=out?.pong==='ok';
    return json({ok:model,worker:true,key:true,balance:true,model,json:model,version:VERSION,model_name:env.DEEPSEEK_MODEL||DEFAULT_MODEL,error:model?null:{code:'self_test_bad_output',message:'DeepSeek self-test returned unexpected JSON'}},200,cors);
  }catch(err){
    const e=normalizeError(err);
    return json({ok:false,worker:true,key:e.code!=='auth_failed',balance:e.code!=='insufficient_balance',model:false,json:false,version:VERSION,error:e},200,cors);
  }
}

function clamp(v,min=0,max=100){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.round(n))):min;}
function list(v,n){return Array.isArray(v)?v.map(x=>String(x).trim()).filter(Boolean).slice(0,n):[];}

async function scoreTranslation(body,env){
  const direction=String(body?.direction||'').trim(),source=String(body?.source||'').trim(),reference=String(body?.reference||'').trim(),answer=String(body?.answer||'').trim();
  if(!source||!reference||!answer) throw new UpstreamError('Missing source/reference/answer',{code:'missing_fields'});
  if([source,reference,answer].some(x=>x.length>5000)) throw new UpstreamError('Translation text is too long',{code:'too_long'});
  const sys=`你是考研英语一翻译阅卷老师。宽松接受同义改写和自然语序，不要求逐字对应；严格检查核心语义、主干关系、逻辑关系、否定、修饰对象、时态语态。只输出合法 JSON，不要 Markdown。JSON 示例：{"score":85,"semantic":88,"logic":82,"expression":86,"acceptable":true,"strengths":["主干正确"],"issues":["一处逻辑关系可更准确"],"suggestion":"一句具体建议"}`;
  const user=`方向:${direction||'translation'}\n原题:${source}\n参考答案:${reference}\n学生答案:${answer}\n请评分0-100，只输出JSON。`;
  const r=await deepseekJson([{role:'system',content:sys},{role:'user',content:user}],env,{maxTokens:850,retries:1});
  return {score:clamp(r.score),semantic:clamp(r.semantic),logic:clamp(r.logic),expression:clamp(r.expression),acceptable:Boolean(r.acceptable),strengths:list(r.strengths,2),issues:list(r.issues,3),suggestion:String(r.suggestion||'').slice(0,300)};
}

async function scoreAbridgement(body,env){
  const source=String(body?.source||'').trim(),reference=String(body?.reference||'').trim(),answer=String(body?.answer||'').trim();
  if(!source||!reference||!answer) throw new UpstreamError('Missing source/reference/answer',{code:'missing_fields'});
  const sys=`你是考研英语长难句主干训练老师。判断学生缩写句是否保留原句核心主语、谓语、宾语或表语以及必要逻辑。允许自然改写，不要求和参考缩写逐字一致。只输出合法JSON。JSON示例：{"score":90,"preserves_core":true,"issues":[],"suggestion":"可进一步删去次要修饰"}`;
  const user=`原句:${source}\n参考最短主干:${reference}\n学生缩写:${answer}\n请评分0-100，只输出JSON。`;
  const r=await deepseekJson([{role:'system',content:sys},{role:'user',content:user}],env,{maxTokens:500,retries:1});
  return {score:clamp(r.score),preserves_core:Boolean(r.preserves_core),issues:list(r.issues,3),suggestion:String(r.suggestion||'').slice(0,260)};
}

async function lookupWord(body,env){
  const word=String(body?.word||'').trim(),context=String(body?.context||'').trim();
  if(!word) throw new UpstreamError('Missing word',{code:'missing_fields'});
  if(word.length>80||context.length>4000) throw new UpstreamError('Lookup input too long',{code:'too_long'});
  const sys=`你是考研英语词典助手。根据给出的英文词和真题上下文，给出简洁可靠释义。只输出合法JSON。JSON示例：{"lemma":"make","pos":"v.","meaning_zh":"制造；使得；做","context_meaning_zh":"使得","definition_en":"to cause something to happen or exist","note":"本句中作使役动词"}`;
  const user=`目标词:${word}\n上下文:${context||'无'}\n请给出常用中文义、本句义、词性和简短英英释义，只输出JSON。`;
  const r=await deepseekJson([{role:'system',content:sys},{role:'user',content:user}],env,{maxTokens:450,retries:1});
  return {word,lemma:String(r.lemma||word).trim(),pos:String(r.pos||'').trim(),meaning_zh:String(r.meaning_zh||'').trim(),context_meaning_zh:String(r.context_meaning_zh||r.meaning_zh||'').trim(),definition_en:String(r.definition_en||'').trim(),note:String(r.note||'').trim()};
}

async function dailyPlan(body,env){
  const fresh=Array.isArray(body?.new_word_candidates)?body.new_word_candidates.slice(0,80):[];
  const review=Array.isArray(body?.review_candidates)?body.review_candidates.slice(0,50):[];
  const sentences=Array.isArray(body?.sentence_candidates)?body.sentence_candidates.slice(0,16):[];
  const sys=`你是100天考研英语训练计划器。只能从候选ID中选择，不得创造ID。新词优先保持高15中9低6；复习优先到期>近期做错>掌握度低>高频；句子优先覆盖近期弱项。只输出合法JSON。JSON示例：{"new_word_ids":[],"review_ids":[],"sentence_ids":[],"reason":""}`;
  const user=`第${Number(body?.day||1)}天。新词候选=${JSON.stringify(fresh)}\n复习候选=${JSON.stringify(review)}\n句子候选=${JSON.stringify(sentences)}\n弱项=${JSON.stringify(body?.weak_tags||[])}\n只输出JSON。`;
  const r=await deepseekJson([{role:'system',content:sys},{role:'user',content:user}],env,{maxTokens:900,retries:1});
  const f=new Set(fresh.map(x=>x?.id).filter(Boolean)),rv=new Set(review.map(x=>x?.id).filter(Boolean)),s=new Set(sentences.map(x=>x?.id).filter(Boolean));
  return {new_word_ids:uniqueAllowed(r.new_word_ids,f,30),review_ids:uniqueAllowed(r.review_ids,rv,10),sentence_ids:uniqueAllowed(r.sentence_ids,s,6),reason:String(r.reason||'').slice(0,240)};
}
function uniqueAllowed(v,set,n){const out=[],seen=new Set();for(const id of Array.isArray(v)?v:[]){if(set.has(id)&&!seen.has(id)){seen.add(id);out.push(id);if(out.length>=n)break;}}return out;}
