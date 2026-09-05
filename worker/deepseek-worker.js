export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': allowed === '*' ? '*' : (origin === allowed ? origin : allowed),
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Content-Type': 'application/json; charset=utf-8'
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);
    if (!env.DEEPSEEK_API_KEY) return json({ error: 'AI service is not configured' }, 503, cors);

    const url = new URL(request.url);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400, cors); }

    try {
      if (url.pathname.endsWith('/score-translation')) {
        return json(await scoreTranslation(body, env), 200, cors);
      }
      if (url.pathname.endsWith('/daily-plan')) {
        return json(await dailyPlan(body, env), 200, cors);
      }
      return json({ error: 'Unknown endpoint' }, 404, cors);
    } catch (e) {
      return json({ error: 'AI temporarily unavailable', detail: String(e?.message || e) }, 502, cors);
    }
  }
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers });
}

async function deepseek(messages, env, maxTokens = 1400) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
        thinking: { type: 'disabled' },
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: maxTokens,
        stream: false
      }),
      signal: controller.signal
    });
    if (!r.ok) throw new Error(`DeepSeek HTTP ${r.status}`);
    const obj = await r.json();
    const content = obj?.choices?.[0]?.message?.content || '';
    if (!content.trim()) throw new Error('Empty AI result');
    return JSON.parse(content);
  } finally {
    clearTimeout(timer);
  }
}

async function scoreTranslation(body, env) {
  const { direction, source, reference, answer } = body || {};
  if (!source || !reference || !answer) throw new Error('Missing fields');
  const sys = `你是考研英语一翻译阅卷老师。评分要宽松但有标准：同义改写和自然语序不扣机械分；误译、漏译逻辑关系、否定、修饰对象、主干关系要明确扣分。只返回JSON。`;
  const user = `方向:${direction}\n原题:${source}\n参考答案:${reference}\n学生答案:${answer}\n返回JSON格式：{"score":0-100,"semantic":0-100,"logic":0-100,"expression":0-100,"strengths":["最多2条"],"issues":["最多3条"],"suggestion":"一句最有用的修改建议","acceptable":true/false}。`;
  return deepseek([{ role: 'system', content: sys }, { role: 'user', content: user }], env, 1200);
}

async function dailyPlan(body, env) {
  const fresh = Array.isArray(body?.new_word_candidates) ? body.new_word_candidates.slice(0, 70) : [];
  const review = Array.isArray(body?.review_candidates) ? body.review_candidates.slice(0, 40) : [];
  const sentences = Array.isArray(body?.sentence_candidates) ? body.sentence_candidates.slice(0, 10) : [];
  const sys = `你是100天考研英语训练计划器。只能从候选ID中选择，不得创建新ID。优先顺序：到期复习>刚做错>掌握度低>高频词；但保持高:中:低约5:3:2。句子优先覆盖用户近期错误类型。只返回JSON。`;
  const user = `第${body?.day || 1}天。新词候选=${JSON.stringify(fresh)}\n复习候选=${JSON.stringify(review)}\n句子候选=${JSON.stringify(sentences)}\n弱项=${JSON.stringify(body?.weak_tags || [])}\n返回JSON：{"new_word_ids":[恰好30个候选id，尽量高15中9低6],"review_ids":[最多10个候选id],"sentence_ids":[最多6个候选id，优先每种pool各2个],"reason":"一句话"}`;
  const out = await deepseek([{ role: 'system', content: sys }, { role: 'user', content: user }], env, 1000);
  const freshIds = new Set(fresh.map(x => x.id));
  const reviewIds = new Set(review.map(x => x.id));
  const sentenceIds = new Set(sentences.map(x => x.id));
  out.new_word_ids = (out.new_word_ids || []).filter(x => freshIds.has(x)).slice(0, 30);
  out.review_ids = (out.review_ids || []).filter(x => reviewIds.has(x)).slice(0, 10);
  out.sentence_ids = (out.sentence_ids || []).filter(x => sentenceIds.has(x)).slice(0, 6);
  return out;
}
