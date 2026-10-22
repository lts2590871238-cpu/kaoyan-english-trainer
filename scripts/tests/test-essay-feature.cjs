'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.json':'application/json'};
const srv=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});
const cloudByUser=new Map();
function installMock(context,user){
  const chunks=cloudByUser.get(user.id)||new Map();
  cloudByUser.set(user.id,chunks);
  return context.route('https://xuanxuan-english-ai.lts2590871238.workers.dev/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/auth/me')return route.fulfill({json:{ok:true,user}});
    if(url.pathname==='/sync/pull')return route.fulfill({json:{ok:true,chunks:Object.fromEntries(Array.from(chunks.entries()).map(([k,v])=>[k,{data:v,updated_at:Date.now()}]))}});
    if(url.pathname==='/sync/push'){
      const batch=route.request().postDataJSON().chunks;
      assert(batch.length<=48,'batch over server limit');
      for(const x of batch)chunks.set(x.key,x.data);
      return route.fulfill({json:{ok:true,written:batch.length}});
    }
    if(url.pathname==='/ocr-essay'){
      const payload=route.request().postDataJSON();
      assert.match(payload.image_data,/^data:image\/jpeg;base64,/);
      assert.equal(payload.paper_id,'2026_B');
      return route.fulfill({json:{ok:true,text:'Here is my handwritten essay with a speling mistake.',review_required:true}});
    }
    if(url.pathname==='/score-essay'){
      gradeCalls++;
      return route.fulfill({json:{ok:true,review:{score:8,band:'第四档',overall:'任务完整，语法可进一步改进',dimensions:{task:4,organization:4,language:3,format:4},strengths:['覆盖任务'],issues:[{problem:'搭配问题',quote:'I very like it.',reason:'副词位置不当',revision:'I like it very much.'}],next_step:'修正搭配，检查论证',revised_sample:'I like it very much.'}}});
    }
    return route.fulfill({json:{ok:true}});
  });
}
async function waitCloud(id,count){
  const deadline=Date.now()+17000;
  while(Date.now()<deadline){
    const got=[...(cloudByUser.get(id)||new Map()).keys()].filter(k=>k.startsWith('essay:2010_A:')).length;
    if(got>=count)return;
    await new Promise(r=>setTimeout(r,150));
  }
  throw new Error('cloud did not retain '+count+' independent attempts');
}
let gradeCalls=0;
async function testBrowser(browser,base,device){
  const user={id:'essay-test-'+device,username:'tester',display_name:'作文测试',challenge_start:'2026-10-01',created_at:Date.now()};
  const context=await browser.newContext(device==='phone'?{viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1}:{viewport:{width:1280,height:840}});
  await context.addInitScript(data=>{localStorage.setItem('xuanxuan50_auth_v1',JSON.stringify({token:'test-session',user:data,expires_at:Date.now()+86400000}));},user);
  await installMock(context,user);
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/#essay',{waitUntil:'load'});
  await page.locator('.essay-banner').waitFor({timeout:20000});
  assert.equal(await page.locator('.essay-paper').count(),44,'44 years/parts must be listed');
  assert.equal(await page.locator('.essay-year').count(),22,'22 annual sections must exist');
  await page.goto(base+'/#essay/2010_A');
  await page.locator('#essayInput').waitFor();
  assert.match(await page.locator('.essay-heading').innerText(),/2010.*志愿者/);
  assert.match(await page.locator('.essay-type').innerText(),/通知/);
  const first='I am writing to invite volunteers for an international conference. Applicants should communicate well in English, work responsibly and attend the training. Please send your application to the office before Friday. Thank you very much for your support.';
  await page.locator('#essayInput').fill(first);
  await page.waitForTimeout(1000);
  await page.goto(base+'/#essay');
  await page.locator('.essay-banner').waitFor();
  await page.goto(base+'/#essay/2010_A');
  await page.locator('#essayInput').waitFor();
  assert.equal(await page.locator('#essayInput').inputValue(),first,'draft was lost after routing');
  await page.locator('#essayGrade').click();
  await page.locator('.essay-grade').waitFor({timeout:15000});
  assert.match(await page.locator('.essay-grade').innerText(),/8 \/ 10/);
  const second='The association will recruit helpful and responsible volunteers. Applicants need spoken English and enough time to assist visiting scholars. Interested students are welcome to register at our office before Friday. We look forward to meeting you.';
  await page.locator('#essayInput').fill(second);
  await page.locator('#essayGrade').click();
  await page.locator('.essay-grade').waitFor();
  await page.goto(base+'/#essay-history/2010_A');
  await page.locator('.essay-history-card').first().waitFor();
  assert.equal(await page.locator('.essay-history-card').count(),2,'two full attempts are not preserved');
  await page.locator('[data-expand]').first().click();
  assert.match(await page.locator('.essay-history-card pre').first().innerText(),/recruit helpful/);
  await page.locator('[data-expand]').nth(1).click();
  assert.match(await page.locator('.essay-history-card pre').nth(1).innerText(),/international conference/);
  await page.goto(base+'/#essay/2025_B');
  await page.locator('#essayInput').waitFor();
  assert.match(await page.locator('.essay-image-summary').innerText(),/2014.*2017.*2020.*2023/);
  assert.match(await page.locator('.essay-image-summary').innerText(),/每百户/);
  await page.locator('#essayOriginalImage').waitFor();
  await page.locator('#essayOpenImage').click();
  await page.locator('#essayLightbox').waitFor();
  await page.locator('#essayLightbox img').waitFor({state:'visible',timeout:10000});
  assert(await page.locator('#essayLightbox img').isVisible(),'original paper did not expand');
  await page.locator('#essayCloseImage').click();
  assert.equal(await page.locator('#essayLightbox').count(),0,'return-from-image button did not close overlay');
  await page.goto(base+'/#essay/2010_A');
  await page.locator('#essayOpenImage').waitFor();
  assert(await page.locator('#essayOriginalImage').isVisible(),'Part A also needs original source image');
  await page.goto(base+'/#essay/2025_B');
  await page.locator('#essayInput').waitFor();
  await page.goto(base+'/#essay/2026_A');
  await page.locator('#essayInput').waitFor();
  assert.match(await page.locator('.essay-heading').innerText(),/2026.*手写书信/);
  assert.match(await page.locator('.essay-question').innerText(),/Hi Li Ming.*Chinese families.*public display/s);
  assert(await page.locator('#essayOriginalImage').isVisible(),'2026 Part A original scan must show');
  await page.goto(base+'/#essay/2026_B');
  await page.locator('#essayInput').waitFor();
  const chartInfo=await page.locator('.essay-image-summary').innerText();
  for(const number of ['39.3%','32.8%','27.9%','46.30%','24.90%','10.70%'])assert(chartInfo.includes(number),'missing real chart value '+number);
  assert.equal(await page.locator('#essayOriginalImage').evaluate(el=>el.naturalWidth>100),true,'2026 scan image missing');
  await page.locator('#essayOpenImage').click();
  await page.locator('#essayLightbox img').waitFor({state:'visible',timeout:10000});
  await page.locator('#essayCloseImage').click();
  assert.equal(await page.locator('#essayLightbox').count(),0,'2026 enlarged image did not close');
  const essayBefore=await page.locator('#essayInput').inputValue();
  assert.equal(essayBefore,'','OCR test begins with untouched blank draft');
  await page.locator('#essayPhoto').setInputFiles(path.join(root,'essay-scans','2026.jpg'));
  await page.locator('.essay-photo').first().waitFor();
  await page.locator('#essayScan').click();
  await page.locator('#essayOCRReview').waitFor({state:'visible',timeout:20000});
  assert.match(await page.locator('#essayOCRText').inputValue(),/speling mistake/);
  assert.equal(await page.locator('#essayInput').inputValue(),'','recognition must not overwrite the essay before approval');
  await page.locator('#essayOCRText').fill('Here is my edited handwritten essay.');
  await page.locator('#essayUseOCR').click();
  assert.equal(await page.locator('#essayInput').inputValue(),'Here is my edited handwritten essay.');
  await page.goto(base+'/#essay');
  await page.locator('.essay-banner').waitFor();
  await page.goto(base+'/#essay/2026_B');
  await page.locator('#essayInput').waitFor();
  assert.equal(await page.locator('#essayInput').inputValue(),'Here is my edited handwritten essay.','OCR corrected text draft was not preserved');
  await page.screenshot({path:path.join(root,'test-results','essay-'+device+'.png'),fullPage:true});
  const overflow=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}));
  assert(overflow.scroll<=overflow.viewport+3,device+' has horizontal overflow '+JSON.stringify(overflow));
  assert.deepEqual(errors,[],device+' page JS errors: '+errors.join(' | '));
  await waitCloud(user.id,2);
  // A fresh browser/device must restore both immutable records from the cloud.
  const fresh=await browser.newContext({viewport:{width:414,height:896}});
  await fresh.addInitScript(data=>{localStorage.setItem('xuanxuan50_auth_v1',JSON.stringify({token:'test-session',user:data,expires_at:Date.now()+86400000}));},user);
  await installMock(fresh,user);
  const other=await fresh.newPage();
  await other.goto(base+'/#essay-history/2010_A',{waitUntil:'load'});
  await other.locator('.essay-history-card').first().waitFor({timeout:15000});
  assert.equal(await other.locator('.essay-history-card').count(),2,'cross-device cloud restore lost a revision');
  await fresh.close();
  await context.close();
  console.log('PASS '+device+' annual list, years, drafts, scoring, two immutable versions, chart facts, viewport');
}
(async()=>{
  await new Promise(resolve=>srv.listen(0,'127.0.0.1',resolve));
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  const base='http://127.0.0.1:'+srv.address().port;
  const browser=await chromium.launch({headless:true});
  try{
    await testBrowser(browser,base,'desktop');
    await testBrowser(browser,base,'phone');
    assert.equal(gradeCalls,4,'each of two attempts from two devices should score once');
  }finally{
    await browser.close();
    await new Promise(resolve=>srv.close(resolve));
  }
})().catch(err=>{console.error(err);process.exitCode=1;srv.close();});
