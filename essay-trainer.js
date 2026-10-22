/* 独立历年作文训练模块；复用主站账号及 Store/CloudSync，绝不修改原学习流程。 */
(function () {
  "use strict";
  var catalog = (window.KAOYAN_ESSAY_PAPERS && window.KAOYAN_ESSAY_PAPERS.records) || [];
  var byId = Object.fromEntries(catalog.map(function (x) { return [x.id, x]; }));
  var context = null, debounce = null, activeId = "", queryFilter = "all";
  var e = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); };
  var count = function (s) { return (String(s || "").match(/[A-Za-z]+(?:[-’'][A-Za-z]+)*/g) || []).length; };
  var get = function(id) { return byId[id] || null; };
  var stamp = function(v) { return v ? new Date(v).toLocaleString("zh-CN", {hour12:false}) : "—"; };
  var history = function(id) { var h = context.state().essayHistory || {}; return Array.isArray(h[id]) ? h[id] : []; };
  var work = function(id) { return String((context.state().essayWork || {})[id] || ""); };
  var total = function() { return Object.values(context.state().essayHistory || {}).reduce(function(n,a){return n + (Array.isArray(a)?a.length:0);},0); };
  function archiveAttempt(id,text,review) {
    var st=context.state();st.essayHistory ||= {};st.essayHistory[id] ||= [];
    var record={
      id:(crypto.randomUUID?crypto.randomUUID():String(Date.now())+"-"+Math.random().toString(36).slice(2)),
      createdAt:Date.now(),text:text,words:count(text),review:review||null
    };
    st.essayHistory[id].push(record);context.save();return record;
  }
  function archiveIfNew(id,text){
    if(!String(text).trim())return false;
    var h=history(id);if(h.length&&h[h.length-1].text===text)return false;
    archiveAttempt(id,text,null);return true;
  }
  function saveDraft(id,text) {
    var st=context.state(); st.essayWork ||= {}; st.essayWork[id]=text;
    context.save();
  }
  function go(hash){ location.hash=hash; }
  function top(title,back) {
    return '<nav class="essay-crumb"><a href="'+back+'">← 返回</a><strong>'+e(title)+'</strong><a href="#dashboard">学习首页</a></nav>';
  }
  function box(inner) {
    context.shell('<main class="essay-page"><div class="essay-frame">'+inner+'</div></main>');
  }
  function listPage() {
    activeId="";
    var rows = catalog.filter(function(p){ return queryFilter==="all" || p.part===queryFilter; });
    var marks=[];
    for(var y=2026;y>=2005;y--){
      var ps=rows.filter(function(p){return p.year===y;});
      if(!ps.length)continue;
      marks.push('<section class="essay-year"><header>'+y+' 年<span>英语（一）历年真题</span></header><div class="essay-year-papers">'+ps.map(function(p){
        var n=history(p.id).length;
        return '<a class="essay-paper" href="#essay/'+e(p.id)+'"><span class="essay-part">'+(p.part==="A"?"小作文 · Part A":"大作文 · Part B")+'</span><strong>'+e(p.title)+'</strong><small>'+e(p.type)+' · 满分 '+p.max_score+' 分</small><span class="essay-attempt">'+(n?("已保存 "+n+" 次"):"开始练习")+' →</span></a>';
      }).join("")+'</div></section>');
    }
    box(top("历年考研作文","#dashboard")+
      '<section class="essay-banner"><span>2005—2026 · 英语（一）</span><h1>历年考研作文</h1><p>44 道原题 · 小作文 10 分 · 大作文 20 分。每次写作独立保存，DeepSeek 按大纲分档进行模拟阅卷。</p><div class="essay-summary"><b>22 年</b><b>42 题</b><b>'+total()+' 次记录</b></div></section>'+
      '<section class="essay-filter"><label for="essayFilter">筛选题型</label><select id="essayFilter"><option value="all">全部大小作文</option><option value="A">只看小作文</option><option value="B">只看大作文</option></select><button class="essay-soft" id="essayExport">导出全部记录</button></section>'+
      '<div class="essay-catalog">'+marks.join("")+'</div><p class="essay-fineprint">提示：题型按原卷标注。2010 年小作文是招募志愿者通知，并非建议信。AI 分数用于练习反馈，不是官方阅卷结果。</p>');
    document.getElementById("essayFilter").value=queryFilter;
    document.getElementById("essayFilter").onchange=function(ev){queryFilter=ev.target.value;listPage();};
    document.getElementById("essayExport").onclick=download;
  }
  function picture(p) {
    return '<section class="essay-visual"><h3>原题扫描（Part A / Part B 同页）</h3>'+
      '<button type="button" class="essay-image-open" id="essayOpenImage" aria-label="放大查看本年原题扫描页">'+
      '<img id="essayOriginalImage" src="essay-scans/'+p.year+'.jpg" alt="'+p.year+'年考研英语一写作原题完整扫描页" loading="eager"></button>'+
      '<p id="essayImageStatus" class="essay-img-note">点击原题图片可全屏放大，关闭后直接返回写作页。</p>'+
      (p.part==="B"?'<p class="essay-image-summary">审题核对：'+e(p.visual_description||"以原始试卷为准")+'</p>':"")+
      '</section>';
  }
  function imageStatus(){
    var im=document.getElementById("essayOriginalImage"),t=document.getElementById("essayImageStatus"),
      btn=document.getElementById("essayOpenImage");
    if(!im||!t||!btn)return;
    im.onerror=function(){
      btn.hidden=true;t.textContent="本题扫描图暂未加载，原题英文正文仍可正常练习；大作文请核对交接包原图后再正式评分。";
      t.classList.add("essay-warning");
    };
    im.onload=function(){
      btn.hidden=false;t.textContent="原卷扫描已加载，点击图片放大查看，再点“返回写作”继续。";
    };
    btn.onclick=function(){
      if(!im.naturalWidth)return;
      var old=document.getElementById("essayLightbox");
      if(old)old.remove();
      var box=document.createElement("div");
      box.className="essay-lightbox";box.id="essayLightbox";box.setAttribute("role","dialog");
      box.setAttribute("aria-modal","true");box.setAttribute("aria-label","原题图片放大");
      box.innerHTML='<button type="button" id="essayCloseImage" class="essay-lightbox-close">← 返回写作</button>'+
        '<img src="'+im.src+'" alt="'+e(im.alt)+'">';
      document.body.appendChild(box);
      var close=function(){box.remove();document.removeEventListener("keydown",onKey);btn.focus();};
      var onKey=function(ev){if(ev.key==="Escape")close();};
      document.getElementById("essayCloseImage").onclick=close;
      box.addEventListener("click",function(ev){if(ev.target===box)close();});
      document.addEventListener("keydown",onKey);
      document.getElementById("essayCloseImage").focus();
    };
    if(im.complete){if(im.naturalWidth)im.onload();else im.onerror();}
  }
  function editorPage(id) {
    var p=get(id);if(!p)return go("#essay");
    activeId=id;
    var text=work(id),items=history(id),w=count(text);
    box(top(p.year+" "+(p.part==="A"?"小作文":"大作文"),"#essay")+
      '<section class="essay-heading"><div><span class="essay-type">'+e(p.type)+'</span><h1>'+p.year+' 年 '+e(p.title)+'</h1><p>Part '+p.part+' · '+e(p.word_target)+' · 满分 '+p.max_score+' 分</p></div><a href="#essay-history/'+e(id)+'" class="essay-soft">历史记录（'+items.length+'）</a></section>'+
      '<section class="essay-question"><h2>原题 Directions</h2><p lang="en">'+e(p.prompt_en)+'</p>'+picture(p)+'</section>'+
      '<section class="essay-answer"><div class="essay-flex"><h2>我的作文</h2><span id="essayWords">当前 '+w+' 词 · '+e(p.word_target)+'</span></div>'+
      '<textarea id="essayInput" aria-label="输入英语作文" spellcheck="true" autocapitalize="sentences" placeholder="在这里输入你的作文……可以分段，输入内容会自动保存。">'+e(text)+'</textarea>'+
      '<p id="essaySaveStatus" class="essay-save">草稿自动保存在当前账号，也会随原网站学习进度同步。</p>'+
      '<div class="essay-toolbar"><button id="essaySave" class="essay-soft">保存草稿</button><button id="essayArchive" class="essay-soft">保存这一稿到历史</button><button id="essayNew" class="essay-soft">重新写一篇</button><button id="essayGrade" class="essay-main">保存本次作文并用 DeepSeek 评分</button></div>'+
      '<div id="essayFeedback" role="status" aria-live="polite"></div></section>'+
      '<p class="essay-fineprint">评分参考英语（一）写作五档标准：内容与任务完成、组织衔接、语言准确与多样性；小作文额外检查格式和语域。书写字迹无法在线评估。每次提交都会留下独立记录。</p>');
    var ta=document.getElementById("essayInput"),sv=document.getElementById("essaySaveStatus");
    ta.addEventListener("input",function(){
      document.getElementById("essayWords").textContent="当前 "+count(ta.value)+" 词 · "+p.word_target;
      sv.textContent="正在保存草稿…";
      clearTimeout(debounce);debounce=setTimeout(function(){saveDraft(id,ta.value);sv.textContent="草稿已保存 · "+stamp(Date.now());},500);
    });
    ta.addEventListener("blur",function(){clearTimeout(debounce);saveDraft(id,ta.value);sv.textContent="草稿已保存";});
    document.getElementById("essaySave").onclick=function(){saveDraft(id,ta.value);sv.textContent="草稿已保存 · "+stamp(Date.now());};
    document.getElementById("essayArchive").onclick=function(){
      if(!ta.value.trim()){sv.textContent="先写入作文，再保存为一稿。";return;}
      var rec=archiveAttempt(id,ta.value,null);
      sv.textContent="已保存为独立历史记录 · "+stamp(rec.createdAt);
    };
    document.getElementById("essayNew").onclick=function(){
      if(ta.value.trim()&&!confirm("开始写另一稿？当前内容会先自动保存到历史，不会丢失。"))return;
      if(ta.value.trim())archiveIfNew(id,ta.value);
      ta.value="";saveDraft(id,"");ta.focus();document.getElementById("essayWords").textContent="当前 0 词 · "+p.word_target;sv.textContent="新草稿已创建；上一稿已保留";
    };
    document.getElementById("essayGrade").onclick=function(){grade(p,ta.value);};
    imageStatus();
  }
  function report(r,p) {
    if(!r)return '<p class="essay-save">本次保存成功，尚无 AI 评分。</p>';
    if(r.error)return '<p class="essay-warning">'+e(r.error)+'</p>';
    var issues=Array.isArray(r.issues)?r.issues:[];
    return '<div class="essay-report"><div class="essay-grade"><strong>'+e(r.score)+' / '+p.max_score+' 分</strong><span>'+e(r.band||"模拟评分")+'</span></div>'+
      '<p class="essay-save">'+e(r.overall||"")+'</p><div class="essay-dimensions">'+
      [["task","任务完成"],["organization","组织衔接"],["language","语言表达"],["format","格式与语域"]].map(function(pair){
        var v=r.dimensions&&r.dimensions[pair[0]];return v==null?"":'<div><small>'+pair[1]+'</small><b>'+e(v)+'</b></div>';
      }).join("")+'</div>'+
      '<h3>做得好的地方</h3><ul>'+((r.strengths||[]).map(function(s){return '<li>'+e(s)+'</li>';}).join("")||"<li>继续保持任务意识。</li>")+'</ul>'+
      '<h3>具体问题与修改</h3><ol>'+issues.map(function(x){
        if(typeof x==="string")return '<li>'+e(x)+'</li>';
        return '<li><b>'+e(x.problem||"")+'</b>'+(x.quote?'<p>原句：'+e(x.quote)+'</p>':"")+
          (x.reason?'<p>原因：'+e(x.reason)+'</p>':"")+(x.revision?'<p>修改：<span lang="en">'+e(x.revision)+'</span></p>':"")+'</li>';
      }).join("")+'</ol>'+
      '<h3>下一稿优先做</h3><p>'+e(r.next_step||"根据上述问题修改二稿。")+'</p>'+
      (r.revised_sample?'<details><summary>查看局部修改示例（不是替你重写整篇）</summary><p lang="en">'+e(r.revised_sample)+'</p></details>':"")+'</div>';
  }
  async function grade(p,essay){
    clearTimeout(debounce);saveDraft(p.id,essay);
    if(count(essay)<15){document.getElementById("essayFeedback").innerHTML='<p class="essay-warning">正文太短，至少输入可供评阅的完整语句后再提交。</p>';return;}
    var b=document.getElementById("essayGrade"),slot=document.getElementById("essayFeedback");
    if(b.disabled)return;
    var record=archiveAttempt(p.id,essay,null);
    b.disabled=true;b.textContent="DeepSeek 正在按分档标准阅卷…";
    slot.innerHTML='<p class="essay-save">本次作文已单独保存，正在获取 AI 批改结果。</p>';
    try {
      var out=await context.request("/score-essay",{paper_id:p.id,part:p.part,year:p.year,prompt:p.prompt_en,title:p.title,
        visual_context:p.part==="B"?(p.visual_description||""):"",
        essay:essay,word_count:record.words});
      record.review=out.review;
      slot.innerHTML=report(record.review,p)+'<p class="essay-save">评分和正文已经加入历史记录。</p>';
    }catch(err){
      record.review={error:"本次作文已保存，但 AI 评分失败："+String(err.message||"网络连接失败")+"。请确认 Cloudflare Worker 已发布作文评分接口。"};
      slot.innerHTML=report(record.review,p);
    }finally{context.save();b.disabled=false;b.textContent="保存本次作文并用 DeepSeek 评分";}
  }
  function historyPage(id){
    var p=get(id);if(!p)return go("#essay");
    var rows=history(id).slice().reverse();
    box(top("历史作文","#essay/"+id)+
      '<section class="essay-heading"><div><span class="essay-type">'+e(p.type)+'</span><h1>'+p.year+" · "+e(p.title)+'</h1><p>已保存 '+rows.length+' 次，每次正文和评分均独立保留。</p></div><a class="essay-main" href="#essay/'+id+'">返回写作</a></section>'+
      (rows.length?rows.map(function(r,i){return '<article class="essay-history-card"><div class="essay-flex"><div><b>第 '+(rows.length-i)+' 次 · '+e(stamp(r.createdAt))+'</b><p>'+e(r.words)+' 词 · '+(r.review&&!r.review.error?e(r.review.score)+'/'+p.max_score+" 分":r.review&&r.review.error?"评分失败":"尚未评分")+'</p></div><button class="essay-soft" data-expand="'+e(r.id)+'">查看这一次</button></div><div hidden id="essayEntry-'+e(r.id)+'"><pre lang="en">'+e(r.text)+'</pre>'+report(r.review,p)+'<button class="essay-soft" data-revise="'+e(r.id)+'">以这一稿创建新草稿</button></div></article>';}).join(""):'<section class="essay-empty">还没有保存过作文。先完成一篇，再查看历次评分。</section>'));
    document.querySelectorAll("[data-expand]").forEach(function(el){el.onclick=function(){var div=document.getElementById("essayEntry-"+el.dataset.expand);div.hidden=!div.hidden;el.textContent=div.hidden?"查看这一次":"收起";};});
    document.querySelectorAll("[data-revise]").forEach(function(el){el.onclick=function(){
      var entry=history(id).find(function(x){return x.id===el.dataset.revise;});
      if(!entry)return;if(work(id).trim()&&!confirm("覆盖当前未提交草稿并以这一稿继续修改？已提交历史不会改变。"))return;
      if(work(id).trim())archiveIfNew(id,work(id));
      saveDraft(id,entry.text);go("#essay/"+id);
    };});
  }
  function download(){
    var obj={version:1,exported_at:new Date().toISOString(),source:"kaoyan-english-trainer",history:context.state().essayHistory||{},drafts:context.state().essayWork||{}};
    var blob=new Blob([JSON.stringify(obj,null,2)],{type:"application/json;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download="考研英语一历年作文记录-"+new Date().toISOString().slice(0,10)+".json";document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1200);
  }
  window.EssayModule={
    open:function(ctx,route){
      context=ctx;
      var m=/^essay\/(\d{4}_[AB])$/.exec(route),h=/^essay-history\/(\d{4}_[AB])$/.exec(route);
      if(m)return editorPage(m[1]);
      if(h)return historyPage(h[1]);
      return listPage();
    },
    count:count
  };
})();