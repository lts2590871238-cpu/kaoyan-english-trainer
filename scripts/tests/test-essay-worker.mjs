import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';

// Import the actual Worker ESM source: no real network or Cloudflare credentials.
const source=fs.readFileSync(new URL('../../worker/deepseek-worker.js',import.meta.url),'utf8');
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const requests=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=async (url,options)=>{
  requests.push({url:String(url),options});
  assert(String(url).startsWith('https://api.deepseek.com/'));
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({
    score:14,overall:'论证清晰；一处用词可以改善',
    dimensions:{task:4,organization:3,language:4,format:4},
    strengths:['切题'],issues:[{problem:'搭配问题',quote:'I very like it.',reason:'语序有误',revision:'I like it very much.'}],
    next_step:'进一步优化搭配',revised_sample:'I like it very much.'
  })}}]}),{status:200,headers:{'content-type':'application/json'}});
};
const db={
  prepare(sql){
    return {
      bind(...vals){
        return {
          async first(){
            if(sql.includes('FROM sessions'))return {id:'test-id',username:'t',display_name:'T',challenge_start:'2026-10-01',created_at:1,expires_at:Date.now()+50000};
            if(sql.includes('FROM auth_rate'))return {attempts:0};
            return null;
          },
          async run(){return {success:true}},
          async all(){return {results:[]}}
        };
      }
    };
  },
  async batch(stmts){return stmts.map(()=>({success:true}))}
};
const env={DB:db,AUTH_PEPPER:'a-private-test-only-secret',DEEPSEEK_API_KEY:'not-a-real-key',ALLOWED_ORIGIN:'https://example.github.io',DEEPSEEK_MODEL:'deepseek-v4-flash'};
const headers={'Origin':'https://example.github.io','Authorization':'Bearer test-session','Content-Type':'application/json'};
async function call(path,body,options={}){
  const res=await worker.fetch(new Request('https://worker.invalid'+path,{method:'POST',headers:{...headers,...options.headers},body:JSON.stringify(body)}),env);
  return {status:res.status,data:await res.json()};
}
const essay='Many young people now read books online, which can improve their knowledge. Reading provides access to a wide range of ideas. However, it requires self-discipline to stay focused and to avoid distractions. We should develop a consistent reading habit, share recommendations with classmates, and make good use of digital resources. In this way, technology can support, rather than replace, the joy of reading.';
for(const [part,year,max] of [['A',2010,10],['B',2025,20],['A',2026,10],['B',2026,20]]){
  const out=await call('/score-essay',{paper_id:year+'_'+part,year,part,title:'示例',prompt:'Write an English composition based on the assignment instructions and the provided picture.',visual_context:'original exam picture',essay});
  assert.equal(out.status,200,JSON.stringify(out));
  assert(out.data.ok);
  assert(out.data.review.score<=max);
  assert.equal(out.data.review.band,part==='A'?'第五档':'第四档');
  assert(out.data.review.issues.length===1);
}
assert.equal(requests.length,4);
const unauthorized=await call('/score-essay',{paper_id:'2025_B',part:'B',prompt:'some prompt long enough',essay},{headers:{Authorization:''}});
assert.equal(unauthorized.status,401);
const malicious=await call('/score-essay',{paper_id:'2025_A_BAD',part:'A',prompt:'some prompt long enough',essay});
assert.equal(malicious.status,400);
// A valid essay chunk key must be recognized by the existing D1 sync API.
const saved=await call('/sync/push',{chunks:[
  {key:'essay:2026_B:24cead6f-ae57-4137-889a-2f0b05bcdedf',data:{paperId:'2026_B',record:{id:'24cead6f-ae57-4137-889a-2f0b05bcdedf',text:essay}}}
]});
assert.equal(saved.status,200,JSON.stringify(saved));
assert.equal(saved.data.written,1,'essay chunk was rejected by worker');

let seenVision=null;
env.AI={run:async(model,params)=>{
  seenVision={model,params};
  return {choices:[{message:{content:"Here is an uncorected handwritten sentence."}}]};
}};
const photo='data:image/jpeg;base64,'+'A'.repeat(1800);
const recognized=await call('/ocr-essay',{paper_id:'2026_B',image_data:photo});
assert.equal(recognized.status,200,JSON.stringify(recognized));
assert.equal(recognized.data.review_required,true);
assert.match(recognized.data.text,/uncorected/);
assert.equal(seenVision.model,'@cf/google/gemma-4-26b-a4b-it');
assert(seenVision.params.messages[1].content.some(x=>x.type==='image_url'),'image not sent to vision model');
const invalidPhoto=await call('/ocr-essay',{paper_id:'2026_B',image_data:'https://example.com/private.jpg'});
assert.equal(invalidPhoto.status,400,'remote URL must not be accepted');
const noAuthPhoto=await call('/ocr-essay',{paper_id:'2026_B',image_data:photo},{headers:{Authorization:''}});
assert.equal(noAuthPhoto.status,401);
delete env.AI;
const notConfigured=await call('/ocr-essay',{paper_id:'2026_B',image_data:photo});
assert.equal(notConfigured.status,503,'missing AI binding must be an explicit error');
assert.equal(notConfigured.data.error.code,'ocr_not_configured');

globalThis.fetch=originalFetch;
console.log('PASS essay Worker: authenticated rubric A/B, validation, and independent D1 essay chunk storage');
