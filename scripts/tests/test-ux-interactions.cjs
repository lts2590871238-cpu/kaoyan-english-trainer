'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const original=fs.readFileSync(path.join(root,'app.js'),'utf8');
const anchor="  window.addEventListener('hashchange',route);";
assert(original.includes(anchor),'app test instrumentation anchor not found');
const instrumented=original.replace(anchor,"  if(window.__UX_TEST_MODE__)window.__UX_TEST__={Store,Data,wordsPage,analysisPage,Sound,Drafts};\n"+anchor);
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html'};
const srv=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/harness'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/v21.css"><link rel="stylesheet" href="/v22.css"><div id="app"></div><script>window.__UX_TEST_MODE__=true;</script><script src="/instrumented-app.js"></script></html>');return;}
  if(url.pathname==='/instrumented-app.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(instrumented);return;}
  const file=path.resolve(root,'.'+url.pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});
function fixtures(){
  const words=Array.from({length:30},(_,i)=>'word'+String(i+1).padStart(2,'0'));
  const entries=words.map((t,i)=>[t,{term:t,sense_zh:'中文释义'+(i+1)}]);
  const tokens=['The','new','rules','can','improve','our','daily','work',',','and','they','help','students','.'];
  const analysis={
    id:'test-precise',stage:'precise',en:'The new rules can improve our daily work, and they help students.',
    zh:'新规则可以改进工作，也能帮助学生。',tokens,
    groups:[
      {label:'主语',token_indices:[0,1,2],note:'主语'},
      {label:'谓语',token_indices:[3,4],note:'谓语'},
      {label:'宾语',token_indices:[5,6,7],note:'宾语'},
      {label:'并列结构',token_indices:[9,10,11,12],note:'并列结构'}
    ],
    abridged_en:'The rules improve work.',main_stem_zh:'规则改进工作。'
  };
  const s={en:analysis.en,zh:analysis.zh,year:2023,pool:'analysis'};
  return {words,lexIndex:{byTerm:new Map(entries),byForm:new Map()},analysis:{'test-precise':analysis},sentences:{'test-precise':s}};
}
async function setup(page){
  await page.goto(page.__testUrl,{waitUntil:'load'});
  await page.waitForFunction(()=>!!window.__UX_TEST__&&!!window.__UX_TEST__.Store.state);
  await page.evaluate(()=>{
    const h=window.__UX_TEST__,state=h.Store.fresh();
    h.Store.state=state;state.currentDay=2;state.sound=false;
    const words=Array.from({length:30},(_,i)=>'word'+String(i+1).padStart(2,'0'));
    const byTerm=new Map(words.map((t,i)=>[t,{term:t,sense_zh:'中文释义'+(i+1)}]));
    const a={id:'test-precise',stage:'precise',en:'The new rules can improve our daily work, and they help students.',zh:'新规则可以改进工作，也能帮助学生。',tokens:['The','new','rules','can','improve','our','daily','work',',','and','they','help','students','.'],groups:[{label:'主语',token_indices:[0,1,2],note:'主语'},{label:'谓语',token_indices:[3,4],note:'谓语'},{label:'宾语',token_indices:[5,6,7],note:'宾语'},{label:'并列结构',token_indices:[9,10,11,12],note:'并列结构'}],abridged_en:'The rules improve work.',main_stem_zh:'规则改进工作。'};
    const d={lexIndex:{byTerm,byForm:new Map()},analysis:{'test-precise':a},sentences:{'test-precise':{en:a.en,zh:a.zh,year:2023,pool:'analysis'}}};
    state.plans[2]={words,en_to_zh:[],zh_to_en:[],focus:['test-precise'],focusType:'analysis',review:[],reviewDate:'2026-10-09'};
    h.Data.full=async()=>d;
    h.Sound.preload=()=>{};h.Sound.sfx=()=>{};h.Sound.speak=async()=>{};
    h.Store.save();
    window.__UX_FIXTURE__=d;
  });
}
async function wordFlow(page,name){
  await page.evaluate(()=>window.__UX_TEST__.wordsPage({flow:true}));
  await page.locator('#submitMatches').waitFor();
  assert.equal(await page.locator('#submitMatches').isDisabled(),true,'premature word submission enabled');
  async function select(en,zh){
    await page.locator('.eng[data-term="'+en+'"]').click();
    await page.locator('.zh[data-term="'+zh+'"]').click();
  }
  await select('word01','word02');
  let before=await page.evaluate(()=>{const st=window.__UX_TEST__.Store.state;return {progress:st.days[2].wordsDone.length,wrong:Object.keys(st.errorDays||{}).length,word:Object.keys(st.words).length};});
  assert.equal(before.progress,0);
  assert.equal(before.word,0,'guessing before submit must not update word memory');
  await select('word01','word01');
  for(let i=2;i<=10;i++){
    const en='word'+String(i).padStart(2,'0');
    await select(en,en);
  }
  const pairDiagnostic=await page.evaluate(()=>({
    label:document.querySelector('#wordMatchCount')?.textContent,
    pairs:window.__UX_TEST__.Drafts.get('word-match','round-1-'+window.__UX_TEST__.Store.state.plans[2].words.slice(0,10).join('|'))?.pairs,
    selected:document.querySelector('.eng.selected')?.dataset.term,
    viewport:innerWidth
  }));
  assert.equal(await page.locator('#submitMatches').isEnabled(),true,'word pair state: '+JSON.stringify(pairDiagnostic));
  await page.evaluate(()=>window.__UX_TEST__.wordsPage({flow:true}));
  assert.equal(await page.locator('.match-item.paired').count(),20,'unfinished word pairing not restored from draft');
  assert.equal(await page.locator('#submitMatches').isEnabled(),true);
  // Make one deliberate final error by swapping two pairs; no mistake before submission counts.
  await select('word09','word10');
  await select('word10','word09');
  assert.equal(await page.locator('#submitMatches').isEnabled(),true);
  assert.equal((await page.evaluate(()=>Object.keys(window.__UX_TEST__.Store.state.words).length)),0);
  await page.locator('#submitMatches').click();
  const r=await page.evaluate(()=>{const st=window.__UX_TEST__.Store.state;return {done:st.days[2].wordsDone.length,wrong:st.words.word09.wrong+st.words.word10.wrong,attempts:Object.values(st.words).reduce((n,x)=>n+x.attempts,0),errors:st.errorDays};});
  assert.equal(r.done,10);assert.equal(r.wrong,2);assert.equal(r.attempts,10);
  assert.match(await page.locator('#wordMatchFb').innerText(),/8\/10/);
  await page.locator('#nextRound').click();
  for(let round=1;round<=2;round++){
    for(let i=round*10+1;i<=round*10+10;i++){const t='word'+String(i).padStart(2,'0');await select(t,t);}
    await page.locator('#submitMatches').click();
    if(round===1)await page.locator('#nextRound').click();
  }
  assert.equal((await page.evaluate(()=>window.__UX_TEST__.Store.state.days[2].wordsDone.length)),30);
  assert.equal((await page.evaluate(()=>Object.values(window.__UX_TEST__.Store.state.words).reduce((n,x)=>n+x.attempts,0))),30);
  await page.screenshot({path:path.join('test-results','word-match-'+name+'.png'),fullPage:true});
  console.log('PASS '+name+' word matching: change before submit, drafts, score once, 30 words');
}
async function analysisFlow(page,name){
  await page.evaluate(()=>window.__UX_TEST__.analysisPage(window.__UX_FIXTURE__,window.__UX_TEST__.Store.state.plans[2],{flow:true}));
  const token=(i)=>page.locator('.analysis-token-bank .a-token[data-ti="'+i+'"]');
  const zone=(i)=>page.locator('.analysis-group-zone[data-zone="'+i+'"]');
  await page.locator('#rangeA').click();
  await token(0).click();await token(2).click();
  assert.match(await page.locator('#selectedAStatus').innerText(),/已选 3/);
  await zone(0).click();
  assert.equal((await page.evaluate(()=>Object.keys(window.__UX_TEST__.Store.state.drafts['2:analysis:test-precise'].assign).length)),3);
  await token(3).click();await token(4).click();
  await token(3).dragTo(zone(1));
  assert.equal((await page.evaluate(()=>Object.keys(window.__UX_TEST__.Store.state.drafts['2:analysis:test-precise'].assign).length)),5);
  await token(5).click();await token(7).click({modifiers:['Shift']});
  await zone(2).click();
  await page.evaluate(()=>window.__UX_TEST__.analysisPage(window.__UX_FIXTURE__,window.__UX_TEST__.Store.state.plans[2],{flow:true}));
  assert.match(await page.locator('#analysisRemain').innerText(),/8\/12/);
  await page.locator('#rangeA').click();
  await token(9).click();await token(12).click();
  await zone(3).click();
  assert.match(await page.locator('#analysisRemain').innerText(),/所有词都已归类/);
  await zone(3).locator('[data-unassign]').first().click();
  assert.match(await page.locator('#analysisRemain').innerText(),/4 个词/);
  await page.locator('#rangeA').click();
  await token(9).click();await token(12).click();await zone(3).click();
  assert.equal((await page.evaluate(()=>Object.keys(window.__UX_TEST__.Store.state.sentences).length)),0,'draft analysis must not be graded');
  await page.locator('#checkA').click();
  assert.match(await page.locator('#analysisFb').innerText(),/100%/);
  const score=await page.evaluate(()=>window.__UX_TEST__.Store.state.sentences['test-precise']?.lastScore);
  assert.equal(score,100);
  const over=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
  assert.ok(over<=8,'page has horizontal overflow '+over);
  await page.screenshot({path:path.join('test-results','sentence-analysis-'+name+'.png'),fullPage:true});
  console.log('PASS '+name+' sentence analysis: multi-select, range, drag group, unassign, grade');
}
(async()=>{
  fs.mkdirSync('test-results',{recursive:true});
  await new Promise(resolve=>srv.listen(0,'127.0.0.1',resolve));
  const port=srv.address().port,base='http://127.0.0.1:'+port+'/harness';
  const browser=await chromium.launch({headless:true});
  try{
    for(const size of [{name:'desktop',width:1280,height:850},{name:'phone',width:390,height:844}]){
      const page=await browser.newPage({viewport:size});page.__testUrl=base;
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await setup(page);await wordFlow(page,size.name);
      // Use a fresh local state for the sentence test
      await setup(page);await analysisFlow(page,size.name);
      assert.deepEqual(errors,[],'uncaught JS errors: '+size.name);
      await page.close();
    }
  }finally{await browser.close();srv.close()}
})().catch(e=>{console.error(e);process.exitCode=1;srv.close()});
