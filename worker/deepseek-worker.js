const VERSION = 'v21.0.0';
const API_ROOT = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const SESSION_DAYS = 30;
const MAX_SYNC_CHUNKS = 48;

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
        database:Boolean(env.DB),
        auth_configured:Boolean(env.AUTH_PEPPER),
        model:env.DEEPSEEK_MODEL || DEFAULT_MODEL,
        version:VERSION,
        service:'xuanxuan-english-ai'
      }, 200, cors);
    }

    if (request.method === 'GET' && url.pathname === '/self-test') return selfTest(env, cors);

    if (!originAllowed(origin, env)) return json({ ok:false, error:{code:'origin_not_allowed',message:'Origin not allowed'} }, 403, cors);

    if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/sync/')) {
      if (!env.DB) return json({ok:false,error:{code:'db_not_configured',message:'D1 database binding DB is not configured'}},503,cors);
      if (!env.AUTH_PEPPER) return json({ok:false,error:{code:'auth_not_configured',message:'AUTH_PEPPER is not configured'}},503,cors);
      try { return await handleAccountRoutes(request, url, env, cors); }
      catch (err) { const e=normalizeError(err); return json({ok:false,error:e,worker_version:VERSION},e.http_status||500,cors); }
    }

    if (request.method !== 'POST') return json({ ok:false, error:{code:'method_not_allowed',message:'POST only'} }, 405, cors);
    if (!env.DEEPSEEK_API_KEY) return json({ ok:false, error:{code:'not_configured',message:'DEEPSEEK_API_KEY is not configured'} }, 503, cors);

    let body;
    try { body = await request.json(); }
    catch { return json({ ok:false, error:{code:'bad_json',message:'Invalid JSON body'} }, 400, cors); }

    try {
      if (url.pathname === '/score-translation') return json({ ok:true, ...(await scoreTranslation(body, env)), worker_version:VERSION }, 200, cors);
      if (url.pathname === '/score-abridgement') return json({ ok:true, ...(await scoreAbridgement(body, env)), worker_version:VERSION }, 200, cors);
      if (url.pathname === '/lookup-word') return json({ ok:true, ...(await lookupWord(body, env)), worker_version:VERSION }, 200, cors);
      if (url.pathname === '/daily-plan') return json({ ok:true, ...(await dailyPlan(body, env)), worker_version:VERSION }, 200, cors);
      return json({ ok:false, error:{code:'unknown_endpoint',message:'Unknown endpoint'} }, 404, cors);
    } catch (err) {
      const e = normalizeError(err);
      return json({ ok:false, error:e, worker_version:VERSION }, e.http_status || 502, cors);
    }
  }
};

async function handleAccountRoutes(request,url,env,cors){
  if(request.method==='POST' && url.pathname==='/auth/register'){
    const body=await readJson(request);const username=normalizeUsername(body.username),displayName=normalizeDisplayName(body.display_name||body.username),verifier=validateVerifier(body.verifier);
    await authRateLimit(request,env,`register:${username}`,5,30*60);
    const existing=await env.DB.prepare('SELECT id FROM users WHERE username=?').bind(username).first();
    if(existing) return json({ok:false,error:{code:'username_taken',message:'这个账号已经被注册'}},409,cors);
    const now=Date.now(),id=crypto.randomUUID(),verifierHash=await hmacVerifier(verifier,env.AUTH_PEPPER),recoveryCode=randomRecoveryCode(),recoveryHash=await hmacVerifier('recovery:'+normalizeRecovery(recoveryCode),env.AUTH_PEPPER),challengeStart=/^\d{4}-\d{2}-\d{2}$/.test(String(body.start_date||''))?String(body.start_date):serverDate();
    await env.DB.prepare('INSERT INTO users(id,username,display_name,verifier_hash,recovery_hash,challenge_start,created_at,last_login_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(id,username,displayName,verifierHash,recoveryHash,challengeStart,now,now).run();
    const session=await createSession(env,id);
    return json({ok:true,user:{id,username,display_name:displayName,challenge_start:challengeStart,created_at:now},session,recovery_code:recoveryCode},200,cors);
  }
  if(request.method==='POST' && url.pathname==='/auth/login'){
    const body=await readJson(request),username=normalizeUsername(body.username),verifier=validateVerifier(body.verifier);
    await authRateLimit(request,env,`login:${username}`,10,10*60);
    const row=await env.DB.prepare('SELECT id,username,display_name,verifier_hash,challenge_start,created_at FROM users WHERE username=?').bind(username).first();
    const candidate=await hmacVerifier(verifier,env.AUTH_PEPPER);
    if(!row || !safeEqual(candidate,String(row.verifier_hash||''))) return json({ok:false,error:{code:'login_failed',message:'账号或密码不正确'}},401,cors);
    const now=Date.now();await env.DB.prepare('UPDATE users SET last_login_at=? WHERE id=?').bind(now,row.id).run();
    const session=await createSession(env,row.id);
    return json({ok:true,user:{id:row.id,username:row.username,display_name:row.display_name,challenge_start:row.challenge_start,created_at:row.created_at},session},200,cors);
  }

  if(request.method==='POST' && url.pathname==='/auth/reset-password'){
    const body=await readJson(request),username=normalizeUsername(body.username),recovery=normalizeRecovery(body.recovery_code),newVerifier=validateVerifier(body.new_verifier);
    await authRateLimit(request,env,`reset:${username}`,5,30*60);
    const row=await env.DB.prepare('SELECT id,username,display_name,recovery_hash,challenge_start,created_at FROM users WHERE username=?').bind(username).first();
    const candidate=await hmacVerifier('recovery:'+recovery,env.AUTH_PEPPER);
    if(!row||!safeEqual(candidate,String(row.recovery_hash||'')))return json({ok:false,error:{code:'recovery_failed',message:'账号或恢复码不正确'}},401,cors);
    const verifierHash=await hmacVerifier(newVerifier,env.AUTH_PEPPER),newCode=randomRecoveryCode(),newRecoveryHash=await hmacVerifier('recovery:'+normalizeRecovery(newCode),env.AUTH_PEPPER),now=Date.now();
    await env.DB.batch([env.DB.prepare('UPDATE users SET verifier_hash=?,recovery_hash=?,last_login_at=? WHERE id=?').bind(verifierHash,newRecoveryHash,now,row.id),env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(row.id)]);
    const session=await createSession(env,row.id);
    return json({ok:true,user:{id:row.id,username:row.username,display_name:row.display_name,challenge_start:row.challenge_start,created_at:row.created_at},session,recovery_code:newCode},200,cors);
  }
  if(request.method==='POST' && url.pathname==='/auth/logout'){
    const token=getBearer(request);if(token){const hash=await sha256b64(token);await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(hash).run();}
    return json({ok:true},200,cors);
  }
  if(request.method==='GET' && url.pathname==='/auth/me'){
    const auth=await requireUser(request,env);
    return json({ok:true,user:auth.user},200,cors);
  }
  if(request.method==='GET' && url.pathname==='/sync/pull'){
    const auth=await requireUser(request,env);
    const rows=await env.DB.prepare('SELECT chunk_key,data_json,updated_at FROM progress_chunks WHERE user_id=? ORDER BY chunk_key').bind(auth.user.id).all();
    const chunks={};for(const row of rows.results||[]){try{chunks[row.chunk_key]={data:JSON.parse(row.data_json),updated_at:Number(row.updated_at)||0};}catch{}}
    return json({ok:true,user:auth.user,chunks,server_time:Date.now(),worker_version:VERSION},200,cors);
  }
  if(request.method==='POST' && url.pathname==='/sync/push'){
    const auth=await requireUser(request,env),body=await readJson(request),items=Array.isArray(body.chunks)?body.chunks:[];
    if(items.length>MAX_SYNC_CHUNKS) return json({ok:false,error:{code:'too_many_chunks',message:'Too many sync chunks'}},400,cors);
    const now=Date.now(),stmts=[];
    for(const item of items){
      const key=String(item?.key||'').trim();if(!/^(core|aidict|words:\d+|sentences:\d+)$/.test(key))continue;
      const data=JSON.stringify(item.data??{});if(data.length>1500000)return json({ok:false,error:{code:'chunk_too_large',message:`Sync chunk ${key} is too large`}},413,cors);
      stmts.push(env.DB.prepare('INSERT INTO progress_chunks(user_id,chunk_key,data_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,chunk_key) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at')
        .bind(auth.user.id,key,data,now));
    }
    if(stmts.length) await env.DB.batch(stmts);
    return json({ok:true,written:stmts.length,updated_at:now,worker_version:VERSION},200,cors);
  }
  return json({ok:false,error:{code:'unknown_endpoint',message:'Unknown account endpoint'}},404,cors);
}

function normalizeUsername(v){const s=String(v||'').trim().toLowerCase();if(!/^[a-z0-9_]{3,24}$/.test(s))throw clientError('bad_username','账号只能使用3–24位小写字母、数字或下划线');return s;}
function normalizeDisplayName(v){const s=String(v||'').trim();if(s.length<1||s.length>20)throw clientError('bad_display_name','昵称长度需为1–20个字符');return s;}
function validateVerifier(v){const s=String(v||'').trim();if(!/^[A-Za-z0-9_-]{40,60}$/.test(s))throw clientError('bad_verifier','登录凭据格式错误');return s;}
function randomRecoveryCode(){const b=new Uint8Array(12);crypto.getRandomValues(b);const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();return h.match(/.{1,6}/g).join('-');}
function normalizeRecovery(v){const s=String(v||'').replace(/[^A-Fa-f0-9]/g,'').toUpperCase();if(!/^[A-F0-9]{24}$/.test(s))throw clientError('bad_recovery_code','恢复码格式不正确');return s;}
function clientError(code,message,status=400){const e=new Error(message);e.client=true;e.code=code;e.status=status;return e;}
async function readJson(request){try{return await request.json();}catch{throw clientError('bad_json','Invalid JSON body');}}
function serverDate(){return new Date().toISOString().slice(0,10);}
function bytesToB64url(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256b64(text){const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(text)));return bytesToB64url(new Uint8Array(buf));}
async function hmacVerifier(verifier,pepper){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(String(pepper)),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(verifier));return bytesToB64url(new Uint8Array(sig));}
function safeEqual(a,b){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
function getBearer(request){const h=request.headers.get('Authorization')||'';return h.startsWith('Bearer ')?h.slice(7).trim():'';}
async function createSession(env,userId){const raw=new Uint8Array(32);crypto.getRandomValues(raw);const token=bytesToB64url(raw),hash=await sha256b64(token),now=Date.now(),expires=now+SESSION_DAYS*86400000;await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').bind(hash,userId,now,expires).run();return {token,expires_at:expires};}
async function requireUser(request,env){const token=getBearer(request);if(!token)throw clientError('unauthorized','请先登录',401);const hash=await sha256b64(token),now=Date.now();const row=await env.DB.prepare(`SELECT u.id,u.username,u.display_name,u.challenge_start,u.created_at,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).bind(hash,now).first();if(!row)throw clientError('session_expired','登录已过期，请重新登录',401);return {user:{id:row.id,username:row.username,display_name:row.display_name,challenge_start:row.challenge_start,created_at:row.created_at},expires_at:row.expires_at};}
async function authRateLimit(request,env,label,limit,windowSeconds){const ip=request.headers.get('CF-Connecting-IP')||'unknown',bucket=Math.floor(Date.now()/(windowSeconds*1000)),key=await sha256b64(`${ip}|${label}|${bucket}`),now=Date.now(),expires=now+windowSeconds*1000;const row=await env.DB.prepare('SELECT attempts FROM auth_rate WHERE rate_key=?').bind(key).first();if(Number(row?.attempts||0)>=limit)throw clientError('too_many_attempts','尝试次数过多，请稍后再试',429);await env.DB.prepare(`INSERT INTO auth_rate(rate_key,window_start,attempts,expires_at) VALUES(?,?,1,?) ON CONFLICT(rate_key) DO UPDATE SET attempts=attempts+1,expires_at=excluded.expires_at`).bind(key,now,expires).run();}

function allowedOrigins(env) { return String(env.ALLOWED_ORIGIN || '').split(',').map(x=>x.trim().replace(/\/+$/,'')).filter(Boolean); }
function originAllowed(origin, env) { if (!origin) return false; const normalized = origin.replace(/\/+$/,''); const list = allowedOrigins(env); return list.includes('*') || list.includes(normalized); }
function corsHeaders(origin, env) {
  const allow = origin && originAllowed(origin, env) ? origin : 'null';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin'
  };
}
function json(obj,status=200,headers={}) { return new Response(JSON.stringify(obj),{status,headers}); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

class UpstreamError extends Error {
  constructor(message,{status=0,code='upstream_error',retryable=false,detail=''}={}) { super(message); this.name='UpstreamError'; this.status=status; this.code=code; this.retryable=retryable; this.detail=detail; }
}
function normalizeError(err) {
  if(err?.client)return {code:err.code||'client_error',message:err.message,http_status:err.status||400,retryable:false};
  if (err instanceof UpstreamError) {
    const map={401:'auth_failed',402:'insufficient_balance',422:'invalid_parameters',429:'rate_limited',500:'server_error',503:'server_overloaded'};
    return {code:map[err.status]||err.code||'upstream_error',message:err.message,upstream_status:err.status||null,retryable:!!err.retryable,detail:String(err.detail||'').slice(0,240),http_status:err.status>=400&&err.status<600?err.status:502};
  }
  if (err?.name === 'AbortError') return {code:'timeout',message:'DeepSeek request timed out',retryable:true,http_status:504};
  return {code:'worker_error',message:String(err?.message||err||'Unknown error').slice(0,300),retryable:false,http_status:500};
}

async function deepseekRaw(path, options, env, timeoutMs=30000) {
  const controller = new AbortController(); const timer = setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const r = await fetch(API_ROOT + path, {...options,headers:{'Content-Type':'application/json','Authorization':`Bearer ${env.DEEPSEEK_API_KEY}`,...(options.headers||{})},signal:controller.signal});
    const text = await r.text(); let obj=null; try{obj=text?JSON.parse(text):null;}catch{}
    if(!r.ok){const detail=obj?.error?.message||obj?.message||text||`HTTP ${r.status}`;throw new UpstreamError(`DeepSeek HTTP ${r.status}`,{status:r.status,retryable:[429,500,503].includes(r.status),detail});}
    return obj;
  } finally { clearTimeout(timer); }
}
async function deepseekJson(messages, env, {maxTokens=1000,retries=1}={}) {
  let last;
  for(let attempt=0; attempt<=retries; attempt++){
    try{
      const obj=await deepseekRaw('/chat/completions',{method:'POST',body:JSON.stringify({model:env.DEEPSEEK_MODEL||DEFAULT_MODEL,thinking:{type:'disabled'},messages,response_format:{type:'json_object'},temperature:0.1,max_tokens:maxTokens,stream:false})},env,35000);
      let content=obj?.choices?.[0]?.message?.content;
      if(!content||!String(content).trim()) throw new UpstreamError('DeepSeek returned empty JSON content',{code:'empty_content',retryable:true});
      content=String(content).trim().replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/\s*```$/,'').trim();
      try{return JSON.parse(content);}catch{throw new UpstreamError('DeepSeek returned invalid JSON content',{code:'invalid_json_content',retryable:true,detail:content.slice(0,200)});}
    }catch(e){last=e;const retryable=e instanceof UpstreamError?e.retryable:e?.name==='AbortError';if(attempt>=retries||!retryable)throw e;await sleep(650*(attempt+1));}
  }
  throw last;
}
async function getBalance(env){const obj=await deepseekRaw('/user/balance',{method:'GET',headers:{'Content-Type':'application/json'}},env,12000);return Boolean(obj?.is_available);}
async function selfTest(env,cors){
  if(!env.DEEPSEEK_API_KEY) return json({ok:false,worker:true,key:false,balance:false,model:false,json:false,version:VERSION,error:{code:'not_configured',message:'DEEPSEEK_API_KEY is not configured'}},200,cors);
  try{const balance=await getBalance(env);if(!balance)return json({ok:false,worker:true,key:true,balance:false,model:false,json:false,version:VERSION,error:{code:'insufficient_balance',message:'DeepSeek account has no available balance'}},200,cors);const out=await deepseekJson([{role:'system',content:'Return JSON only. JSON example: {"pong":"ok"}.'},{role:'user',content:'Reply with exactly one JSON object whose pong field is ok.'}],env,{maxTokens:80,retries:1});const model=out?.pong==='ok';return json({ok:model,worker:true,key:true,balance:true,model,json:model,version:VERSION,model_name:env.DEEPSEEK_MODEL||DEFAULT_MODEL,error:model?null:{code:'self_test_bad_output',message:'DeepSeek self-test returned unexpected JSON'}},200,cors);}catch(err){const e=normalizeError(err);return json({ok:false,worker:true,key:e.code!=='auth_failed',balance:e.code!=='insufficient_balance',model:false,json:false,version:VERSION,error:e},200,cors);}
}

function clamp(v,min=0,max=100){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.round(n))):min;}
function list(v,n){return Array.isArray(v)?v.map(x=>String(x).trim()).filter(Boolean).slice(0,n):[];}
async function scoreTranslation(body,env){const direction=String(body?.direction||'').trim(),source=String(body?.source||'').trim(),reference=String(body?.reference||'').trim(),answer=String(body?.answer||'').trim();if(!source||!reference||!answer)throw new UpstreamError('Missing source/reference/answer',{code:'missing_fields'});if([source,reference,answer].some(x=>x.length>5000))throw new UpstreamError('Translation text is too long',{code:'too_long'});const sys=`你是考研英语一翻译阅卷老师。宽松接受同义改写和自然语序，不要求逐字对应；严格检查核心语义、主干关系、逻辑关系、否定、修饰对象、时态语态。只输出合法 JSON，不要 Markdown。JSON 示例：{"score":85,"semantic":88,"logic":82,"expression":86,"acceptable":true,"strengths":["主干正确"],"issues":["一处逻辑关系可更准确"],"suggestion":"一句具体建议"}`;const user=`方向:${direction||'translation'}\n原题:${source}\n参考答案:${reference}\n学生答案:${answer}\n请评分0-100，只输出JSON。`;const r=await deepseekJson([{role:'system',content:sys},{role:'user',content:user}],env,{maxTokens:850,retries:1});return {score:clamp(r.score),semantic:clamp(r.semantic),logic:clamp(r.logic),expression:clamp(r.expression),acceptable:Boolean(r.acceptable),strengths:list(r.strengths,2),issues:list(r.issues,3),suggestion:String(r.suggestion||'').slice(0,300)};}
async function scoreAbridgement(body,env){const source=String(body?.source||'').trim(),reference=String(body?.reference||'').trim(),answer=String(body?.answer||'').trim();if(!source||!reference||!answer)throw new UpstreamError('Missing source/reference/answer',{code:'missing_fields'});const sys=`你是考研英语长难句主干训练老师。判断学生缩写句是否保留原句核心主语、谓语、宾语或表语以及必要逻辑。允许自然改写，不要求和参考缩写逐字一致。只输出合法JSON。JSON示例：{"score":90,"preserves_core":true,"issues":[],"suggestion":"可进一步删去次要修饰"}`;const user=`原句:${source}\n参考最短主干:${reference}\n学生缩写:${answer}\n请评分0-100，只输出JSON。`;const r=await deepseekJson([{role:'system',content:sys},{role:'user',content:user}],env,{maxTokens:500,retries:1});return {score:clamp(r.score),preserves_core:Boolean(r.preserves_core),issues:list(r.issues,3),suggestion:String(r.suggestion||'').slice(0,260)};}
async function lookupWord(body,env){const word=String(body?.word||'').trim(),context=String(body?.context||'').trim();if(!word)throw new UpstreamError('Missing word',{code:'missing_fields'});if(word.length>80||context.length>4000)throw new UpstreamError('Lookup input too long',{code:'too_long'});const sys=`你是考研英语词典助手。根据给出的英文词和真题上下文，给出简洁可靠释义。只输出合法JSON。JSON示例：{"lemma":"make","pos":"v.","meaning_zh":"制造；使得；做","context_meaning_zh":"使得","definition_en":"to cause something to happen or exist","note":"本句中作使役动词"}`;const user=`目标词:${word}\n上下文:${context||'无'}\n请给出常用中文义、本句义、词性和简短英英释义，只输出JSON。`;const r=await deepseekJson([{role:'system',content:sys},{role:'user',content:user}],env,{maxTokens:450,retries:1});return {word,lemma:String(r.lemma||word).trim(),pos:String(r.pos||'').trim(),meaning_zh:String(r.meaning_zh||'').trim(),context_meaning_zh:String(r.context_meaning_zh||r.meaning_zh||'').trim(),definition_en:String(r.definition_en||'').trim(),note:String(r.note||'').trim()};}
async function dailyPlan(body,env){const fresh=Array.isArray(body?.new_word_candidates)?body.new_word_candidates.slice(0,80):[],review=Array.isArray(body?.review_candidates)?body.review_candidates.slice(0,50):[],sentences=Array.isArray(body?.sentence_candidates)?body.sentence_candidates.slice(0,16):[];const sys=`你是100天考研英语训练计划器。只能从候选ID中选择，不得创造ID。新词优先保持高15中9低6；复习优先到期>近期做错>掌握度低>高频；句子优先覆盖近期弱项。只输出合法JSON。JSON示例：{"new_word_ids":[],"review_ids":[],"sentence_ids":[],"reason":""}`;const user=`第${Number(body?.day||1)}天。新词候选=${JSON.stringify(fresh)}\n复习候选=${JSON.stringify(review)}\n句子候选=${JSON.stringify(sentences)}\n弱项=${JSON.stringify(body?.weak_tags||[])}\n只输出JSON。`;const r=await deepseekJson([{role:'system',content:sys},{role:'user',content:user}],env,{maxTokens:900,retries:1});const f=new Set(fresh.map(x=>x?.id).filter(Boolean)),rv=new Set(review.map(x=>x?.id).filter(Boolean)),s=new Set(sentences.map(x=>x?.id).filter(Boolean));return {new_word_ids:uniqueAllowed(r.new_word_ids,f,30),review_ids:uniqueAllowed(r.review_ids,rv,10),sentence_ids:uniqueAllowed(r.sentence_ids,s,6),reason:String(r.reason||'').slice(0,240)};}
function uniqueAllowed(v,set,n){const out=[],seen=new Set();for(const id of Array.isArray(v)?v:[]){if(set.has(id)&&!seen.has(id)){seen.add(id);out.push(id);if(out.length>=n)break;}}return out;}
