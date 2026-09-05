(() => {
  'use strict';
  const CFG = window.XUANXUAN_CONFIG || {};
  const APP_KEY = 'xuanxuan50_v6_state';
  const INTERVALS = [1,2,4,7,15,30,60,120];
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const todayISO = () => new Date().toISOString().slice(0,10);
  const addDays = (iso,n) => { const d=new Date(iso+'T12:00:00'); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
  const shuffle = arr => { const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
  const tokenize = s => s.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*|\d+(?:\.\d+)?|[^\w\s]/g) || [];

  const Data = {
    cache:{},
    async get(name){ if(this.cache[name]) return this.cache[name]; const r=await fetch(`data/generated/${name}.json`,{cache:'no-cache'}); if(!r.ok) throw new Error(`无法读取 ${name}`); return this.cache[name]=await r.json(); },
    async meta(){ return this.get('meta'); },
    async dictionary(){
      if(this.cache.dictionaryIndex) return this.cache.dictionaryIndex;
      const rows=await this.get('dictionary_lookup'); const byTerm=new Map(),byForm=new Map();
      rows.forEach(x=>{byTerm.set(String(x.term).toLowerCase(),x);(x.forms||[x.term]).forEach(f=>byForm.set(String(f).toLowerCase(),x));});
      return this.cache.dictionaryIndex={byTerm,byForm};
    },
    async core(){
      const [meta,lexicon,sentences,schedule]=await Promise.all([
        this.get('meta'),this.get('lexicon_index'),this.get('sentence_meta'),this.get('schedule')
      ]);
      if(!meta.ready) throw new Error('题库尚未完成构建');
      return {meta,lexicon,sentences,schedule};
    },
    async full(){
      const core=await this.core();
      const [lexicon,sentences,analysis,ctx,corpus] = await Promise.all([
        this.get('lexicon'),this.get('sentences'),this.get('analysis'),this.get('context_translations'),this.get('corpus')
      ]);
      if(!this.cache.lexIndex){
        const byTerm=new Map(), byForm=new Map();
        lexicon.forEach(x=>{byTerm.set(x.term.toLowerCase(),x); (x.forms||[x.term]).forEach(f=>byForm.set(String(f).toLowerCase(),x)); byForm.set(x.term.toLowerCase(),x);});
        this.cache.lexIndex={byTerm,byForm};
      }
      return {...core,lexicon,sentences,analysis,ctx,corpus,lexIndex:this.cache.lexIndex};
    },
    prefetch(){const go=()=>this.full().catch(()=>{}); if('requestIdleCallback' in window) requestIdleCallback(go,{timeout:2200}); else setTimeout(go,700);}
  };

  const Store = {
    state:null,
    load(){
      try{this.state=JSON.parse(localStorage.getItem(APP_KEY)||'null');}catch{this.state=null;}
      if(!this.state) this.state={version:6,currentDay:1,created:todayISO(),sound:true,music:false,accent:CFG.DEFAULT_ACCENT||'en-US',plans:{},days:{},words:{},sentences:{}};
      this.state.plans ||= {}; this.state.days ||= {}; this.state.words ||= {}; this.state.sentences ||= {};
      return this.state;
    },
    save(){localStorage.setItem(APP_KEY,JSON.stringify(this.state));},
    day(n=this.state.currentDay){return this.state.days[n] ||= {wordsDone:[],en2zhDone:[],zh2enDone:[],focusDone:[],reviewDone:[]};},
    word(term){return this.state.words[term] ||= {attempts:0,correct:0,wrong:0,stage:0,learnedDay:null,lastSeen:null,nextReview:null,contextsUsed:[]};},
    sentence(id){return this.state.sentences[id] ||= {attempts:0,correct:0,totalScore:0,module:null,lastSeen:null};}
  };
  Store.load();

  const Sound = {
    ctx:null,timer:null,musicRunning:false,quiet:false,
    context(){if(!this.ctx) this.ctx=new (window.AudioContext||window.webkitAudioContext)(); return this.ctx;},
    sfx(kind='ok'){
      if(!Store.state.sound) return; try{
        const c=this.context(), o=c.createOscillator(), g=c.createGain(); o.connect(g); g.connect(c.destination);
        const now=c.currentTime; const f=kind==='bad'?220:kind==='finish'?660:520; o.frequency.setValueAtTime(f,now); if(kind==='finish')o.frequency.exponentialRampToValueAtTime(880,now+.18);
        g.gain.setValueAtTime(.0001,now);g.gain.exponentialRampToValueAtTime(.06,now+.015);g.gain.exponentialRampToValueAtTime(.0001,now+.25);o.start(now);o.stop(now+.27);
      }catch{}
    },
    startMusic(){
      if(this.quiet||!Store.state.music||this.musicRunning)return; this.musicRunning=true;
      const notes=[261.63,329.63,392,329.63,293.66,349.23,440,349.23]; let k=0;
      const play=()=>{ if(!this.musicRunning||this.quiet)return; try{const c=this.context(),o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.value=notes[k++%notes.length];o.connect(g);g.connect(c.destination);const n=c.currentTime;g.gain.setValueAtTime(.0001,n);g.gain.exponentialRampToValueAtTime(.018,n+.08);g.gain.exponentialRampToValueAtTime(.0001,n+1.5);o.start(n);o.stop(n+1.6);}catch{}};
      play(); this.timer=setInterval(play,1700);
    },
    stopMusic(){this.musicRunning=false;if(this.timer){clearInterval(this.timer);this.timer=null;}},
    setQuiet(v){this.quiet=v; if(v)this.stopMusic(); else this.startMusic();},
    toggleMusic(){Store.state.music=!Store.state.music;Store.save();Store.state.music?this.startMusic():this.stopMusic();renderTopbarState();},
    toggleSound(){Store.state.sound=!Store.state.sound;Store.save();renderTopbarState();},
    speak(text){
      if(!('speechSynthesis' in window))return toast('当前浏览器不支持语音朗读');
      speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(text); u.lang=Store.state.accent||'en-US';u.rate=.86;u.pitch=1; speechSynthesis.speak(u);
    }
  };

  function shell(inner){
    $('#app').innerHTML=`<div class="app-shell"><header class="topbar"><div class="brand-mini">🌷 轩轩冲刺50分大作战！</div><div class="top-actions"><button id="accentBtn" class="icon-btn" title="切换英美音">${Store.state.accent==='en-GB'?'🇬🇧':'🇺🇸'}</button><button id="soundBtn" class="icon-btn" title="音效">🔔</button><button id="musicBtn" class="icon-btn" title="轻音乐">♫</button><button id="exportBtn" class="icon-btn" title="导出学习记录">↥</button><button id="importBtn" class="icon-btn" title="导入学习记录">↧</button><input id="importFile" type="file" accept="application/json" hidden></div></header>${inner}</div>`;
    bindTopbar(); renderTopbarState();
  }
  function bindTopbar(){
    $('#soundBtn')?.addEventListener('click',()=>Sound.toggleSound()); $('#musicBtn')?.addEventListener('click',()=>Sound.toggleMusic());
    $('#accentBtn')?.addEventListener('click',()=>{Store.state.accent=Store.state.accent==='en-GB'?'en-US':'en-GB';Store.save();renderTopbarState();toast(Store.state.accent==='en-GB'?'已切换英音':'已切换美音');});
    $('#exportBtn')?.addEventListener('click',exportMemory); $('#importBtn')?.addEventListener('click',()=>$('#importFile').click()); $('#importFile')?.addEventListener('change',importMemory);
  }
  function renderTopbarState(){
    const s=$('#soundBtn'),m=$('#musicBtn'),a=$('#accentBtn'); if(s)s.classList.toggle('active',Store.state.sound); if(m)m.classList.toggle('active',Store.state.music&&!Sound.quiet); if(a)a.textContent=Store.state.accent==='en-GB'?'🇬🇧':'🇺🇸';
    if(m){m.disabled=Sound.quiet;m.title=Sound.quiet?'单词读音页面自动暂停音乐':'轻音乐';}
  }
  function exportMemory(){const blob=new Blob([JSON.stringify(Store.state,null,2)],{type:'application/json'}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=`轩轩英语学习记录-${todayISO()}.json`;a.click();URL.revokeObjectURL(u);}
  function importMemory(e){const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const o=JSON.parse(r.result);if(!o||!o.words||!o.days)throw 0;Store.state=o;Store.save();toast('学习记录已导入');route();}catch{toast('这个记录文件无法识别');}};r.readAsText(f);}
  function toast(msg){document.querySelector('.toast')?.remove();const d=document.createElement('div');d.className='toast';d.textContent=msg;document.body.appendChild(d);setTimeout(()=>d.remove(),2200);}

  async function ai(path,payload){
    const base=(CFG.AI_PROXY_URL||'').replace(/\/$/,''); if(!base) throw new Error('AI未配置');
    const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),10000); try{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:ctrl.signal});if(!r.ok)throw new Error('AI '+r.status);return await r.json();}finally{clearTimeout(t);}
  }

  function moduleStats(module,total){
    const rows=Object.values(Store.state.sentences).filter(x=>x.module===module);const done=rows.length, attempts=rows.reduce((a,x)=>a+x.attempts,0),correct=rows.reduce((a,x)=>a+x.correct,0);return {done,left:Math.max(0,total-done),acc:attempts?Math.round(correct/attempts*100):0};
  }
  function statHTML(module,total){const s=moduleStats(module,total);return `<div class="module-stat">完成 ${s.done}/${total} · 剩余 ${s.left} · 正确率 ${s.acc}%<div class="thin-progress"><i style="width:${Math.round(s.done/total*100)}%"></i></div></div>`;}
  function recordSentence(id,module,correct,score=correct?100:0){const x=Store.sentence(id);x.attempts++;if(correct)x.correct++;x.totalScore+=(score||0);x.module=module;x.lastSeen=todayISO();Store.save();}
  function markDayList(key,id){const d=Store.day();if(!d[key].includes(id))d[key].push(id);Store.save();}
  function updateWord(term,correct,contextId){
    const x=Store.word(term);x.attempts++;correct?x.correct++:x.wrong++;if(x.learnedDay==null)x.learnedDay=Store.state.currentDay;x.lastSeen=todayISO();
    if(correct)x.stage=Math.min(7,(x.stage||0)+1);else x.stage=Math.max(0,(x.stage||0)-2);
    x.nextReview=addDays(todayISO(),correct?INTERVALS[x.stage]:1);if(contextId&&!x.contextsUsed.includes(contextId))x.contextsUsed.push(contextId);Store.save();
  }

  function dueCandidates(lexicon){
    const now=todayISO(),map=new Map(lexicon.map(x=>[x.term,x]));const arr=[];
    for(const [term,st] of Object.entries(Store.state.words)){const rec=map.get(term);if(!rec)continue;if((st.nextReview&&st.nextReview<=now)||st.wrong>st.correct){arr.push({rec,st});}}
    arr.sort((a,b)=>(a.st.nextReview||'9999').localeCompare(b.st.nextReview||'9999')||(b.st.wrong-a.st.wrong)||(a.st.stage-b.st.stage)||(b.rec.count-a.rec.count));return arr;
  }
  function pickReviewLocal(candidates,max=10){
    const bands={high:[],mid:[],low:[],extra:[]};candidates.forEach(x=>(bands[x.rec.freq_band]||bands.extra).push(x));let out=[];[['high',5],['mid',3],['low',2]].forEach(([b,n])=>out.push(...bands[b].slice(0,n)));if(out.length<max){const used=new Set(out.map(x=>x.rec.term));out.push(...candidates.filter(x=>!used.has(x.rec.term)).slice(0,max-out.length));}return out.slice(0,max).map(x=>x.rec.term);
  }

  function enforceBandRatio(rankedIds,allIds,bandOf,quotas){
    const order=[];for(const id of [...(rankedIds||[]),...(allIds||[])])if(id&&!order.includes(id))order.push(id);
    const picked=[];const used=new Set();
    for(const [band,n] of quotas){for(const id of order){if(picked.filter(x=>bandOf(x)===band).length>=n)break;if(!used.has(id)&&bandOf(id)===band){picked.push(id);used.add(id);}}}
    const target=quotas.reduce((a,x)=>a+x[1],0);for(const id of order){if(picked.length>=target)break;if(!used.has(id)){picked.push(id);used.add(id);}}
    return picked.slice(0,target);
  }

  async function ensurePlan(data){
    const day=Store.state.currentDay;if(Store.state.plans[day])return Store.state.plans[day];
    const {schedule,lexicon,sentences}=data;const learned=new Set(Object.keys(Store.state.words));
    let fresh=[];for(let k=day-1;k<100&&fresh.length<70;k++)for(const t of (schedule.words[k]?.items||[]))if(!learned.has(t)&&!fresh.includes(t))fresh.push(t);
    const baselineWords=(schedule.words[day-1]?.items||[]).filter(t=>!learned.has(t));for(const t of fresh)if(baselineWords.length<30&&!baselineWords.includes(t))baselineWords.push(t);
    const dailyS=schedule.sentences[day-1]||{};
    const poolCandidates=[];
    const desiredPools=['en_to_zh','zh_to_en',dailyS.focus==='analysis'?'analysis':'free_translation'];
    for(const pool of desiredPools){let count=0;for(let k=day-1;k<100&&count<8;k++){const ds=schedule.sentences[k];const ids=pool==='en_to_zh'?ds.en_to_zh:pool==='zh_to_en'?ds.zh_to_en:((ds.focus===(pool==='analysis'?'analysis':'translation'))?ds.focus_ids:[]);for(const id of ids||[]){const st=Store.state.sentences[id];if(!st&&sentences[id]&&!poolCandidates.some(x=>x.id===id)){poolCandidates.push({id,pool,year:sentences[id].year,word_count:sentences[id].word_count});count++;if(count>=8)break;}}}}
    const reviewRows=dueCandidates(lexicon), baselineReview=pickReviewLocal(reviewRows,10);
    const grouped={en_to_zh:[],zh_to_en:[],free_translation:[],analysis:[]};poolCandidates.forEach(x=>{if(grouped[x.pool]&&!grouped[x.pool].includes(x.id))grouped[x.pool].push(x.id);});const focusPool=dailyS.focus==='analysis'?'analysis':'free_translation';let plan={words:baselineWords.slice(0,30),en_to_zh:grouped.en_to_zh.slice(0,2),zh_to_en:grouped.zh_to_en.slice(0,2),focus:grouped[focusPool].slice(0,2),focusType:dailyS.focus,review:baselineReview,ai:false};
    if(CFG.AI_PROXY_URL){
      try{
        const lmap=new Map(lexicon.map(x=>[x.term,x]));
        const res=await ai('/daily-plan',{day,new_word_candidates:fresh.map(t=>{const r=lmap.get(t);return{id:t,band:r?.freq_band,count:r?.count||0,mastery:Store.state.words[t]?.stage||0};}),review_candidates:reviewRows.slice(0,40).map(x=>({id:x.rec.term,band:x.rec.freq_band,count:x.rec.count,wrong:x.st.wrong,mastery:x.st.stage,due:x.st.nextReview})),sentence_candidates:poolCandidates,weak_tags:weakTags()});
        if(Array.isArray(res.new_word_ids)){
          const ranked=enforceBandRatio(res.new_word_ids,fresh,t=>lmap.get(t)?.freq_band,[['high',15],['mid',9],['low',6]]);
          if(ranked.length===30) plan.words=ranked;
        }
        if(Array.isArray(res.review_ids)&&res.review_ids.length){
          const allReview=reviewRows.slice(0,40).map(x=>x.rec.term);
          plan.review=enforceBandRatio(res.review_ids,allReview,t=>lmap.get(t)?.freq_band,[['high',5],['mid',3],['low',2]]).slice(0,Math.min(10,allReview.length));
        }
        if(Array.isArray(res.sentence_ids)){
          const by={en_to_zh:[],zh_to_en:[],free_translation:[],analysis:[]};res.sentence_ids.forEach(id=>{const s=sentences[id];if(s&&by[s.pool]&&!by[s.pool].includes(id))by[s.pool].push(id);});
          if(by.en_to_zh.length>=2)plan.en_to_zh=by.en_to_zh.slice(0,2);if(by.zh_to_en.length>=2)plan.zh_to_en=by.zh_to_en.slice(0,2);const fp=plan.focusType==='analysis'?'analysis':'free_translation';if(by[fp].length>=2)plan.focus=by[fp].slice(0,2);
        }
        plan.ai=true;
      }catch(e){console.warn('AI plan fallback',e);}
    }
    Store.state.plans[day]=plan;Store.save();return plan;
  }
  function weakTags(){const tags=[];const ss=Object.values(Store.state.sentences);if(ss.length&&ss.reduce((a,x)=>a+x.correct,0)/Math.max(1,ss.reduce((a,x)=>a+x.attempts,0))<.7)tags.push('翻译准确率偏低');return tags;}

  function dayCompletion(plan){const d=Store.day();const w=plan?.words?.length?d.wordsDone.filter(x=>plan.words.includes(x)).length:0;return {words:w,en2zh:d.en2zhDone.length,zh2en:d.zh2enDone.length,focus:d.focusDone.length,review:d.reviewDone.filter(x=>plan?.review?.includes(x)).length};}
  function allDailyDone(plan){const c=dayCompletion(plan);return c.words>=30&&c.en2zh>=2&&c.zh2en>=2&&c.focus>=2&&c.review>=(plan.review?.length||0);}
  function estimateMinutes(c,plan){const left=Math.max(0,30-c.words)*.25+Math.max(0,2-c.en2zh)*2.1+Math.max(0,2-c.zh2en)*2.1+Math.max(0,2-c.focus)*3+Math.max(0,(plan.review?.length||0)-c.review)*.45;return Math.max(0,Math.round(left));}

  async function home(){
    Sound.setQuiet(false);let meta;try{meta=await Data.meta();}catch(e){shell(`<main class="page"><div class="setup">无法读取题库文件：${esc(e.message)}</div></main>`);return;}
    let plan=null,c={words:0,en2zh:0,zh2en:0,focus:0,review:0};if(meta.ready){try{const data=await Data.core();plan=await ensurePlan(data);c=dayCompletion(plan);}catch(e){console.warn(e);}}
    const day=Math.min(100,Store.state.currentDay),done=plan?c.words+c.en2zh+c.zh2en+c.focus+c.review:0,total=plan?30+2+2+2+(plan.review?.length||0):36,pct=Math.min(100,Math.round(done/Math.max(1,total)*100));const focusTranslation=plan?.focusType!=='analysis';
    shell(`<main class="page"><section class="hero"><div class="hero-copy"><h1>轩轩冲刺50分大作战！</h1><p>第 ${day} / 100 天 · 今天只做一点点，也会离目标更近 🌷</p></div></section><section class="today-card"><div class="day-row"><div><div class="day-title">今日练习</div><div class="day-sub">${meta.ready?`预计还需 ${estimateMinutes(c,plan)} 分钟${plan?.ai?' · AI已微调今日顺序':''}`:'题库正在等待第一次构建'}</div></div><b>${pct}%</b></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>${meta.ready?`<div class="task-grid">
      ${taskCard('#words','🍓','单词连线',`${c.words}/30`,'每日 30 个')}
      ${taskCard('#en2zh','🫐','英译汉',`${c.en2zh}/2`,'真题意群拼译')}
      ${taskCard('#zh2en','🍒','汉译英',`${c.zh2en}/2`,'真题英语拼句')}
      ${taskCard('#review','🌱','今日复习',`${c.review}/${plan.review.length}`,'到期词 + 当日错词')}
      ${taskCard('#focus','🌸',focusTranslation?'今日翻译':'今日成分分析',`${c.focus}/2`,focusTranslation?'AI 宽松评分':'精拆 → 粗拆 → 主干','focus-active')}
      ${taskCard('#focus','🕯️',focusTranslation?'成分分析':'翻译训练','隔日开启',focusTranslation?'明天轮到它':'明天轮到它','focus-inactive')}
      ${taskCard('#wordbook','📖','单词本',`${Object.keys(Store.state.words).length} 词`,'按日期与掌握度查看')}
      ${taskCard('#stats','✨','学习记录',`Day ${day}`,'进度与正确率')}
      </div><div class="finish-row"><button id="finishDay" class="primary" ${allDailyDone(plan)?'':'disabled'}>${day>=100?'完成100天作战！':'完成今天，进入下一天'}</button></div>`:`<div class="setup"><b>第一轮数据工程还没生成。</b><br>网页外观已经可以发布，但正式练习前请在 GitHub 仓库中添加 <code>DEEPSEEK_API_KEY</code> 到 Actions Secrets，然后运行 <b>Build stable bilingual content</b>。构建脚本只有在“3000词义完整、600句互不重复、100天配额全部通过”后才会发布题库。</div>`}</section></main>`);
    $('#finishDay')?.addEventListener('click',()=>{if(!allDailyDone(plan))return;if(Store.state.currentDay<100)Store.state.currentDay++;Store.save();Sound.sfx('finish');delete Store.state.plans[Store.state.currentDay];location.hash='#home';route();});
    if(meta.ready) Data.prefetch();
  }
  function taskCard(h,e,t,n,s,cls=''){return `<a href="${h}" class="task ${cls}" style="text-decoration:none;color:inherit"><span class="emoji">${e}</span><b>${t}</b><small>${n} · ${s}</small></a>`;}

  async function readyData(quiet=false){try{const d=await Data.full();Sound.setQuiet(quiet);return d;}catch(e){toast('题库尚未完成构建');location.hash='#home';setTimeout(home,0);throw e;}}
  function head(title,stat,back='#home'){return `<div class="module-head"><div class="module-title"><button class="back-btn" onclick="location.hash='${back}'">←</button><h2>${title}</h2></div>${stat||''}</div>`;}

  async function wordsPage(){
    const data=await readyData(true),plan=await ensurePlan(data),day=Store.day(),done=new Set(day.wordsDone),terms=plan.words;let round=Math.min(2,Math.floor([...done].filter(x=>terms.includes(x)).length/10));
    const render=()=>{
      const current=terms.slice(round*10,round*10+10),left=current.filter(t=>!done.has(t));const items=(left.length?left:current);const lmap=data.lexIndex.byTerm;const chinese=shuffle(items.map(t=>({t,zh:lmap.get(t)?.sense_zh||lmap.get(t)?.dict_zh||''})));
      shell(`<main class="page">${head('单词连线',`<div class="module-stat">今日 ${done.size}/30 · 第 ${round+1}/3 轮<div class="thin-progress"><i style="width:${done.size/30*100}%"></i></div></div>`)}<div class="split-layout"><section class="study-card"><div class="round-row"><span>先点英文，再点中文。读音按钮可以反复听。</span><span>高 : 中 : 低 = 5 : 3 : 2</span></div><div class="match-grid"><div class="match-col">${items.map(t=>`<button class="match-item eng" data-term="${esc(t)}"><span>${esc(t)}</span><span class="speak" data-speak="${esc(t)}">🔊</span></button>`).join('')}</div><div class="match-col">${chinese.map((x,i)=>`<button class="match-item zh" data-term="${esc(x.t)}"><span>${String.fromCharCode(97+i)}. ${esc(x.zh)}</span></button>`).join('')}</div></div><div id="roundDone" class="finish-row"></div></section><aside class="illustration"><img src="assets/word-match.jpg" alt="单词连线陪伴图"></aside></div></main>`);bindMatch(items);};
    function bindMatch(items){let selected=null,wrongSet=new Set();$$('[data-speak]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();Sound.speak(b.dataset.speak);}));$$('.eng').forEach(b=>b.addEventListener('click',()=>{if(b.classList.contains('done'))return;$$('.eng').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');selected=b.dataset.term;}));$$('.zh').forEach(b=>b.addEventListener('click',()=>{if(!selected||b.classList.contains('done'))return;const e=$(`.eng[data-term="${CSS.escape(selected)}"]`);if(b.dataset.term===selected){e.classList.add('done','correct');b.classList.add('done','correct');const first=!wrongSet.has(selected);if(!done.has(selected)){done.add(selected);day.wordsDone.push(selected);updateWord(selected,first,null);Store.save();}Sound.sfx('ok');selected=null;if(items.every(t=>done.has(t))){$('#roundDone').innerHTML=round<2?'<button class="primary" id="nextRound">下一组 10 个</button>':'<button class="primary" id="backHome">今天的30个完成啦 🌷</button>';$('#nextRound')?.addEventListener('click',()=>{round++;render();});$('#backHome')?.addEventListener('click',()=>{location.hash='#home';});}}else{wrongSet.add(selected);e.classList.add('wrong');b.classList.add('wrong');Sound.sfx('bad');setTimeout(()=>{e.classList.remove('wrong');b.classList.remove('wrong');},300);}}));}
    render();
  }

  async function sentenceArrange(module){
    const data=await readyData(false),plan=await ensurePlan(data),isEn2Zh=module==='en2zh',ids=isEn2Zh?plan.en_to_zh:plan.zh_to_en,day=Store.day(),doneKey=isEn2Zh?'en2zhDone':'zh2enDone',done=new Set(day[doneKey]),stat=statHTML(module,200);let idx=Math.max(0,ids.findIndex(id=>!done.has(id)));if(idx<0)idx=0;
    const render=()=>{const id=ids[idx],s=data.sentences[id];if(!s){toast('句子数据缺失');return;}let pool=shuffle([...(isEn2Zh?s.zh_chunks:s.en_chunks),...(isEn2Zh?s.zh_distractors:s.en_distractors)]),selected=[];shell(`<main class="page">${head(isEn2Zh?'英译汉':'汉译英',stat)}<div class="split-layout ${isEn2Zh?'image-left':''}">${isEn2Zh?`<aside class="illustration"><img src="assets/en-to-zh.jpg" alt="英译汉陪伴图"></aside>`:''}<section class="study-card"><div class="round-row"><span>今日第 ${idx+1}/2 句 · ${s.year} 真题</span><span>${done.size}/2</span></div>${isEn2Zh?`<div class="sentence">${esc(s.en)}</div>`:`<div class="zh-prompt">${esc(s.zh)}</div>`}<div id="answer" class="answer-line"><span class="day-sub">按顺序点下面的意群块</span></div><div class="chips" id="choices">${pool.map((x,i)=>`<button class="chip" data-i="${i}">${esc(x)}</button>`).join('')}</div><div class="finish-row" style="gap:8px"><button class="secondary" id="undo">撤回</button><button class="primary" id="check">核对</button></div><div id="fb"></div></section>${!isEn2Zh?`<aside class="illustration"><img src="assets/zh-to-en.jpg" alt="汉译英陪伴图"></aside>`:''}</div></main>`);
      const ans=$('#answer'),buttons=$$('.chip');const redraw=()=>{ans.innerHTML=selected.length?selected.map((i,j)=>`<button class="answer-chip" data-j="${j}">${esc(pool[i])}</button>`).join(''):'<span class="day-sub">按顺序点下面的意群块</span>';buttons.forEach((b,i)=>b.classList.toggle('used',selected.includes(i)));};buttons.forEach((b,i)=>b.onclick=()=>{if(!selected.includes(i)){selected.push(i);redraw();}});$('#undo').onclick=()=>{selected.pop();redraw();};$('#check').onclick=()=>{const chosen=selected.map(i=>pool[i]),correctArr=isEn2Zh?s.zh_chunks:s.en_chunks;const ok=chosen.length===correctArr.length&&chosen.every((x,i)=>x===correctArr[i]);recordSentence(id,module,ok);if(!done.has(id)){done.add(id);day[doneKey].push(id);Store.save();}Sound.sfx(ok?'ok':'bad');$('#fb').innerHTML=`<div class="feedback ${ok?'good':'bad'}"><b>${ok?'✓ 顺序正确':'这次没有完全拼对'}</b><div class="reference"><b>参考${isEn2Zh?'译文':'原句'}：</b><br>${esc(isEn2Zh?s.zh:s.en)}${renderTokens(s.en,id)}</div></div><div class="finish-row"><button class="primary" id="nextSentence">${idx<1?'下一句':'返回今日任务'}</button></div>`;bindTokenClicks(data);$('#nextSentence').onclick=()=>{if(idx<1){idx++;render();}else location.hash='#home';};};};render();
  }

  function renderTokens(en,id){return `<div class="token-line">${tokenize(en).map(t=>/[A-Za-z]/.test(t)?`<button class="token" data-word="${esc(t.toLowerCase())}" data-context="${esc(id)}">${esc(t)}</button>`:`<span>${esc(t)}</span>`).join('')}</div>`;}
  function bindTokenClicks(data){$$('[data-word]').forEach(b=>b.addEventListener('click',async()=>showWordPopup(data,b.dataset.word,b.dataset.context)));}
  async function showWordPopup(data,form,contextId){
    let rec=data.lexIndex.byForm.get(form.toLowerCase())||data.lexIndex.byTerm.get(form.toLowerCase()),scheduled=!!rec;
    if(!rec){try{const d=await Data.dictionary();rec=d.byForm.get(form.toLowerCase())||d.byTerm.get(form.toLowerCase());}catch{}}
    document.querySelector('.word-pop')?.remove();const div=document.createElement('div');div.className='word-pop';
    if(!rec){div.innerHTML=`<button class="close">×</button><h3>${esc(form)}</h3><div class="day-sub">本地词典没有可靠词条，因此不显示猜测释义。</div>`;}
    else if(!scheduled){div.innerHTML=`<button class="close">×</button><h3>${esc(rec.term)} <button class="speak" data-pop-speak>🔊</button></h3>${rec.phonetic?`<div class="day-sub">/${esc(rec.phonetic)}/</div>`:''}<div style="margin-top:7px"><b>${esc(rec.dict_zh)}</b></div>${rec.definition_en?`<div class="day-sub" style="margin-top:7px">${esc(rec.definition_en)}</div>`:''}<div class="book-meta">辅助词典词条 · 不占每日3000词学习配额</div>`;}
    else{const st=Store.state.words[rec.term];const years=Object.entries(rec.year_counts||{}).map(([y,c])=>`${y}×${c}`).join(' · ');div.innerHTML=`<button class="close">×</button><h3>${esc(rec.term)} <button class="speak" data-pop-speak>🔊</button></h3><div><b>${esc(rec.sense_zh)}</b></div>${rec.phonetic?`<div class="day-sub">/${esc(rec.phonetic)}/</div>`:''}<div style="margin-top:7px">${esc(rec.dict_zh)}</div>${rec.definition_en?`<div class="day-sub" style="margin-top:7px">${esc(rec.definition_en)}</div>`:''}<div class="book-meta">七年真题出现 ${rec.count} 次 · ${esc(years)}${st?` · 记忆阶段 ${st.stage}/7`:''}</div>`;}
    document.body.appendChild(div);$('.close',div).onclick=()=>div.remove();$('[data-pop-speak]',div)?.addEventListener('click',()=>Sound.speak(rec.term));
  }

  async function focusPage(){const data=await readyData(false),plan=await ensurePlan(data);if(plan.focusType==='analysis')return analysisPage(data,plan);return freeTranslationPage(data,plan);}
  async function freeTranslationPage(data,plan){const ids=plan.focus,day=Store.day(),done=new Set(day.focusDone),stat=statHTML('free_translation',100);let idx=Math.max(0,ids.findIndex(id=>!done.has(id)));if(idx<0)idx=0;const render=()=>{const id=ids[idx],s=data.sentences[id];shell(`<main class="page">${head('翻译训练',stat)}<section class="study-card"><div class="round-row"><span>今日第 ${idx+1}/2 句 · ${s.year} 真题</span><span>允许自然改写，不要求逐字对应</span></div><div class="sentence">${esc(s.en)}</div><textarea id="translation" class="textarea" placeholder="写下你的中文翻译……"></textarea><div class="finish-row"><button class="primary" id="scoreBtn">AI 智能评分</button></div><div id="fb"></div></section></main>`);$('#scoreBtn').onclick=async()=>{const answer=$('#translation').value.trim();if(!answer)return toast('先写下你的译文');$('#scoreBtn').disabled=true;$('#scoreBtn').textContent='正在评阅…';let result=null;try{result=await ai('/score-translation',{direction:'en_to_zh',source:s.en,reference:s.zh,answer});}catch(e){console.warn(e);}if(result&&Number.isFinite(result.score)){const ok=result.score>=70;recordSentence(id,'free_translation',ok,result.score);showAI(result,s,id,data,ok);}else{$('#fb').innerHTML=`<div class="feedback"><b>AI 暂时没连上，但今天的练习不会卡住。</b><div class="reference"><b>参考译文：</b><br>${esc(s.zh)}${renderTokens(s.en,id)}</div><div class="finish-row" style="gap:8px"><button class="secondary" id="selfBad">这句还不会</button><button class="primary" id="selfGood">基本正确</button></div></div>`;bindTokenClicks(data);$('#selfGood').onclick=()=>finish(true,80);$('#selfBad').onclick=()=>finish(false,40);} };
      function showAI(r,s,id,data,ok){$('#fb').innerHTML=`<div class="feedback ${ok?'good':'bad'}"><div class="ai-score"><div class="score-ring" style="--score:${r.score}"><b>${r.score}</b></div><div class="tips">${(r.strengths||[]).slice(0,2).map(x=>`<div class="ok">✓ ${esc(x)}</div>`).join('')}${(r.issues||[]).slice(0,3).map(x=>`<div class="warn">△ ${esc(x)}</div>`).join('')}<div>${esc(r.suggestion||'')}</div></div></div><div class="reference"><b>参考译文：</b><br>${esc(s.zh)}${renderTokens(s.en,id)}</div></div><div class="finish-row"><button class="primary" id="nextFocus">${idx<1?'下一句':'返回今日任务'}</button></div>`;bindTokenClicks(data);finishCommon();}
      function finish(correct,score){recordSentence(id,'free_translation',correct,score);$('#fb').insertAdjacentHTML('beforeend',`<div class="finish-row"><button class="primary" id="nextFocus">${idx<1?'下一句':'返回今日任务'}</button></div>`);finishCommon();}
      function finishCommon(){if(!done.has(id)){done.add(id);day.focusDone.push(id);Store.save();}$('#nextFocus').onclick=()=>{if(idx<1){idx++;render();}else location.hash='#home';};}
    };render();}

  function analysisPage(data,plan){const ids=plan.focus,day=Store.day(),done=new Set(day.focusDone),stat=statHTML('analysis',100);let idx=Math.max(0,ids.findIndex(id=>!done.has(id)));if(idx<0)idx=0;const render=()=>{const id=ids[idx],a=data.analysis[id],s=data.sentences[id];if(!a)return toast('分析数据缺失');if(a.stage==='precise')renderPrecise(a,s,id);else if(a.stage==='coarse')renderCoarse(a,s,id);else renderStem(a,s,id);};
    const wrap=(a,s,body)=>{shell(`<main class="page">${head('成分分析',stat)}<section class="study-card"><div class="round-row"><span>今日第 ${idx+1}/2 句 · ${a.stage==='precise'?'精确拆分':a.stage==='coarse'?'粗略拆分':'抓主干'}</span><span>${s.year} 真题</span></div><div class="sentence">${esc(a.en)}</div>${body}<div id="analysisFb"></div></section></main>`);};
    function complete(id,score){recordSentence(id,'analysis',score>=70,score);if(!done.has(id)){done.add(id);day.focusDone.push(id);Store.save();}Sound.sfx(score>=70?'ok':'bad');$('#analysisFb').insertAdjacentHTML('beforeend',`<div class="finish-row"><button class="primary" id="nextA">${idx<1?'下一句':'返回今日任务'}</button></div>`);$('#nextA').onclick=()=>{if(idx<1){idx++;render();}else location.hash='#home';};}
    function reference(a,s){return `<div class="reference"><b>参考汉译：</b><br>${esc(a.zh||s.zh)}<br><br><b>最短主干：</b> ${esc(a.abridged_en||'')}<br><b>主干汉译：</b> ${esc(a.main_stem_zh||'')}<br><span class="day-sub">${esc(a.logic||'')}</span>${renderTokens(a.en,a.id)}</div>`;}
    function renderPrecise(a,s,id){const groups=a.groups||[],answers=new Map();groups.forEach((g,gi)=>(g.token_indices||[]).forEach(t=>{if(!answers.has(t))answers.set(t,gi);}));let active=0,assign={};wrap(a,s,`<div class="analysis-board"><div class="day-sub">先点一个结构框，再点上面的单词方块，把每个词放到它主要所属的结构里。</div><div class="token-bank">${a.tokens.map((t,i)=>`<button class="a-token" data-ti="${i}">${esc(t)}</button>`).join('')}</div><div class="zones">${groups.map((g,i)=>`<div class="zone ${i===0?'active':''}" data-zone="${i}"><strong>${esc(g.label)}</strong><span class="mini">${esc(g.note||'')}</span><div class="zone-chips" id="zone${i}"></div></div>`).join('')}</div><div class="finish-row" style="gap:8px"><button class="secondary" id="resetA">重置</button><button class="primary" id="checkA">核对拆分</button></div></div>`);$$('.zone').forEach(z=>z.onclick=()=>{$$('.zone').forEach(x=>x.classList.remove('active'));z.classList.add('active');active=+z.dataset.zone;});$$('.a-token').forEach(b=>b.onclick=()=>{assign[+b.dataset.ti]=active;b.classList.add('assigned');draw();});const draw=()=>groups.forEach((g,gi)=>{const el=$(`#zone${gi}`);if(el)el.innerHTML=Object.entries(assign).filter(([,v])=>v===gi).map(([k])=>`<span class="answer-chip">${esc(a.tokens[+k])}</span>`).join('');});$('#resetA').onclick=()=>{assign={};$$('.a-token').forEach(x=>x.classList.remove('assigned'));draw();};$('#checkA').onclick=()=>{const lexical=a.tokens.map((t,i)=>/[A-Za-z0-9]/.test(t)?i:null).filter(x=>x!==null),right=lexical.filter(i=>assign[i]===answers.get(i)).length,score=Math.round(right/Math.max(1,lexical.length)*100);$('#analysisFb').innerHTML=`<div class="feedback ${score>=70?'good':'bad'}"><b>结构归位 ${score}%</b>${reference(a,s)}</div>`;bindTokenClicks(data);complete(id,score);};}
    function renderCoarse(a,s,id){const segs=a.segments||[],labels=shuffle([...new Set(segs.map(x=>x.label))]);wrap(a,s,`<div class="day-sub">这一阶段不再逐词抠细节：先把整块看成主句、从句或修饰块。</div>${segs.map((seg,i)=>`<div class="coarse-row"><b>${esc((seg.token_indices||[]).map(k=>a.tokens[k]).join(' '))}</b><select data-seg="${i}"><option value="">选择这一块的作用</option>${labels.map(l=>`<option>${esc(l)}</option>`).join('')}</select></div>`).join('')}<div class="finish-row"><button class="primary" id="checkA">核对层级</button></div>`);$('#checkA').onclick=()=>{let r=0;segs.forEach((g,i)=>{if($(`select[data-seg="${i}"]`).value===g.label)r++;});const score=Math.round(r/Math.max(1,segs.length)*100);$('#analysisFb').innerHTML=`<div class="feedback ${score>=70?'good':'bad'}"><b>层级判断 ${score}%</b>${reference(a,s)}</div>`;bindTokenClicks(data);complete(id,score);};}
    function renderStem(a,s,id){const target=new Set(a.main_stem_indices||[]),sel=new Set();wrap(a,s,`<div class="day-sub">只点“不能再删”的主干词。目标不是把语法全说出来，而是最快抓住主谓宾 / 主系表。</div><div class="token-bank">${a.tokens.map((t,i)=>`<button class="stem-token" data-ti="${i}">${esc(t)}</button>`).join('')}</div><textarea class="textarea" id="abridge" placeholder="再把原句缩写成一句最短英语……"></textarea><div class="finish-row"><button class="primary" id="checkA">核对主干</button></div>`);$$('.stem-token').forEach(b=>b.onclick=()=>{const i=+b.dataset.ti;sel.has(i)?sel.delete(i):sel.add(i);b.classList.toggle('on',sel.has(i));});$('#checkA').onclick=()=>{const inter=[...sel].filter(x=>target.has(x)).length,precision=inter/Math.max(1,sel.size),recall=inter/Math.max(1,target.size),score=Math.round((precision+recall?2*precision*recall/(precision+recall):0)*100);$$('.stem-token').forEach(b=>{const i=+b.dataset.ti;if(target.has(i)&&!sel.has(i))b.classList.add('miss');});$('#analysisFb').innerHTML=`<div class="feedback ${score>=70?'good':'bad'}"><b>主干抓取 ${score}%</b>${reference(a,s)}</div>`;bindTokenClicks(data);complete(id,score);};}
    render();}

  async function reviewPage(){const data=await readyData(true),plan=await ensurePlan(data),day=Store.day(),done=new Set(day.reviewDone),terms=plan.review;let idx=Math.max(0,terms.findIndex(t=>!done.has(t)));if(idx<0)idx=0;if(!terms.length){shell(`<main class="page">${head('今日复习','')}<section class="study-card empty">今天没有到期词，轻松收工 🌷</section></main>`);return;}const render=()=>{const term=terms[idx],rec=data.lexIndex.byTerm.get(term),st=Store.word(term),ctx=chooseContext(rec,st,data),q=makeCloze(rec,ctx,data.lexicon),translation=data.ctx[ctx.sentence_id]||'';shell(`<main class="page">${head('今日复习',`<div class="module-stat">${done.size}/${terms.length}<div class="thin-progress"><i style="width:${done.size/terms.length*100}%"></i></div></div>`)}<section class="study-card"><div class="round-row"><span>真题语境填词 · ${ctx.year}</span><span>答完可点每个词查看词义</span></div><div class="review-q">${esc(q.blank)}</div><div class="options">${q.options.map(o=>`<button class="option" data-opt="${esc(o)}">${esc(o)}</button>`).join('')}</div><div id="fb"></div></section></main>`);$$('.option').forEach(b=>b.onclick=()=>{if($('#fb').innerHTML)return;const ok=b.dataset.opt===q.answer;b.classList.add(ok?'correct':'wrong');if(!ok){const good=$(`.option[data-opt="${CSS.escape(q.answer)}"]`);good?.classList.add('correct');}updateWord(term,ok,ctx.sentence_id);if(!done.has(term)){done.add(term);day.reviewDone.push(term);Store.save();}Sound.sfx(ok?'ok':'bad');$('#fb').innerHTML=`<div class="feedback ${ok?'good':'bad'}"><b>${ok?'✓ 正确':'正确答案：'+esc(q.answer)}</b><div class="reference"><b>原句：</b><br>${esc(ctx.text)}<br><br><b>汉译：</b><br>${esc(translation)}${renderTokens(ctx.text,ctx.sentence_id)}<br><b>${esc(rec.term)}</b>：${esc(rec.sense_zh)} · 七年出现 ${rec.count} 次</div></div><div class="finish-row"><button class="primary" id="nextR">${idx<terms.length-1?'下一题':'返回今日任务'}</button></div>`;bindTokenClicks(data);$('#nextR').onclick=()=>{if(idx<terms.length-1){idx++;render();}else location.hash='#home';};});};render();}
  function chooseContext(rec,st,data){const cs=rec.contexts||[];const c=cs.find(x=>!st.contextsUsed.includes(x.sentence_id))||cs[st.contextsUsed.length%Math.max(1,cs.length)]||{sentence_id:'',year:''};const src=data.corpus?.[c.sentence_id]||{};return {...c,year:c.year||src.year||'',page:c.page||src.page||'',text:src.en||''};}
  function makeCloze(rec,ctx,lexicon){let matched=rec.term;const forms=[...(rec.forms||[]),rec.term].sort((a,b)=>b.length-a.length);for(const f of forms){const re=new RegExp(`\\b${escapeRe(f)}\\b`,'i');if(re.test(ctx.text)){matched=(ctx.text.match(re)||[f])[0];break;}}const blank=ctx.text.replace(new RegExp(`\\b${escapeRe(matched)}\\b`,'i'),'_____');const pattern=matched.toLowerCase();const same=lexicon.filter(x=>x.term!==rec.term&&x.type===rec.type&&x.freq_band===rec.freq_band&&posKey(x.pos)===posKey(rec.pos));const opts=[matched];for(const d of shuffle(same)){const form=formLike(d,pattern);if(!opts.includes(form))opts.push(form);if(opts.length===4)break;}for(const d of shuffle(lexicon)){if(opts.length===4)break;const form=formLike(d,pattern);if(!opts.includes(form))opts.push(form);}return{blank,answer:matched,options:shuffle(opts)};}
  const escapeRe=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const posKey=p=>String(p||'').split('/')[0].split(':')[0];
  function formLike(rec,target){const fs=rec.forms||[rec.term];if(target.endsWith('ing'))return fs.find(x=>x.endsWith('ing'))||rec.term;if(target.endsWith('ed'))return fs.find(x=>x.endsWith('ed'))||rec.term;if(target.endsWith('s'))return fs.find(x=>x.endsWith('s'))||rec.term;return rec.term;}

  async function wordbookPage(){const data=await readyData(true);let filter='all',search='';const render=()=>{let rows=data.lexicon.filter(x=>Store.state.words[x.term]);if(search)rows=rows.filter(x=>x.term.includes(search.toLowerCase())||x.sense_zh.includes(search));if(filter!=='all')rows=rows.filter(x=>filter==='weak'?(Store.state.words[x.term].stage<=2||Store.state.words[x.term].wrong>0):x.freq_band===filter);rows.sort((a,b)=>(Store.state.words[b.term].learnedDay||0)-(Store.state.words[a.term].learnedDay||0)||b.count-a.count);shell(`<main class="page">${head('单词本',`<div class="module-stat">已记录 ${Object.keys(Store.state.words).length} 个</div>`)}<section class="study-card"><div class="wordbook-tools"><input id="bookSearch" placeholder="搜索单词或中文义" value="${esc(search)}" style="flex:1;min-width:180px;border:1px solid var(--line);border-radius:14px;padding:10px"><button class="secondary" data-filter="all">全部</button><button class="secondary" data-filter="high">高频</button><button class="secondary" data-filter="mid">中频</button><button class="secondary" data-filter="low">低频</button><button class="secondary" data-filter="weak">易错/模糊</button></div><div class="book-list">${rows.slice(0,120).map(bookRow).join('')||'<div class="empty">还没有学过的单词。</div>'}</div>${rows.length>120?`<div class="empty">当前显示前 120 个，使用搜索或筛选可以更快定位。</div>`:''}</section></main>`);$('#bookSearch').oninput=e=>{search=e.target.value;setTimeout(render,100);};$$('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;render();});$$('[data-book-speak]').forEach(b=>b.onclick=()=>Sound.speak(b.dataset.bookSpeak));};
    function bookRow(r){const st=Store.state.words[r.term],dots=Array.from({length:8},(_,i)=>`<i class="dot ${i<=st.stage?'on':''}"></i>`).join(''),ctx=(r.contexts||[])[0],src=ctx?data.corpus?.[ctx.sentence_id]:null;return `<div class="book-item"><div class="book-top"><div><span class="book-term">${esc(r.term)}</span> <button class="speak" data-book-speak="${esc(r.term)}">🔊</button></div><span class="badge ${r.freq_band}">${r.freq_band==='high'?'高频':r.freq_band==='mid'?'中频':'低频'} · ${r.count}次</span></div><div class="book-meaning">${esc(r.sense_zh)}</div><div class="book-meta">${r.phonetic?'/'+esc(r.phonetic)+'/ · ':''}第 ${st.learnedDay} 天加入 · 下次复习 ${st.nextReview||'待安排'}</div><div class="mastery">${dots}</div>${src?`<div class="book-context">${esc(src.en)}</div>`:''}</div>`;}
    render();}

  async function statsPage(){const data=await readyData(false),w=Object.values(Store.state.words),ss=Object.values(Store.state.sentences),wacc=w.reduce((a,x)=>a+x.correct,0)/Math.max(1,w.reduce((a,x)=>a+x.attempts,0)),sacc=ss.reduce((a,x)=>a+x.correct,0)/Math.max(1,ss.reduce((a,x)=>a+x.attempts,0));const stable=w.filter(x=>x.stage>=5).length,weak=w.filter(x=>x.stage<=2&&x.attempts).length;shell(`<main class="page">${head('学习记录','')}<section class="study-card"><div class="task-grid"><div class="task"><span class="emoji">📅</span><b>第 ${Store.state.currentDay}/100 天</b><small>按学习日推进，不会因为断一天自动跳过</small></div><div class="task"><span class="emoji">📖</span><b>${w.length} 个词已接触</b><small>稳定掌握 ${stable} · 易错/模糊 ${weak}</small></div><div class="task"><span class="emoji">🎯</span><b>词汇正确率 ${Math.round(wacc*100)}%</b><small>包含连线与真题语境复习</small></div><div class="task"><span class="emoji">✍️</span><b>句子正确率 ${Math.round(sacc*100)}%</b><small>拼译、翻译、成分分析</small></div></div><div class="finish-row"><button class="secondary" onclick="location.hash='#wordbook'">打开单词本</button></div></section></main>`);}

  async function route(){const h=(location.hash||'#home').slice(1);try{if(h==='home')return home();if(h==='words')return wordsPage();if(h==='en2zh')return sentenceArrange('en2zh');if(h==='zh2en')return sentenceArrange('zh2en');if(h==='focus')return focusPage();if(h==='review')return reviewPage();if(h==='wordbook')return wordbookPage();if(h==='stats')return statsPage();location.hash='#home';}catch(e){console.error(e);}}
  window.addEventListener('hashchange',route);window.addEventListener('load',()=>{if(!location.hash)location.hash='#home';route();});
})();
