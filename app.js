(() => {
  'use strict';
  const CFG = window.XUANXUAN_CONFIG || {};
  const APP_VERSION = 'v21.0.0';
  const APP_KEY = 'xuanxuan50_v6_state';
  const LEGACY_BACKUP_KEY = APP_KEY + '_backup';
  const AUTH_KEY = 'xuanxuan50_auth_v1';
  const DEVICE_KEY = 'xuanxuan50_device_v1';
  const MEMORY_DB = 'xuanxuan50_memory_db';
  const MEMORY_STORE = 'kv';
  const INTERVALS = [1,2,4,7,15,30,60,120];
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const todayISO = () => { const d=new Date(),p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; };
  const addDays = (iso,n) => { const d=new Date(iso+'T12:00:00'); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
  const shuffle = arr => { const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
  const tokenize = s => s.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*|\d+(?:\.\d+)?|[^\w\s]/g) || [];

  const RELEASE_FILES=['meta.json','lexicon.json','lexicon_index.json','dictionary_lookup.json','sentences.json','sentence_meta.json','corpus.json','analysis.json','context_translations.json','schedule.json'];
  const Data = {
    cache:{},manifest:null,releaseId:null,
    async release(){
      if(this.manifest) return this.manifest;
      const r=await fetch('data/generated/release_manifest.json',{cache:'no-store'});
      if(!r.ok) throw new Error('正式题库尚未发布完成');
      const m=await r.json();
      const req=Array.isArray(m.required_files)?m.required_files:[];
      if(m.ready!==true||!m.release_id||RELEASE_FILES.some(x=>!req.includes(x))) throw new Error('正式题库发布清单不完整');
      if(Number(m.counts?.vocab)!==3000||Number(m.counts?.sentences)!==600||Number(m.counts?.analysis)!==100) throw new Error('正式题库数量校验未通过');
      this.manifest=m;this.releaseId=m.release_id;return m;
    },
    async get(name){
      if(this.cache[name]) return this.cache[name];
      await this.release();
      const file=`${name}.json`;
      if(!RELEASE_FILES.includes(file)) throw new Error(`未登记的题库文件 ${file}`);
      const r=await fetch(`data/generated/${file}?release=${encodeURIComponent(this.releaseId)}`,{cache:'no-cache'});
      if(!r.ok) throw new Error(`正式题库缺少 ${file}`);
      return this.cache[name]=await r.json();
    },
    async meta(){await this.release();return this.get('meta');},
    async dictionary(){
      if(this.cache.dictionaryIndex) return this.cache.dictionaryIndex;
      const rows=await this.get('dictionary_lookup'); const byTerm=new Map(),byForm=new Map();
      rows.forEach(x=>{byTerm.set(String(x.term).toLowerCase(),x);(x.forms||[x.term]).forEach(f=>byForm.set(String(f).toLowerCase(),x));});
      return this.cache.dictionaryIndex={byTerm,byForm};
    },
    async core(){
      const manifest=await this.release();
      const [meta,lexicon,sentences,schedule]=await Promise.all([this.get('meta'),this.get('lexicon_index'),this.get('sentence_meta'),this.get('schedule')]);
      if(!meta.ready||lexicon.length!==3000||Object.keys(sentences).length!==600||(schedule.words||[]).length!==100) throw new Error('正式题库核心文件校验失败');
      return {manifest,meta,lexicon,sentences,schedule};
    },
    async full(){
      const core=await this.core();
      const [lexicon,sentences,analysis,ctx,corpus]=await Promise.all([this.get('lexicon'),this.get('sentences'),this.get('analysis'),this.get('context_translations'),this.get('corpus')]);
      if(lexicon.length!==3000||Object.keys(sentences).length!==600||Object.keys(analysis).length!==100) throw new Error('正式题库完整文件校验失败');
      if(!this.cache.lexIndex){
        const byTerm=new Map(),byForm=new Map();
        lexicon.forEach(x=>{byTerm.set(x.term.toLowerCase(),x);(x.forms||[x.term]).forEach(f=>byForm.set(String(f).toLowerCase(),x));byForm.set(x.term.toLowerCase(),x);});
        this.cache.lexIndex={byTerm,byForm};
      }
      return {...core,lexicon,sentences,analysis,ctx,corpus,lexIndex:this.cache.lexIndex};
    },
    prefetch(){const go=()=>this.full().catch(()=>{});if('requestIdleCallback' in window)requestIdleCallback(go,{timeout:2200});else setTimeout(go,700);}
  };

  function openMemoryDB(){
    return new Promise((resolve,reject)=>{
      if(!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
      const req=indexedDB.open(MEMORY_DB,1);
      req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(MEMORY_STORE))db.createObjectStore(MEMORY_STORE);};
      req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error||new Error('IndexedDB open failed'));
    });
  }
  async function idbGet(key){const db=await openMemoryDB();return new Promise((resolve,reject)=>{const tx=db.transaction(MEMORY_STORE,'readonly'),r=tx.objectStore(MEMORY_STORE).get(key);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});}
  async function idbSet(key,value){const db=await openMemoryDB();return new Promise((resolve,reject)=>{const tx=db.transaction(MEMORY_STORE,'readwrite');tx.objectStore(MEMORY_STORE).put(value,key);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});}
  const Store = {
    state:null,saveTimer:null,persistGranted:false,scope:'guest',cloudPaused:false,
    storageKey(){return this.scope==='guest'?APP_KEY:`${APP_KEY}:user:${this.scope}`;},
    backupKey(){return this.scope==='guest'?LEGACY_BACKUP_KEY:`${APP_KEY}:user:${this.scope}:backup`;},
    idbKey(kind='state'){return `${this.scope}:${kind}`;},
    setScope(scope){this.scope=String(scope||'guest');},
    fresh(){return {version:9,schemaVersion:9,currentDay:1,created:todayISO(),challengeStart:null,updatedAt:Date.now(),sound:true,music:false,accent:CFG.DEFAULT_ACCENT||'en-US',plans:{},days:{},words:{},sentences:{},aiDictionary:{},aiDiagnostics:null};},
    parse(raw){try{const o=typeof raw==='string'?JSON.parse(raw):raw;return this.valid(o)?o:null;}catch{return null;}},
    valid(o){return !!(o&&typeof o==='object'&&Number(o.currentDay)>=1&&o.days&&o.words&&o.sentences);},
    normalizeSentence(x){
      x=x&&typeof x==='object'?x:{};x.attempts=Number(x.attempts)||0;x.correct=Number(x.correct)||0;x.totalScore=Number(x.totalScore)||0;x.module ||= null;x.lastSeen ||= null;
      x.firstDay ||= null;x.bestScore=Number.isFinite(Number(x.bestScore))?Number(x.bestScore):0;x.lastScore=Number.isFinite(Number(x.lastScore))?Number(x.lastScore):0;x.history=Array.isArray(x.history)?x.history.slice(-30):[];return x;
    },
    normalize(o){
      o=this.valid(o)?o:this.fresh();o.version=9;o.schemaVersion=9;o.currentDay=Math.min(100,Math.max(1,Number(o.currentDay)||1));o.created ||= todayISO();o.challengeStart ||= null;o.updatedAt ||= Date.now();o.sound=o.sound!==false;o.music=!!o.music;o.accent ||= CFG.DEFAULT_ACCENT||'en-US';o.plans ||= {};o.days ||= {};o.words ||= {};o.sentences ||= {};o.aiDictionary ||= {};o.aiDiagnostics ||= null;
      for(const [id,x] of Object.entries(o.sentences))o.sentences[id]=this.normalizeSentence(x);return o;
    },
    newest(rows){return rows.filter(x=>this.valid(x)).sort((a,b)=>(Number(b.updatedAt)||0)-(Number(a.updatedAt)||0))[0]||null;},
    load(){const primary=this.parse(localStorage.getItem(this.storageKey())),backup=this.parse(localStorage.getItem(this.backupKey()));this.state=this.normalize(this.newest([primary,backup])||this.fresh());return this.state;},
    legacy(){return this.normalize(this.newest([this.parse(localStorage.getItem(APP_KEY)),this.parse(localStorage.getItem(LEGACY_BACKUP_KEY))])||this.fresh());},
    hasProgress(o=this.state){return !!(o&&(Number(o.currentDay)>1||Object.keys(o.words||{}).length||Object.keys(o.sentences||{}).length||Object.keys(o.days||{}).some(k=>Object.values(o.days[k]||{}).some(v=>Array.isArray(v)&&v.length))));},
    async hydrate(){
      let dbState=null,dbBackup=null;try{[dbState,dbBackup]=await Promise.all([idbGet(this.idbKey('state')),idbGet(this.idbKey('backup'))]);}catch(e){console.warn('memory idb unavailable',e?.message||e);}
      const localBackup=this.parse(localStorage.getItem(this.backupKey()));const best=this.newest([this.state,this.parse(dbState),this.parse(dbBackup),localBackup]);if(best)this.state=this.normalize(best);this.save(false,true);await this.flush(true);
      try{if(navigator.storage?.persist)this.persistGranted=await navigator.storage.persist();}catch{}return this.state;
    },
    save(rotate=true,skipCloud=false){
      this.state=this.normalize(this.state);this.state.updatedAt=Date.now();const json=JSON.stringify(this.state);
      try{const prev=localStorage.getItem(this.storageKey());if(rotate&&prev&&prev!==json)localStorage.setItem(this.backupKey(),prev);localStorage.setItem(this.storageKey(),json);}catch(e){console.warn('local memory save failed',e);}
      clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.flush(skipCloud),120);if(!skipCloud&&!this.cloudPaused)CloudSync.schedule();
    },
    async flush(skipCloud=false){clearTimeout(this.saveTimer);this.saveTimer=null;const snapshot=JSON.parse(JSON.stringify(this.state));try{const old=await idbGet(this.idbKey('state'));if(old&&this.valid(old)&&Number(old.updatedAt)!==Number(snapshot.updatedAt))await idbSet(this.idbKey('backup'),old);await idbSet(this.idbKey('state'),snapshot);}catch(e){console.warn('indexed memory save failed',e?.message||e);}if(!skipCloud&&!this.cloudPaused)CloudSync.schedule();},
    day(n=this.state.currentDay){return this.state.days[n] ||= {wordsDone:[],en2zhDone:[],zh2enDone:[],focusDone:[],reviewDone:[]};},
    word(term){return this.state.words[term] ||= {attempts:0,correct:0,wrong:0,stage:0,learnedDay:null,lastSeen:null,nextReview:null,contextsUsed:[]};},
    sentence(id){return this.state.sentences[id]=this.normalizeSentence(this.state.sentences[id]);}
  };

  const Auth = {
    token:null,user:null,expiresAt:0,offline:false,
    base(){return String(CFG.AI_PROXY_URL||'').replace(/\/$/,'');},
    loadCached(){try{const x=JSON.parse(localStorage.getItem(AUTH_KEY)||'null');if(x?.token&&x?.user){this.token=x.token;this.user=x.user;this.expiresAt=Number(x.expires_at)||0;return true;}}catch{}return false;},
    persist(){if(this.token&&this.user)localStorage.setItem(AUTH_KEY,JSON.stringify({token:this.token,user:this.user,expires_at:this.expiresAt}));else localStorage.removeItem(AUTH_KEY);},
    async restore(){if(!this.loadCached())return false;if(this.expiresAt&&this.expiresAt<Date.now()){this.clear();return false;}try{const r=await this.request('/auth/me',{method:'GET'},true);if(r?.user){this.user=r.user;this.offline=false;this.persist();return true;}}catch(e){if(e.code==='session_expired'||e.code==='unauthorized'){this.clear();return false;}this.offline=true;}return !!this.user;},
    clear(){this.token=null;this.user=null;this.expiresAt=0;this.offline=false;localStorage.removeItem(AUTH_KEY);},
    async deriveVerifier(username,password){
      if(!crypto?.subtle)throw new Error('当前浏览器不支持安全登录所需的 Web Crypto');const u=String(username||'').trim().toLowerCase(),pw=String(password||'');if(pw.length<8||pw.length>72)throw new Error('密码长度需为8–72位');
      const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveBits']);const salt=new TextEncoder().encode(`xuanxuan50:v1:${u}`);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:150000},key,256);return b64url(new Uint8Array(bits));
    },
    async request(path,{method='POST',body=null}={},withAuth=true){
      const base=this.base();if(!base){const e=new Error('云端地址未配置');e.code='not_configured';throw e;}const headers={};if(body!==null)headers['Content-Type']='application/json';if(withAuth&&this.token)headers.Authorization=`Bearer ${this.token}`;
      const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),25000);try{const r=await fetch(base+path,{method,headers,body:body===null?undefined:JSON.stringify(body),cache:'no-store',signal:ctrl.signal});let out={};try{out=await r.json();}catch{}if(!r.ok||out?.ok===false){const e=new Error(out?.error?.message||`云端请求失败（HTTP ${r.status}）`);e.code=out?.error?.code||`http_${r.status}`;e.status=r.status;throw e;}return out;}catch(e){if(e?.name==='AbortError'){const x=new Error('云端请求超时');x.code='network_timeout';throw x;}throw e;}finally{clearTimeout(timer);}
    },
    async register(username,password,displayName){const verifier=await this.deriveVerifier(username,password);const out=await this.request('/auth/register',{body:{username,display_name:displayName,verifier,start_date:todayISO()}},false);this.token=out.session.token;this.expiresAt=out.session.expires_at;this.user=out.user;this.offline=false;this.persist();return out;},
    async login(username,password){const verifier=await this.deriveVerifier(username,password);const out=await this.request('/auth/login',{body:{username,verifier}},false);this.token=out.session.token;this.expiresAt=out.session.expires_at;this.user=out.user;this.offline=false;this.persist();return out;},
    async resetPassword(username,recoveryCode,newPassword){const newVerifier=await this.deriveVerifier(username,newPassword);const out=await this.request('/auth/reset-password',{body:{username,recovery_code:recoveryCode,new_verifier:newVerifier}},false);this.token=out.session.token;this.expiresAt=out.session.expires_at;this.user=out.user;this.offline=false;this.persist();return out;},
    async logout(){try{if(this.token)await this.request('/auth/logout',{body:{}},true);}catch{}this.clear();}
  };

  function b64url(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
  function bucketHash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0);}
  const CloudSync = {
    timer:null,syncing:false,lastSerialized:new Map(),status:'local',lastSyncAt:0,lastError:null,
    deviceId(){let id=localStorage.getItem(DEVICE_KEY);if(!id){id=crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`;localStorage.setItem(DEVICE_KEY,id);}return id;},
    makeChunks(state){
      const core={...state};delete core.words;delete core.sentences;delete core.aiDictionary;delete core.aiDiagnostics;const chunks={core};
      const wb=Array.from({length:8},()=>({}));for(const [k,v] of Object.entries(state.words||{}))wb[bucketHash(k)%8][k]=v;wb.forEach((x,i)=>chunks[`words:${i}`]=x);
      const sb=Array.from({length:36},()=>({}));for(const [k,v] of Object.entries(state.sentences||{}))sb[bucketHash(k)%36][k]=v;sb.forEach((x,i)=>chunks[`sentences:${i}`]=x);
      chunks.aidict=state.aiDictionary||{};return chunks;
    },
    stateFromChunks(rows){const base=Store.fresh(),chunks=rows||{};if(chunks.core?.data)Object.assign(base,chunks.core.data);base.words={};base.sentences={};base.aiDictionary={};for(const [k,row] of Object.entries(chunks)){if(k.startsWith('words:')&&row?.data)Object.assign(base.words,row.data);else if(k.startsWith('sentences:')&&row?.data)Object.assign(base.sentences,row.data);else if(k==='aidict'&&row?.data)base.aiDictionary=row.data;}return Store.normalize(base);},
    setHashes(chunks){this.lastSerialized.clear();for(const [k,v] of Object.entries(chunks))this.lastSerialized.set(k,JSON.stringify(v));},
    schedule(){if(!Auth.user||!Auth.token||Store.scope==='guest')return;clearTimeout(this.timer);this.timer=setTimeout(()=>this.push().catch(()=>{}),1600);},
    async pull(){if(!Auth.user||!Auth.token)return null;this.status='syncing';try{const out=await Auth.request('/sync/pull',{method:'GET'});this.status='synced';this.lastSyncAt=Date.now();this.lastError=null;return out;}catch(e){this.status='offline';this.lastError=e;throw e;}},
    async push(force=false){if(this.syncing||!Auth.user||!Auth.token||Store.scope==='guest')return;this.syncing=true;this.status='syncing';try{const chunks=this.makeChunks(Store.state),changed=[];for(const [k,v] of Object.entries(chunks)){const text=JSON.stringify(v);if(force||this.lastSerialized.get(k)!==text)changed.push({key:k,data:v,text});}if(!changed.length){this.status='synced';return;}const out=await Auth.request('/sync/push',{body:{device_id:this.deviceId(),chunks:changed.map(x=>({key:x.key,data:x.data}))}});for(const x of changed)this.lastSerialized.set(x.key,x.text);this.status='synced';this.lastSyncAt=Date.now();this.lastError=null;return out;}catch(e){this.status='offline';this.lastError=e;console.warn('cloud sync failed',e?.message||e);}finally{this.syncing=false;renderCloudBadge();}},
    async bootstrap({newAccount=false}={}){
      if(!Auth.user)return;Store.setScope(Auth.user.id);Store.load();await Store.hydrate();Store.state.challengeStart ||= Auth.user.challenge_start||todayISO();
      try{const pulled=await this.pull(),hasCloud=Object.keys(pulled?.chunks||{}).length>0;if(hasCloud){Store.cloudPaused=true;Store.state=this.stateFromChunks(pulled.chunks);Store.state.challengeStart ||= Auth.user.challenge_start||todayISO();Store.save(false,true);await Store.flush(true);Store.cloudPaused=false;this.setHashes(this.makeChunks(Store.state));return;}
        const scopedHas=Store.hasProgress(Store.state),legacy=Store.legacy(),legacyHas=Store.hasProgress(legacy);if(!scopedHas&&legacyHas){let migrate=newAccount;try{if(!newAccount)migrate=confirm('检测到这台设备上有旧版学习记录。是否迁入当前账号并同步到云端？');}catch{}if(migrate){Store.state=Store.normalize(legacy);Store.state.challengeStart ||= Auth.user.challenge_start||todayISO();Store.save(false,true);await Store.flush(true);}}
        this.setHashes({});await this.push(true);
      }catch(e){this.status='offline';this.lastError=e;}
    }
  };

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
    audioCache:new Map(),audio:null,
    async lookupAudio(text){
      const key=(Store.state.accent||'en-US')+'|'+text.toLowerCase();if(this.audioCache.has(key))return this.audioCache.get(key);
      if(!/^[A-Za-z][A-Za-z'-]*$/.test(text)){this.audioCache.set(key,'');return '';}
      try{const ctrl=new AbortController(),tm=setTimeout(()=>ctrl.abort(),4500),r=await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/'+encodeURIComponent(text),{signal:ctrl.signal});clearTimeout(tm);if(!r.ok)throw 0;const rows=await r.json(),audios=[];for(const row of rows||[])for(const p of row.phonetics||[])if(p.audio)audios.push(p.audio.startsWith('//')?'https:'+p.audio:p.audio);const wantGB=(Store.state.accent||'en-US')==='en-GB';const preferred=audios.find(u=>wantGB?/uk|gb/i.test(u):/us/i.test(u))||audios[0]||'';this.audioCache.set(key,preferred);return preferred;}catch{this.audioCache.set(key,'');return '';}
    },
    preload(words){for(const w of words||[])this.lookupAudio(String(w)).catch(()=>{});},
    async playRemote(text){const url=await this.lookupAudio(text);if(!url)return false;try{this.audio?.pause?.();const a=new Audio(url);this.audio=a;a.playbackRate=.92;await a.play();return true;}catch{return false;}},
    async speak(text){
      text=String(text||'').trim();if(!text)return;
      const canSynth='speechSynthesis' in window&&'SpeechSynthesisUtterance' in window;
      if(canSynth){
        try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang=Store.state.accent||'en-US';u.rate=.86;u.pitch=1;let started=false,fallback=false;u.onstart=()=>{started=true;};u.onerror=async()=>{if(fallback)return;fallback=true;if(!await this.playRemote(text))toast('这个浏览器暂时无法播放该读音');};speechSynthesis.speak(u);setTimeout(async()=>{if(!started&&!fallback){fallback=true;try{speechSynthesis.cancel();}catch{}if(!await this.playRemote(text))toast('这个浏览器暂时无法播放该读音');}},1200);return;}catch{}
      }
      if(!await this.playRemote(text))toast('这个浏览器暂时无法播放该读音');
    }
  };

  function shell(inner){
    const who=Auth.user?esc((Auth.user.display_name||Auth.user.username||'我').slice(0,2)):'登录';
    $('#app').innerHTML=`<div class="app-shell"><header class="topbar"><div class="brand-mini">🌷 轩轩冲刺50分大作战！</div><div class="top-actions"><button id="accentBtn" class="icon-btn" title="切换英美音">${Store.state?.accent==='en-GB'?'🇬🇧':'🇺🇸'}</button><button id="soundBtn" class="icon-btn" title="音效">🔔</button><button id="musicBtn" class="icon-btn" title="轻音乐">♫</button><button id="accountBtn" class="account-btn" title="账号与云同步"><span id="cloudDot" class="cloud-dot"></span>${who}</button></div></header>${inner}</div>`;
    bindTopbar(); renderTopbarState();renderCloudBadge();
  }
  function bindTopbar(){
    $('#soundBtn')?.addEventListener('click',()=>Sound.toggleSound()); $('#musicBtn')?.addEventListener('click',()=>Sound.toggleMusic());
    $('#accentBtn')?.addEventListener('click',()=>{Store.state.accent=Store.state.accent==='en-GB'?'en-US':'en-GB';Store.save();renderTopbarState();toast(Store.state.accent==='en-GB'?'已切换英音':'已切换美音');});
    $('#accountBtn')?.addEventListener('click',()=>location.hash='#account');
  }
  function renderTopbarState(){
    const s=$('#soundBtn'),m=$('#musicBtn'),a=$('#accentBtn'); if(s)s.classList.toggle('active',Store.state?.sound!==false); if(m)m.classList.toggle('active',!!Store.state?.music&&!Sound.quiet); if(a)a.textContent=Store.state?.accent==='en-GB'?'🇬🇧':'🇺🇸';
    if(m){m.disabled=Sound.quiet;m.title=Sound.quiet?'单词读音页面自动暂停音乐':'轻音乐';}
  }
  function renderCloudBadge(){const d=$('#cloudDot');if(!d)return;d.className='cloud-dot '+(!Auth.user?'guest':CloudSync.status==='synced'?'synced':CloudSync.status==='syncing'?'syncing':'offline');d.title=!Auth.user?'未登录':CloudSync.status==='synced'?'云端已同步':CloudSync.status==='syncing'?'正在同步':'当前离线，记录先保存在本机';}
  function exportMemory(){const blob=new Blob([JSON.stringify(Store.state,null,2)],{type:'application/json'}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=`轩轩英语学习记录-${todayISO()}.json`;a.click();URL.revokeObjectURL(u);}
  function importMemory(e){const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=async()=>{try{const o=JSON.parse(r.result);if(!Store.valid(o))throw 0;Store.state=Store.normalize(o);Store.save();await Store.flush();toast('学习记录已导入并双重保存');route();}catch{toast('这个记录文件无法识别');}};r.readAsText(f);}
  function toast(msg){document.querySelector('.toast')?.remove();const d=document.createElement('div');d.className='toast';d.textContent=msg;document.body.appendChild(d);setTimeout(()=>d.remove(),2200);}

  async function accountPage(){
    Sound.setQuiet(false);
    if(!Auth.user){let mode='login';const draw=()=>{Store.state ||= Store.fresh();shell(`<main class="page account-page"><section class="account-hero"><h1>☁️ 账号与云端学习记录</h1><p>同一个账号可以在不同浏览器、不同手机继续学习，每个人的100天进度互不影响。</p></section><section class="study-card auth-card"><div class="book-tabs"><button class="secondary ${mode==='login'?'active':''}" id="loginTab">登录</button><button class="secondary ${mode==='register'?'active':''}" id="registerTab">注册</button><button class="secondary ${mode==='reset'?'active':''}" id="resetTab">忘记密码</button></div>${mode==='register'?`<label class="form-label">昵称</label><input class="auth-input" id="displayName" maxlength="20" placeholder="例如：轩轩">`:''}<label class="form-label">账号</label><input class="auth-input" id="username" autocomplete="username" maxlength="24" placeholder="3–24位字母、数字或下划线">${mode==='reset'?`<label class="form-label">恢复码</label><input class="auth-input" id="recoveryCode" autocomplete="off" placeholder="注册时保存的恢复码">`:''}<label class="form-label">${mode==='reset'?'新密码':'密码'}</label><input class="auth-input" id="password" type="password" autocomplete="${mode==='login'?'current-password':'new-password'}" maxlength="72" placeholder="至少8位"><div class="auth-note">密码只在你的浏览器里经过 PBKDF2 派生后再发送，服务器不保存明文密码。注册成功后会生成一个恢复码，请单独保存。</div><div id="authMsg"></div><div class="finish-row"><button class="primary" id="authSubmit">${mode==='login'?'登录并恢复云端记录':mode==='register'?'注册并开始100天':'用恢复码重设密码'}</button></div></section></main>`);$('#loginTab').onclick=()=>{mode='login';draw();};$('#registerTab').onclick=()=>{mode='register';draw();};$('#resetTab').onclick=()=>{mode='reset';draw();};$('#authSubmit').onclick=async()=>{const btn=$('#authSubmit'),msg=$('#authMsg'),u=$('#username').value.trim(),pw=$('#password').value,dn=mode==='register'?$('#displayName').value.trim():'',rc=mode==='reset'?$('#recoveryCode').value.trim():'';if(!u||!pw||(mode==='register'&&!dn)||(mode==='reset'&&!rc)){msg.innerHTML='<div class="ai-error">请把信息填写完整。</div>';return;}btn.disabled=true;btn.textContent=mode==='login'?'正在登录…':mode==='register'?'正在注册…':'正在重设…';try{let out;if(mode==='login')out=await Auth.login(u,pw);else if(mode==='register')out=await Auth.register(u,pw,dn);else out=await Auth.resetPassword(u,rc,pw);if(out?.recovery_code)sessionStorage.setItem('xuanxuan50_recovery_once',out.recovery_code);await CloudSync.bootstrap({newAccount:mode==='register'});toast(mode==='login'?'登录成功，已恢复你的学习记录':mode==='register'?'注册成功，请先保存恢复码':'密码已重设，请先保存新的恢复码');location.hash='#account';route();}catch(e){msg.innerHTML=`<div class="ai-error">${esc(e?.message||'账号操作失败')}</div>`;btn.disabled=false;btn.textContent=mode==='login'?'登录并恢复云端记录':mode==='register'?'注册并开始100天':'用恢复码重设密码';}};};draw();return;}
    const last=CloudSync.lastSyncAt?new Date(CloudSync.lastSyncAt).toLocaleString():'尚未完成首次同步',status=CloudSync.status==='synced'?'已同步':CloudSync.status==='syncing'?'正在同步':'离线保存中';
    const recoveryOnce=sessionStorage.getItem('xuanxuan50_recovery_once')||'';shell(`<main class="page account-page">${head('账号与云同步','')}<section class="study-card">${recoveryOnce?`<div class="recovery-card"><b>🔐 请保存账号恢复码</b><code id="recoveryText">${esc(recoveryOnce)}</code><small>忘记密码时需要它。保存后不会再主动显示。</small><div class="finish-row"><button class="primary" id="copyRecovery">复制恢复码</button><button class="secondary" id="dismissRecovery">我已保存</button></div></div>`:''}<div class="account-profile"><div class="avatar">${esc((Auth.user.display_name||Auth.user.username).slice(0,1))}</div><div><h2>${esc(Auth.user.display_name||Auth.user.username)}</h2><div class="book-meta">@${esc(Auth.user.username)} · 100天开始于 ${esc(Auth.user.challenge_start||Store.state.challengeStart||'')}</div></div></div><div class="cloud-panel"><b>☁️ 云端状态：${status}</b><small>最后同步：${esc(last)}</small><small>当前学习进度：Day ${Store.state.currentDay}/100 · ${Object.keys(Store.state.words).length}词 · ${Object.keys(Store.state.sentences).length}句</small></div><div class="finish-row account-actions"><button class="primary" id="syncNow">立即同步</button><button class="secondary" id="exportBtn">导出备份</button><button class="secondary" id="importBtn">导入备份</button><input id="importFile" type="file" accept="application/json" hidden><button class="secondary danger-btn" id="logoutBtn">退出账号</button></div><div id="accountMsg"></div><div class="auth-note">换手机或换浏览器时，只需登录同一账号。云端记录会恢复到本机；断网时仍先保存在本机，网络恢复后再同步。</div></section></main>`);
    $('#copyRecovery')?.addEventListener('click',async()=>{const code=$('#recoveryText')?.textContent||'';try{await navigator.clipboard.writeText(code);toast('恢复码已复制');}catch{toast('请长按恢复码手动复制');}});$('#dismissRecovery')?.addEventListener('click',()=>{sessionStorage.removeItem('xuanxuan50_recovery_once');accountPage();});
    $('#syncNow').onclick=async()=>{const b=$('#syncNow');b.disabled=true;b.textContent='同步中…';await CloudSync.push(true);b.disabled=false;b.textContent='立即同步';$('#accountMsg').innerHTML=CloudSync.status==='synced'?'<div class="sync-good">✓ 已同步到云端</div>':`<div class="ai-error">${esc(CloudSync.lastError?.message||'暂时无法连接云端，本机记录仍安全保存')}</div>`;};
    $('#exportBtn').onclick=exportMemory;$('#importBtn').onclick=()=>$('#importFile').click();$('#importFile').onchange=importMemory;
    $('#logoutBtn').onclick=async()=>{if(!confirm('确定退出当前账号吗？云端记录不会删除。'))return;await CloudSync.push();await Auth.logout();CloudSync.lastSerialized.clear();CloudSync.status='local';Store.setScope('guest');Store.state=Store.fresh();location.hash='#account';route();};
  }

  const AIState={diagnostic:null,checkedAt:0,planTried:new Set(),lastError:null};
  function aiBase(){return String(CFG.AI_PROXY_URL||'').replace(/\/$/,'');}
  function aiErrorText(err){
    const code=err?.code||'';const status=err?.status||err?.upstream_status||0;
    const map={auth_failed:'DeepSeek API Key 无效，请检查 Cloudflare Secret',insufficient_balance:'DeepSeek API 余额不足，请先充值',invalid_parameters:'DeepSeek 请求参数不兼容',rate_limited:'DeepSeek 请求过快，请稍后再试',server_error:'DeepSeek 服务暂时异常',server_overloaded:'DeepSeek 当前繁忙，请稍后再试',timeout:'AI 请求超时，请检查网络后重试',origin_not_allowed:'Cloudflare 的 ALLOWED_ORIGIN 与网站地址不一致',not_configured:'Cloudflare Worker 还没有读取到 DEEPSEEK_API_KEY',network_error:'当前网络无法连接 AI 服务',network_timeout:'当前网络连接云端超时'};
    return map[code]||err?.message||(status?`AI 请求失败（HTTP ${status}）`:'AI 请求失败');
  }
  async function aiDiagnostic(force=false){
    const base=aiBase();if(!base)return {ok:false,error:{code:'not_configured',message:'AI_PROXY_URL 未配置'}};
    if(!force&&AIState.diagnostic&&Date.now()-AIState.checkedAt<120000)return AIState.diagnostic;
    const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),85000);
    try{const r=await fetch(base+'/self-test',{cache:'no-store',signal:ctrl.signal});let out={};try{out=await r.json();}catch{}if(!r.ok&&!out.error)out.error={code:'worker_http_'+r.status,message:`Worker HTTP ${r.status}`};AIState.diagnostic=out;AIState.checkedAt=Date.now();Store.state.aiDiagnostics={...out,checkedAt:Date.now()};Store.save(false);return out;}
    catch(e){const out={ok:false,error:{code:e?.name==='AbortError'?'timeout':'network_error',message:e?.name==='AbortError'?'AI 自检超时':'无法连接 Cloudflare Worker'}};AIState.diagnostic=out;AIState.checkedAt=Date.now();return out;}finally{clearTimeout(t);}
  }
  async function ai(path,payload,{timeout=80000,kind='generic'}={}){
    const base=aiBase();if(!base){const e=new Error('AI未配置');e.code='not_configured';throw e;}
    const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),timeout);
    try{
      const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:ctrl.signal,cache:'no-store'});
      let out={};try{out=await r.json();}catch{const e=new Error(`AI返回不是JSON（HTTP ${r.status}）`);e.code='bad_worker_json';e.status=r.status;throw e;}
      if(!r.ok||out?.ok===false||out?.error){const info=out?.error||{};const e=new Error(info.message||`AI HTTP ${r.status}`);e.code=info.code||`http_${r.status}`;e.status=r.status;e.upstream_status=info.upstream_status;e.detail=info.detail;AIState.lastError={kind,code:e.code,status:e.status,message:e.message,at:Date.now()};throw e;}
      return out;
    }catch(e){if(e?.name==='AbortError'){const x=new Error('AI请求超时');x.code='timeout';AIState.lastError={kind,code:'timeout',message:x.message,at:Date.now()};throw x;}throw e;}finally{clearTimeout(t);}
  }

  function moduleStats(module,total){
    const rows=Object.values(Store.state.sentences).filter(x=>x.module===module);const done=rows.length, attempts=rows.reduce((a,x)=>a+x.attempts,0),correct=rows.reduce((a,x)=>a+x.correct,0);return {done,left:Math.max(0,total-done),acc:attempts?Math.round(correct/attempts*100):0};
  }
  function statHTML(module,total){const s=moduleStats(module,total);return `<div class="module-stat">完成 ${s.done}/${total} · 剩余 ${s.left} · 正确率 ${s.acc}%<div class="thin-progress"><i style="width:${Math.round(s.done/total*100)}%"></i></div></div>`;}
  function recordSentence(id,module,correct,score=correct?100:0,detail={}){
    const x=Store.sentence(id),n=Number(score)||0;x.attempts++;if(correct)x.correct++;x.totalScore+=n;x.module=module;x.lastSeen=todayISO();x.firstDay ||= Store.state.currentDay;x.lastScore=n;x.bestScore=Math.max(Number(x.bestScore)||0,n);
    x.history.push({at:new Date().toISOString(),day:Store.state.currentDay,module,score:n,correct:!!correct,answer:String(detail.answer||''),feedback:detail.feedback||null,meta:detail.meta||null});if(x.history.length>30)x.history=x.history.slice(-30);Store.save();
  }
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
    const {schedule,lexicon,sentences}=data;const learned=new Set(Object.keys(Store.state.words));let fresh=[];
    for(let k=day-1;k<100&&fresh.length<70;k++)for(const t of (schedule.words[k]?.items||[]))if(!learned.has(t)&&!fresh.includes(t))fresh.push(t);
    const baselineWords=(schedule.words[day-1]?.items||[]).filter(t=>!learned.has(t));for(const t of fresh)if(baselineWords.length<30&&!baselineWords.includes(t))baselineWords.push(t);
    const dailyS=schedule.sentences[day-1]||{},poolCandidates=[],desiredPools=['en_to_zh','zh_to_en',dailyS.focus==='analysis'?'analysis':'free_translation'];
    for(const pool of desiredPools){let count=0;for(let k=day-1;k<100&&count<8;k++){const ds=schedule.sentences[k];const ids=pool==='en_to_zh'?ds.en_to_zh:pool==='zh_to_en'?ds.zh_to_en:((ds.focus===(pool==='analysis'?'analysis':'translation'))?ds.focus_ids:[]);for(const id of ids||[]){const st=Store.state.sentences[id];if(!st&&sentences[id]&&!poolCandidates.some(x=>x.id===id)){poolCandidates.push({id,pool,year:sentences[id].year,word_count:sentences[id].word_count});count++;if(count>=8)break;}}}}
    const reviewRows=dueCandidates(lexicon),baselineReview=pickReviewLocal(reviewRows,10),grouped={en_to_zh:[],zh_to_en:[],free_translation:[],analysis:[]};poolCandidates.forEach(x=>{if(grouped[x.pool]&&!grouped[x.pool].includes(x.id))grouped[x.pool].push(x.id);});const focusPool=dailyS.focus==='analysis'?'analysis':'free_translation';
    const plan={words:baselineWords.slice(0,30),en_to_zh:grouped.en_to_zh.slice(0,2),zh_to_en:grouped.zh_to_en.slice(0,2),focus:grouped[focusPool].slice(0,2),focusType:dailyS.focus,review:baselineReview,ai:false};Store.state.plans[day]=plan;Store.save();
    refinePlanInBackground(data,day,plan,fresh,reviewRows,poolCandidates).catch(()=>{});return plan;
  }
  async function refinePlanInBackground(data,day,plan,fresh,reviewRows,poolCandidates){
    if(!aiBase()||AIState.planTried.has(day))return;AIState.planTried.add(day);const d=Store.day(day);if(d.wordsDone.length||d.en2zhDone.length||d.zh2enDone.length||d.focusDone.length||d.reviewDone.length)return;
    try{const lmap=new Map(data.lexicon.map(x=>[x.term,x]));const res=await ai('/daily-plan',{day,new_word_candidates:fresh.map(t=>{const r=lmap.get(t);return{id:t,band:r?.freq_band,count:r?.count||0,mastery:Store.state.words[t]?.stage||0};}),review_candidates:reviewRows.slice(0,40).map(x=>({id:x.rec.term,band:x.rec.freq_band,count:x.rec.count,wrong:x.st.wrong,mastery:x.st.stage,due:x.st.nextReview})),sentence_candidates:poolCandidates,weak_tags:weakTags()},{kind:'plan'});
      if(Store.state.currentDay!==day)return;const current=Store.day(day);if(current.wordsDone.length||current.en2zhDone.length||current.zh2enDone.length||current.focusDone.length||current.reviewDone.length)return;
      if(Array.isArray(res.new_word_ids)){const ranked=enforceBandRatio(res.new_word_ids,fresh,t=>lmap.get(t)?.freq_band,[['high',15],['mid',9],['low',6]]);if(ranked.length===30)plan.words=ranked;}
      if(Array.isArray(res.review_ids)&&res.review_ids.length){const allReview=reviewRows.slice(0,40).map(x=>x.rec.term);plan.review=enforceBandRatio(res.review_ids,allReview,t=>lmap.get(t)?.freq_band,[['high',5],['mid',3],['low',2]]).slice(0,Math.min(10,allReview.length));}
      if(Array.isArray(res.sentence_ids)){const by={en_to_zh:[],zh_to_en:[],free_translation:[],analysis:[]};res.sentence_ids.forEach(id=>{const row=data.sentences[id];if(row&&by[row.pool]&&!by[row.pool].includes(id))by[row.pool].push(id);});if(by.en_to_zh.length>=2)plan.en_to_zh=by.en_to_zh.slice(0,2);if(by.zh_to_en.length>=2)plan.zh_to_en=by.zh_to_en.slice(0,2);const fp=plan.focusType==='analysis'?'analysis':'free_translation';if(by[fp].length)plan.focus=by[fp].slice(0,2);}
      plan.ai=true;plan.aiReason=String(res.reason||'');Store.state.plans[day]=plan;Store.save();if(location.hash==='#home'||!location.hash)home();
    }catch(e){console.warn('AI plan fallback:',aiErrorText(e));}
  }
  function weakTags(){const tags=[];const ss=Object.values(Store.state.sentences);if(ss.length&&ss.reduce((a,x)=>a+x.correct,0)/Math.max(1,ss.reduce((a,x)=>a+x.attempts,0))<.7)tags.push('翻译准确率偏低');return tags;}

  function dayCompletion(plan){const d=Store.day();const w=plan?.words?.length?d.wordsDone.filter(x=>plan.words.includes(x)).length:0;return {words:w,en2zh:d.en2zhDone.length,zh2en:d.zh2enDone.length,focus:d.focusDone.length,review:d.reviewDone.filter(x=>plan?.review?.includes(x)).length};}
  function focusRequired(plan){return plan?.focusType==='analysis'?2:1;}
  function allDailyDone(plan){const c=dayCompletion(plan);return c.words>=30&&c.en2zh>=2&&c.zh2en>=2&&c.focus>=focusRequired(plan)&&c.review>=(plan.review?.length||0);}
  function estimateMinutes(c,plan){const left=Math.max(0,30-c.words)*.25+Math.max(0,2-c.en2zh)*2.1+Math.max(0,2-c.zh2en)*2.1+Math.max(0,focusRequired(plan)-c.focus)*3+Math.max(0,(plan.review?.length||0)-c.review)*.45;return Math.max(0,Math.round(left));}

  async function home(){
    Sound.setQuiet(false);
    let meta=null,plan=null,releaseError=null,c={words:0,en2zh:0,zh2en:0,focus:0,review:0};
    try{
      meta=await Data.meta();
      const data=await Data.core();
      plan=await ensurePlan(data);c=dayCompletion(plan);
    }catch(e){releaseError=e;console.warn('release not ready:',e);}
    const ready=Boolean(meta?.ready&&plan&&!releaseError);
    const day=Math.min(100,Store.state.currentDay),done=ready?c.words+c.en2zh+c.zh2en+c.focus+c.review:0,total=ready?30+2+2+focusRequired(plan)+(plan.review?.length||0):35,pct=Math.min(100,Math.round(done/Math.max(1,total)*100));const focusTranslation=plan?.focusType!=='analysis';
    const waiting=`<div class="setup"><b>正式题库还没有完整发布。</b><br>当前页面会主动拒绝加载半成品，所以你的学习记录不会被错误数据污染。等 GitHub Actions 最后的 <code>RELEASE VALIDATION: PASS</code> 和 <code>ATOMIC RELEASE CONTRACT: PASS</code> 都出现后，刷新网页即可。<br><small>${esc(releaseError?.message||'正在等待完整发布包')}</small></div>`;
    shell(`<main class="page"><section class="hero"><div class="hero-copy"><h1>轩轩冲刺50分大作战！</h1><p>第 ${day} / 100 天 · ${Auth.user?esc(Auth.user.display_name||Auth.user.username)+' · 云端'+(CloudSync.status==='synced'?'已同步':'离线保存中'):'请登录后开始'} 🌷</p></div></section><section class="today-card"><div class="day-row"><div><div class="day-title">今日练习</div><div class="day-sub">${ready?`预计还需 ${estimateMinutes(c,plan)} 分钟${plan?.ai?' · AI已微调今日顺序':''}`:'正式题库发布中'}</div></div><b>${pct}%</b></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>${ready?`<div class="task-grid">
      ${taskCard('#words','🍓','单词连线',`${c.words}/30`,'每日 30 个')}
      ${taskCard('#en2zh','🫐','英译汉',`${c.en2zh}/2`,'真题意群拼译')}
      ${taskCard('#zh2en','🍒','汉译英',`${c.zh2en}/2`,'真题英语拼句')}
      ${taskCard('#review','🌱','今日复习',`${c.review}/${plan.review.length}`,'到期词 + 当日错词')}
      ${taskCard('#focus','🌸',focusTranslation?'今日翻译':'今日成分分析',`${Math.min(c.focus,focusRequired(plan))}/${focusRequired(plan)}`,focusTranslation?'1句必做 · 可反复评分':'精拆 → 粗拆 → 主干','focus-active')}
      ${taskCard('#focus','🕯️',focusTranslation?'成分分析':'翻译训练','隔日开启',focusTranslation?'明天轮到它':'明天轮到它','focus-inactive')}
      ${taskCard('#account','☁️','账号云同步',Auth.user?'已登录':'未登录',Auth.user?'换设备也能继续学习':'注册后每人独立记录')}
      ${taskCard('#wordbook','📖','学习本',`${Object.keys(Store.state.words).length} 词 · ${Object.keys(Store.state.sentences).length} 句`,'单词 + 做过的真题句')}
      ${taskCard('#stats','✨','学习记录',`Day ${day}`,'进度与正确率')}
      </div><div class="finish-row"><button id="finishDay" class="primary" ${allDailyDone(plan)?'':'disabled'}>${day>=100?'完成100天作战！':'完成今天，进入下一天'}</button></div>`:waiting}</section></main>`);
    $('#finishDay')?.addEventListener('click',()=>{if(!allDailyDone(plan))return;if(Store.state.currentDay<100)Store.state.currentDay++;Store.save();Sound.sfx('finish');delete Store.state.plans[Store.state.currentDay];location.hash='#home';route();});
    if(ready)Data.prefetch();
  }
  function taskCard(h,e,t,n,s,cls=''){return `<a href="${h}" class="task ${cls}" style="text-decoration:none;color:inherit"><span class="emoji">${e}</span><b>${t}</b><small>${n} · ${s}</small></a>`;}

  async function readyData(quiet=false){try{const d=await Data.full();Sound.setQuiet(quiet);return d;}catch(e){toast('正式题库尚未完整发布');location.hash='#home';setTimeout(home,0);throw e;}}
  function head(title,stat,back='#home'){return `<div class="module-head"><div class="module-title"><button class="back-btn" onclick="location.hash='${back}'">←</button><h2>${title}</h2></div>${stat||''}</div>`;}

  async function wordsPage(){
    const data=await readyData(true),plan=await ensurePlan(data),day=Store.day(),done=new Set(day.wordsDone),terms=plan.words;let round=Math.min(2,Math.floor([...done].filter(x=>terms.includes(x)).length/10));
    const render=()=>{
      const current=terms.slice(round*10,round*10+10),left=current.filter(t=>!done.has(t));const items=(left.length?left:current);const lmap=data.lexIndex.byTerm;const chinese=shuffle(items.map(t=>({t,zh:lmap.get(t)?.sense_zh||lmap.get(t)?.dict_zh||''})));
      shell(`<main class="page">${head('单词连线',`<div class="module-stat">今日 ${done.size}/30 · 第 ${round+1}/3 轮<div class="thin-progress"><i style="width:${done.size/30*100}%"></i></div></div>`)}<div class="split-layout"><section class="study-card"><div class="round-row"><span>先点英文，再点中文。读音按钮可以反复听。</span><span>高 : 中 : 低 = 5 : 3 : 2</span></div><div class="match-grid"><div class="match-col">${items.map(t=>`<button class="match-item eng" data-term="${esc(t)}"><span>${esc(t)}</span><span class="speak" data-speak="${esc(t)}">🔊</span></button>`).join('')}</div><div class="match-col">${chinese.map((x,i)=>`<button class="match-item zh" data-term="${esc(x.t)}"><span>${String.fromCharCode(97+i)}. ${esc(x.zh)}</span></button>`).join('')}</div></div><div id="roundDone" class="finish-row"></div></section><aside class="illustration"><img src="assets/word-match.jpg" alt="单词连线陪伴图"></aside></div></main>`);Sound.preload(items);bindMatch(items);};
    function bindMatch(items){let selected=null,wrongSet=new Set();$$('[data-speak]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();Sound.speak(b.dataset.speak);}));$$('.eng').forEach(b=>b.addEventListener('click',()=>{if(b.classList.contains('done'))return;$$('.eng').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');selected=b.dataset.term;}));$$('.zh').forEach(b=>b.addEventListener('click',()=>{if(!selected||b.classList.contains('done'))return;const e=$(`.eng[data-term="${CSS.escape(selected)}"]`);if(b.dataset.term===selected){e.classList.add('done','correct');b.classList.add('done','correct');const first=!wrongSet.has(selected);if(!done.has(selected)){done.add(selected);day.wordsDone.push(selected);updateWord(selected,first,null);Store.save();}Sound.sfx('ok');selected=null;if(items.every(t=>done.has(t))){$('#roundDone').innerHTML=round<2?'<button class="primary" id="nextRound">下一组 10 个</button>':'<button class="primary" id="backHome">今天的30个完成啦 🌷</button>';$('#nextRound')?.addEventListener('click',()=>{round++;render();});$('#backHome')?.addEventListener('click',()=>{location.hash='#home';});}}else{wrongSet.add(selected);e.classList.add('wrong');b.classList.add('wrong');Sound.sfx('bad');setTimeout(()=>{e.classList.remove('wrong');b.classList.remove('wrong');},300);}}));}
    render();
  }

  async function sentenceArrange(module,opts={}){
    const data=await readyData(false),plan=await ensurePlan(data),isEn2Zh=module==='en2zh',ids=opts.ids|| (isEn2Zh?plan.en_to_zh:plan.zh_to_en),day=Store.day(),doneKey=isEn2Zh?'en2zhDone':'zh2enDone',done=new Set(day[doneKey]),replay=!!opts.replay,back=opts.back||'#home',stat=statHTML(module,200);let idx=replay?0:Math.max(0,ids.findIndex(id=>!done.has(id)));if(idx<0)idx=0;
    const render=()=>{const id=ids[idx],s=data.sentences[id];if(!s){toast('句子数据缺失');return;}let pool=shuffle([...(isEn2Zh?s.zh_chunks:s.en_chunks),...(isEn2Zh?s.zh_distractors:s.en_distractors)]),selected=[];shell(`<main class="page">${head(isEn2Zh?'英译汉':'汉译英',stat,back)}<div class="split-layout ${isEn2Zh?'image-left':''}">${isEn2Zh?`<aside class="illustration"><img src="assets/en-to-zh.jpg" alt="英译汉陪伴图"></aside>`:''}<section class="study-card"><div class="round-row"><span>${replay?'重练':'今日'}第 ${idx+1}/${ids.length} 句 · ${s.year} 真题</span><span>${replay?'学习本重练':done.size+'/2'}</span></div>${isEn2Zh?`<div class="sentence">${esc(s.en)}</div>`:`<div class="zh-prompt">${esc(s.zh)}</div>`}<div id="answer" class="answer-line"><span class="day-sub">按顺序点下面的意群块</span></div><div class="chips" id="choices">${pool.map((x,i)=>`<button class="chip" data-i="${i}">${esc(x)}</button>`).join('')}</div><div class="finish-row" style="gap:8px"><button class="secondary" id="undo">撤回</button><button class="primary" id="check">核对</button></div><div id="fb"></div></section>${!isEn2Zh?`<aside class="illustration"><img src="assets/zh-to-en.jpg" alt="汉译英陪伴图"></aside>`:''}</div></main>`);
      const ans=$('#answer'),buttons=$$('.chip');const redraw=()=>{ans.innerHTML=selected.length?selected.map((i,j)=>`<button class="answer-chip" data-j="${j}">${esc(pool[i])}</button>`).join(''):'<span class="day-sub">按顺序点下面的意群块</span>';buttons.forEach((b,i)=>b.classList.toggle('used',selected.includes(i)));};buttons.forEach((b,i)=>b.onclick=()=>{if(!selected.includes(i)){selected.push(i);redraw();}});$('#undo').onclick=()=>{selected.pop();redraw();};$('#check').onclick=()=>{const chosen=selected.map(i=>pool[i]),correctArr=isEn2Zh?s.zh_chunks:s.en_chunks;const ok=chosen.length===correctArr.length&&chosen.every((x,i)=>x===correctArr[i]);recordSentence(id,module,ok,ok?100:0,{answer:chosen.join(' / '),meta:{reference:(isEn2Zh?s.zh:s.en)}});if(!replay&&!done.has(id)){done.add(id);day[doneKey].push(id);Store.save();}Sound.sfx(ok?'ok':'bad');$('#fb').innerHTML=`<div class="feedback ${ok?'good':'bad'}"><b>${ok?'✓ 顺序正确':'这次没有完全拼对'}</b><div class="reference"><b>参考${isEn2Zh?'译文':'原句'}：</b><br>${esc(isEn2Zh?s.zh:s.en)}${renderTokens(s.en,id)}</div></div>${navButtons(idx,ids.length,replay,back)}`;bindTokenClicks(data);bindSentenceNav(render,()=>idx, v=>idx=v,ids.length,replay,back);};};render();
  }
  function navButtons(idx,len,replay,back){return `<div class="finish-row sentence-nav"><button class="secondary" id="prevSentence" ${idx<=0?'disabled':''}>← 上一句</button><button class="secondary" id="retrySentence">重做本句</button>${idx<len-1?'<button class="primary" id="nextSentence">下一句 →</button>':`<button class="primary" id="leaveSentence">${replay?'返回学习本':'返回今日任务'}</button>`}</div>`;}
  function bindSentenceNav(render,getIdx,setIdx,len,replay,back){$('#prevSentence')?.addEventListener('click',()=>{const i=getIdx();if(i>0){setIdx(i-1);render();}});$('#retrySentence')?.addEventListener('click',render);$('#nextSentence')?.addEventListener('click',()=>{const i=getIdx();if(i<len-1){setIdx(i+1);render();}});$('#leaveSentence')?.addEventListener('click',()=>{location.hash=back;});}

  function renderTokens(en,id){return `<div class="token-line">${tokenize(en).map(t=>/[A-Za-z]/.test(t)?`<button class="token" data-word="${esc(t.toLowerCase())}" data-context="${esc(id)}">${esc(t)}</button>`:`<span>${esc(t)}</span>`).join('')}</div>`;}
  function bindTokenClicks(data){$$('[data-word]').forEach(b=>b.addEventListener('click',async()=>showWordPopup(data,b.dataset.word,b.dataset.context)));}
  async function showWordPopup(data,form,contextId){
    const key=form.toLowerCase();let rec=data.lexIndex.byForm.get(key)||data.lexIndex.byTerm.get(key),scheduled=!!rec;if(!rec){try{const d=await Data.dictionary();rec=d.byForm.get(key)||d.byTerm.get(key);}catch{}}
    const cached=Store.state.aiDictionary[key];document.querySelector('.word-pop')?.remove();const div=document.createElement('div');div.className='word-pop';
    if(!rec&&!cached){div.innerHTML=`<button class="close">×</button><h3>${esc(form)}</h3><div class="day-sub">本地辅助词典没有这个词。可以让 AI 结合当前真题句查询，查询成功后会永久缓存在本机。</div><div class="finish-row"><button class="primary" id="aiLookupWord">AI 查本句词义</button></div><div id="lookupMsg"></div>`;}
    else if(!rec&&cached){div.innerHTML=`<button class="close">×</button><h3>${esc(cached.lemma||form)} <button class="speak" data-pop-speak>🔊</button></h3><div><b>${esc(cached.context_meaning_zh||cached.meaning_zh)}</b></div><div style="margin-top:7px">${esc(cached.meaning_zh||'')}</div>${cached.pos?`<div class="day-sub">${esc(cached.pos)}</div>`:''}${cached.definition_en?`<div class="day-sub" style="margin-top:7px">${esc(cached.definition_en)}</div>`:''}${cached.note?`<div class="book-meta">${esc(cached.note)}</div>`:''}<div class="book-meta">AI 语境词典缓存 · 不占每日3000词学习配额</div>`;}
    else if(!scheduled){div.innerHTML=`<button class="close">×</button><h3>${esc(rec.term)} <button class="speak" data-pop-speak>🔊</button></h3>${rec.phonetic?`<div class="day-sub">/${esc(rec.phonetic)}/</div>`:''}<div style="margin-top:7px"><b>${esc(rec.dict_zh)}</b></div>${rec.definition_en?`<div class="day-sub" style="margin-top:7px">${esc(rec.definition_en)}</div>`:''}<div class="book-meta">辅助词典词条 · 不占每日3000词学习配额</div>`;}
    else{const st=Store.state.words[rec.term];const years=Object.entries(rec.year_counts||{}).map(([y,c])=>`${y}×${c}`).join(' · ');div.innerHTML=`<button class="close">×</button><h3>${esc(rec.term)} <button class="speak" data-pop-speak>🔊</button></h3><div><b>${esc(rec.sense_zh)}</b></div>${rec.phonetic?`<div class="day-sub">/${esc(rec.phonetic)}/</div>`:''}<div style="margin-top:7px">${esc(rec.dict_zh)}</div>${rec.definition_en?`<div class="day-sub" style="margin-top:7px">${esc(rec.definition_en)}</div>`:''}<div class="book-meta">七年真题出现 ${rec.count} 次 · ${esc(years)}${st?` · 记忆阶段 ${st.stage}/7`:''}</div>`;}
    document.body.appendChild(div);const spoken=rec?.term||cached?.lemma||form;if(spoken)Sound.preload([spoken]);$('.close',div).onclick=()=>div.remove();$('[data-pop-speak]',div)?.addEventListener('click',()=>Sound.speak(spoken));
    $('#aiLookupWord',div)?.addEventListener('click',async()=>{const btn=$('#aiLookupWord',div),msg=$('#lookupMsg',div);btn.disabled=true;btn.textContent='AI 查询中…';const context=data.sentences?.[contextId]?.en||data.corpus?.[contextId]?.en||'';try{const out=await ai('/lookup-word',{word:form,context},{kind:'lookup'});const cachedRow={...out,cachedAt:Date.now(),contextId};Store.state.aiDictionary[key]=cachedRow;if(out.lemma)Store.state.aiDictionary[String(out.lemma).toLowerCase()]=cachedRow;Store.save();await Store.flush();showWordPopup(data,form,contextId);}catch(e){btn.disabled=false;btn.textContent='重新查询';msg.innerHTML=`<div class="ai-error">${esc(aiErrorText(e))}${e?.detail?`<small>${esc(e.detail)}</small>`:''}</div>`;}});
  }

  async function focusPage(){const data=await readyData(false),plan=await ensurePlan(data);if(plan.focusType==='analysis')return analysisPage(data,plan);return freeTranslationPage(data,plan);}
  async function freeTranslationPage(data,plan,opts={}){
    const ids=opts.ids||plan.focus,day=Store.day(),done=new Set(day.focusDone),replay=!!opts.replay,back=opts.back||'#home',stat=statHTML('free_translation',100);let idx=replay?0:Math.max(0,ids.findIndex(id=>!done.has(id)));if(idx<0)idx=0;
    const render=()=>{const id=ids[idx],s=data.sentences[id],previous=Store.sentence(id).history.filter(x=>x.module==='free_translation').slice(-1)[0];shell(`<main class="page">${head('翻译训练',stat,back)}<section class="study-card"><div class="round-row"><span>${replay?'重练':'今日'}第 ${idx+1}/${ids.length} 句 · ${s.year} 真题</span><span>${replay?'可无限重评':'今天1句必做 · 第2句可选'}</span></div><div class="sentence">${esc(s.en)}</div><textarea id="translation" class="textarea" placeholder="写下你的中文翻译……">${esc(previous?.answer||'')}</textarea><div class="finish-row"><button class="primary" id="scoreBtn">AI 智能评分</button></div><div id="fb"></div></section></main>`);
      const scoreNow=async()=>{const answer=$('#translation').value.trim();if(!answer)return toast('先写下你的译文');const btn=$('#scoreBtn');btn.disabled=true;btn.textContent='正在评阅…';try{const r=await ai('/score-translation',{direction:'en_to_zh',source:s.en,reference:s.zh,answer},{kind:'score'});const ok=Number(r.score)>=70;recordSentence(id,'free_translation',ok,r.score,{answer,feedback:r});if(!replay&&!done.has(id)){done.add(id);day.focusDone.push(id);Store.save();}showAI(r,s,id,data,ok,answer);}catch(e){btn.disabled=false;btn.textContent='重新尝试 AI 评分';$('#fb').innerHTML=`<div class="feedback bad"><b>AI评分没有完成</b><div class="ai-error">${esc(aiErrorText(e))}${e?.detail?`<small>${esc(e.detail)}</small>`:''}</div><div class="reference"><b>参考译文：</b><br>${esc(s.zh)}${renderTokens(s.en,id)}</div><div class="finish-row" style="gap:8px"><button class="secondary" id="selfBad">这句还不会</button><button class="secondary" id="selfGood">基本正确</button></div></div>`;bindTokenClicks(data);$('#selfGood').onclick=()=>selfFinish(true,80,answer);$('#selfBad').onclick=()=>selfFinish(false,40,answer);}};
      $('#scoreBtn').onclick=scoreNow;
      function showAI(r,s,id,data,ok,answer){$('#fb').innerHTML=`<div class="feedback ${ok?'good':'bad'}"><div class="ai-score"><div class="score-ring" style="--score:${r.score}"><b>${r.score}</b></div><div class="tips">${(r.strengths||[]).slice(0,2).map(x=>`<div class="ok">✓ ${esc(x)}</div>`).join('')}${(r.issues||[]).slice(0,3).map(x=>`<div class="warn">△ ${esc(x)}</div>`).join('')}<div>${esc(r.suggestion||'')}</div></div></div><div class="reference"><b>参考译文：</b><br>${esc(s.zh)}${renderTokens(s.en,id)}</div></div><div class="finish-row sentence-nav"><button class="secondary" id="prevSentence" ${idx<=0?'disabled':''}>← 上一句</button><button class="secondary" id="rescore">修改后再评</button>${idx<ids.length-1?'<button class="primary" id="nextSentence">下一句（可选） →</button>':`<button class="primary" id="leaveSentence">${replay?'返回学习本':'返回今日任务'}</button>`}</div>`;bindTokenClicks(data);bindFreeNav();}
      function selfFinish(correct,score,answer){recordSentence(id,'free_translation',correct,score,{answer,feedback:{source:'self'}});if(!replay&&!done.has(id)){done.add(id);day.focusDone.push(id);Store.save();}$('#fb').insertAdjacentHTML('beforeend',navButtons(idx,ids.length,replay,back));bindSentenceNav(render,()=>idx,v=>idx=v,ids.length,replay,back);}
      function bindFreeNav(){$('#prevSentence')?.addEventListener('click',()=>{if(idx>0){idx--;render();}});$('#rescore')?.addEventListener('click',()=>{const btn=$('#scoreBtn');btn.disabled=false;btn.textContent='AI 再评分';$('#fb').innerHTML='';$('#translation').focus();});$('#nextSentence')?.addEventListener('click',()=>{if(idx<ids.length-1){idx++;render();}});$('#leaveSentence')?.addEventListener('click',()=>location.hash=back);}
    };render();
  }

  function analysisPage(data,plan,opts={}){const ids=opts.ids||plan.focus,day=Store.day(),done=new Set(day.focusDone),replay=!!opts.replay,back=opts.back||'#home',stat=statHTML('analysis',100);let idx=replay?0:Math.max(0,ids.findIndex(id=>!done.has(id)));if(idx<0)idx=0;const render=()=>{const id=ids[idx],a=data.analysis[id],s=data.sentences[id];if(!a)return toast('分析数据缺失');if(a.stage==='precise')renderPrecise(a,s,id);else if(a.stage==='coarse')renderCoarse(a,s,id);else renderStem(a,s,id);};
    const wrap=(a,s,body)=>{shell(`<main class="page">${head('成分分析',stat,back)}<section class="study-card"><div class="round-row"><span>${replay?'重练':'今日'}第 ${idx+1}/${ids.length} 句 · ${a.stage==='precise'?'精确拆分':a.stage==='coarse'?'粗略拆分':'抓主干'}</span><span>${s.year} 真题</span></div><div class="sentence">${esc(a.en)}</div>${body}<div id="analysisFb"></div></section></main>`);};
    function finishNav(){return navButtons(idx,ids.length,replay,back);}
    function complete(id,score,detail={}){recordSentence(id,'analysis',score>=70,score,detail);if(!replay&&!done.has(id)){done.add(id);day.focusDone.push(id);Store.save();}Sound.sfx(score>=70?'ok':'bad');$('#analysisFb').insertAdjacentHTML('beforeend',finishNav());bindSentenceNav(render,()=>idx,v=>idx=v,ids.length,replay,back);}
    function reference(a,s,id){return `<div class="reference"><b>参考汉译：</b><br>${esc(a.zh||s.zh)}<br><br><b>最短主干：</b> ${esc(a.abridged_en||'')}<br><b>主干汉译：</b> ${esc(a.main_stem_zh||'')}<br><span class="day-sub">${esc(a.logic||'')}</span>${renderTokens(a.en,id)}</div>`;}
    function renderPrecise(a,s,id){const groups=a.groups||[],answers=new Map();groups.forEach((g,gi)=>(g.token_indices||[]).forEach(t=>{if(!answers.has(t))answers.set(t,gi);}));let active=0,assign={};wrap(a,s,`<div class="analysis-board"><div class="day-sub">先点一个结构框，再点上面的单词方块，把每个词放到它主要所属的结构里。</div><div class="token-bank">${a.tokens.map((t,i)=>`<button class="a-token" data-ti="${i}">${esc(t)}</button>`).join('')}</div><div class="zones">${groups.map((g,i)=>`<div class="zone ${i===0?'active':''}" data-zone="${i}"><strong>${esc(g.label)}</strong><span class="mini">${esc(g.note||'')}</span><div class="zone-chips" id="zone${i}"></div></div>`).join('')}</div><div class="finish-row" style="gap:8px"><button class="secondary" id="resetA">重置</button><button class="primary" id="checkA">核对拆分</button></div></div>`);$$('.zone').forEach(z=>z.onclick=()=>{$$('.zone').forEach(x=>x.classList.remove('active'));z.classList.add('active');active=+z.dataset.zone;});$$('.a-token').forEach(b=>b.onclick=()=>{assign[+b.dataset.ti]=active;b.classList.add('assigned');draw();});const draw=()=>groups.forEach((g,gi)=>{const el=$(`#zone${gi}`);if(el)el.innerHTML=Object.entries(assign).filter(([,v])=>v===gi).map(([k])=>`<span class="answer-chip">${esc(a.tokens[+k])}</span>`).join('');});$('#resetA').onclick=()=>{assign={};$$('.a-token').forEach(x=>x.classList.remove('assigned'));draw();};$('#checkA').onclick=()=>{const lexical=a.tokens.map((t,i)=>/[A-Za-z0-9]/.test(t)?i:null).filter(x=>x!==null),right=lexical.filter(i=>assign[i]===answers.get(i)).length,score=Math.round(right/Math.max(1,lexical.length)*100);$('#analysisFb').innerHTML=`<div class="feedback ${score>=70?'good':'bad'}"><b>结构归位 ${score}%</b>${reference(a,s,id)}</div>`;bindTokenClicks(data);complete(id,score,{answer:JSON.stringify(assign),meta:{stage:'precise'}});};}
    function renderCoarse(a,s,id){const segs=a.segments||[],labels=shuffle([...new Set(segs.map(x=>x.label))]);wrap(a,s,`<div class="day-sub">这一阶段不再逐词抠细节：先把整块看成主句、从句或修饰块。</div>${segs.map((seg,i)=>`<div class="coarse-row"><b>${esc((seg.token_indices||[]).map(k=>a.tokens[k]).join(' '))}</b><select data-seg="${i}"><option value="">选择这一块的作用</option>${labels.map(l=>`<option>${esc(l)}</option>`).join('')}</select></div>`).join('')}<div class="finish-row"><button class="primary" id="checkA">核对层级</button></div>`);$('#checkA').onclick=()=>{let r=0;const chosen=[];segs.forEach((g,i)=>{const v=$(`select[data-seg="${i}"]`).value;chosen.push(v);if(v===g.label)r++;});const score=Math.round(r/Math.max(1,segs.length)*100);$('#analysisFb').innerHTML=`<div class="feedback ${score>=70?'good':'bad'}"><b>层级判断 ${score}%</b>${reference(a,s,id)}</div>`;bindTokenClicks(data);complete(id,score,{answer:chosen.join(' | '),meta:{stage:'coarse'}});};}
    function renderStem(a,s,id){const target=new Set(a.main_stem_indices||[]),sel=new Set();wrap(a,s,`<div class="day-sub">只点“不能再删”的主干词，然后把原句缩写成一句最短英语。主干选择占70%，缩写句占30%。</div><div class="token-bank">${a.tokens.map((t,i)=>`<button class="stem-token" data-ti="${i}">${esc(t)}</button>`).join('')}</div><textarea class="textarea" id="abridge" placeholder="把原句缩写成一句最短英语……"></textarea><div class="finish-row"><button class="primary" id="checkA">核对主干</button></div>`);$$('.stem-token').forEach(b=>b.onclick=()=>{const i=+b.dataset.ti;sel.has(i)?sel.delete(i):sel.add(i);b.classList.toggle('on',sel.has(i));});$('#checkA').onclick=async()=>{const abridge=$('#abridge').value.trim();if(!abridge)return toast('请先写出缩写句');const btn=$('#checkA');btn.disabled=true;btn.textContent='正在核对…';const inter=[...sel].filter(x=>target.has(x)).length,precision=inter/Math.max(1,sel.size),recall=inter/Math.max(1,target.size),local=Math.round((precision+recall?2*precision*recall/(precision+recall):0)*100);$$('.stem-token').forEach(b=>{const i=+b.dataset.ti;if(target.has(i)&&!sel.has(i))b.classList.add('miss');});let aiPart=null,aiNote='';try{aiPart=await ai('/score-abridgement',{source:a.en,reference:a.abridged_en||'',answer:abridge},{kind:'abridge'});}catch(e){aiNote=`<div class="ai-error">缩写句 AI 评分暂不可用：${esc(aiErrorText(e))}</div>`;}const score=aiPart?Math.round(local*.7+Number(aiPart.score||0)*.3):local;$('#analysisFb').innerHTML=`<div class="feedback ${score>=70?'good':'bad'}"><b>综合 ${score}%</b><div class="book-meta">主干选择 ${local}%${aiPart?` · 缩写句 ${aiPart.score}%`:''}</div>${aiPart?.issues?.length?`<div class="tips">${aiPart.issues.map(x=>`<div class="warn">△ ${esc(x)}</div>`).join('')}<div>${esc(aiPart.suggestion||'')}</div></div>`:''}${aiNote}${reference(a,s,id)}</div>`;bindTokenClicks(data);complete(id,score,{answer:abridge,feedback:aiPart,meta:{stage:'main_stem',selected:[...sel],localScore:local}});};}
    render();}

  async function reviewPage(){const data=await readyData(true),plan=await ensurePlan(data),day=Store.day(),done=new Set(day.reviewDone),terms=plan.review;let idx=Math.max(0,terms.findIndex(t=>!done.has(t)));if(idx<0)idx=0;if(!terms.length){shell(`<main class="page">${head('今日复习','')}<section class="study-card empty">今天没有到期词，轻松收工 🌷</section></main>`);return;}const render=()=>{const term=terms[idx],rec=data.lexIndex.byTerm.get(term),st=Store.word(term),ctx=chooseContext(rec,st,data),q=makeCloze(rec,ctx,data.lexicon),translation=data.ctx[ctx.sentence_id]||'';shell(`<main class="page">${head('今日复习',`<div class="module-stat">${done.size}/${terms.length}<div class="thin-progress"><i style="width:${done.size/terms.length*100}%"></i></div></div>`)}<section class="study-card"><div class="round-row"><span>真题语境填词 · ${ctx.year}</span><span>答完可点每个词查看词义</span></div><div class="review-q">${esc(q.blank)}</div><div class="options">${q.options.map(o=>`<button class="option" data-opt="${esc(o)}">${esc(o)}</button>`).join('')}</div><div id="fb"></div></section></main>`);$$('.option').forEach(b=>b.onclick=()=>{if($('#fb').innerHTML)return;const ok=b.dataset.opt===q.answer;b.classList.add(ok?'correct':'wrong');if(!ok){const good=$(`.option[data-opt="${CSS.escape(q.answer)}"]`);good?.classList.add('correct');}updateWord(term,ok,ctx.sentence_id);if(!done.has(term)){done.add(term);day.reviewDone.push(term);Store.save();}Sound.sfx(ok?'ok':'bad');$('#fb').innerHTML=`<div class="feedback ${ok?'good':'bad'}"><b>${ok?'✓ 正确':'正确答案：'+esc(q.answer)}</b><div class="reference"><b>原句：</b><br>${esc(ctx.text)}<br><br><b>汉译：</b><br>${esc(translation)}${renderTokens(ctx.text,ctx.sentence_id)}<br><b>${esc(rec.term)}</b>：${esc(rec.sense_zh)} · 七年出现 ${rec.count} 次</div></div><div class="finish-row"><button class="primary" id="nextR">${idx<terms.length-1?'下一题':'返回今日任务'}</button></div>`;bindTokenClicks(data);$('#nextR').onclick=()=>{if(idx<terms.length-1){idx++;render();}else location.hash='#home';};});};render();}
  function chooseContext(rec,st,data){const cs=rec.contexts||[];const c=cs.find(x=>!st.contextsUsed.includes(x.sentence_id))||cs[st.contextsUsed.length%Math.max(1,cs.length)]||{sentence_id:'',year:''};const src=data.corpus?.[c.sentence_id]||{};return {...c,year:c.year||src.year||'',page:c.page||src.page||'',text:src.en||''};}
  function makeCloze(rec,ctx,lexicon){let matched=rec.term;const forms=[...(rec.forms||[]),rec.term].sort((a,b)=>b.length-a.length);for(const f of forms){const re=new RegExp(`\\b${escapeRe(f)}\\b`,'i');if(re.test(ctx.text)){matched=(ctx.text.match(re)||[f])[0];break;}}const blank=ctx.text.replace(new RegExp(`\\b${escapeRe(matched)}\\b`,'i'),'_____');const pattern=matched.toLowerCase();const same=lexicon.filter(x=>x.term!==rec.term&&x.type===rec.type&&x.freq_band===rec.freq_band&&posKey(x.pos)===posKey(rec.pos));const opts=[matched];for(const d of shuffle(same)){const form=formLike(d,pattern);if(!opts.includes(form))opts.push(form);if(opts.length===4)break;}for(const d of shuffle(lexicon)){if(opts.length===4)break;const form=formLike(d,pattern);if(!opts.includes(form))opts.push(form);}return{blank,answer:matched,options:shuffle(opts)};}
  const escapeRe=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const posKey=p=>String(p||'').split('/')[0].split(':')[0];
  function formLike(rec,target){const fs=rec.forms||[rec.term];if(target.endsWith('ing'))return fs.find(x=>x.endsWith('ing'))||rec.term;if(target.endsWith('ed'))return fs.find(x=>x.endsWith('ed'))||rec.term;if(target.endsWith('s'))return fs.find(x=>x.endsWith('s'))||rec.term;return rec.term;}

  async function wordbookPage(){const data=await readyData(true);let tab='words',filter='all',search='';
    const render=()=>{const wordCount=Object.keys(Store.state.words).length,sentenceEntries=Object.entries(Store.state.sentences).filter(([,x])=>x?.attempts>0);
      if(tab==='words'){let rows=data.lexicon.filter(x=>Store.state.words[x.term]);if(search)rows=rows.filter(x=>x.term.includes(search.toLowerCase())||x.sense_zh.includes(search));if(filter!=='all')rows=rows.filter(x=>filter==='weak'?(Store.state.words[x.term].stage<=2||Store.state.words[x.term].wrong>0):x.freq_band===filter);rows.sort((a,b)=>(Store.state.words[b.term].learnedDay||0)-(Store.state.words[a.term].learnedDay||0)||b.count-a.count);shell(`<main class="page">${head('学习本',`<div class="module-stat">${wordCount} 词 · ${sentenceEntries.length} 句</div>`)}<section class="study-card"><div class="book-tabs"><button class="secondary active" id="tabWords">单词</button><button class="secondary" id="tabSentences">真题句</button></div><div class="wordbook-tools"><input id="bookSearch" placeholder="搜索单词或中文义" value="${esc(search)}" style="flex:1;min-width:180px;border:1px solid var(--line);border-radius:14px;padding:10px"><button class="secondary" data-filter="all">全部</button><button class="secondary" data-filter="high">高频</button><button class="secondary" data-filter="mid">中频</button><button class="secondary" data-filter="low">低频</button><button class="secondary" data-filter="weak">易错/模糊</button></div><div class="book-list">${rows.slice(0,120).map(bookRow).join('')||'<div class="empty">还没有学过的单词。</div>'}</div>${rows.length>120?'<div class="empty">当前显示前 120 个，使用搜索或筛选可以更快定位。</div>':''}</section></main>`);bindTabs();$('#bookSearch').oninput=e=>{search=e.target.value;setTimeout(render,100);};$$('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;render();});$$('[data-book-speak]').forEach(b=>b.onclick=()=>Sound.speak(b.dataset.bookSpeak));}
      else{const rows=sentenceEntries.map(([id,st])=>({id,st,s:data.sentences[id]})).filter(x=>x.s).sort((a,b)=>(b.st.lastSeen||'').localeCompare(a.st.lastSeen||''));shell(`<main class="page">${head('学习本',`<div class="module-stat">${wordCount} 词 · ${rows.length} 句</div>`)}<section class="study-card"><div class="book-tabs"><button class="secondary" id="tabWords">单词</button><button class="secondary active" id="tabSentences">真题句</button></div><div class="book-list">${rows.map(sentenceRow).join('')||'<div class="empty">做过的英译汉、汉译英、翻译和成分分析会自动保存在这里。</div>'}</div></section></main>`);bindTabs();$$('[data-replay]').forEach(b=>b.onclick=()=>location.hash='#replay/'+encodeURIComponent(b.dataset.replay));$$('[data-history]').forEach(b=>b.onclick=()=>showSentenceHistory(b.dataset.history,data));}
    };
    const bindTabs=()=>{$('#tabWords')?.addEventListener('click',()=>{tab='words';render();});$('#tabSentences')?.addEventListener('click',()=>{tab='sentences';render();});};
    function bookRow(r){const st=Store.state.words[r.term],dots=Array.from({length:8},(_,i)=>`<i class="dot ${i<=st.stage?'on':''}"></i>`).join(''),ctx=(r.contexts||[])[0],src=ctx?data.corpus?.[ctx.sentence_id]:null;return `<div class="book-item"><div class="book-top"><div><span class="book-term">${esc(r.term)}</span> <button class="speak" data-book-speak="${esc(r.term)}">🔊</button></div><span class="badge ${r.freq_band}">${r.freq_band==='high'?'高频':r.freq_band==='mid'?'中频':'低频'} · ${r.count}次</span></div><div class="book-meaning">${esc(r.sense_zh)}</div><div class="book-meta">${r.phonetic?'/'+esc(r.phonetic)+'/ · ':''}第 ${st.learnedDay} 天加入 · 下次复习 ${st.nextReview||'待安排'}</div><div class="mastery">${dots}</div>${src?`<div class="book-context">${esc(src.en)}</div>`:''}</div>`;}
    function sentenceRow(x){const label={en2zh:'英译汉',zh2en:'汉译英',free_translation:'自由翻译',analysis:'成分分析'}[x.st.module]||x.s.pool||'真题句';return `<div class="book-item sentence-book-item"><div class="book-top"><div><span class="book-term">${esc(label)}</span> <span class="book-meta">${esc(x.s.year||'')} 真题</span></div><span class="badge">练习 ${x.st.attempts} 次</span></div><div class="book-context">${esc(x.s.en)}</div><div class="book-meaning">${esc(x.s.zh||'')}</div><div class="book-meta">最近 ${Math.round(x.st.lastScore||0)} 分 · 最佳 ${Math.round(x.st.bestScore||0)} 分 · 第 ${x.st.firstDay||'?'} 天首次练习</div><div class="finish-row sentence-actions"><button class="secondary" data-history="${esc(x.id)}">历次记录</button><button class="primary" data-replay="${esc(x.id)}">再练一次</button></div></div>`;}
    render();}
  function showSentenceHistory(id,data){const st=Store.sentence(id),s=data.sentences[id];document.querySelector('.word-pop')?.remove();const div=document.createElement('div');div.className='word-pop history-pop';const rows=[...st.history].reverse().slice(0,30);div.innerHTML=`<button class="close">×</button><h3>历次练习 · ${esc(s?.year||'')} 真题</h3><div class="book-context">${esc(s?.en||'')}</div><div class="history-list">${rows.map((h,i)=>`<div class="history-row"><b>${rows.length-i}. ${Math.round(h.score||0)} 分</b><span>${esc((h.at||'').replace('T',' ').slice(0,16))}</span>${h.answer?`<div>${esc(h.answer)}</div>`:''}${h.feedback?.suggestion?`<small>${esc(h.feedback.suggestion)}</small>`:''}</div>`).join('')||'<div class="empty">暂无详细历史（旧版本记录只保留总次数）。</div>'}</div>`;document.body.appendChild(div);$('.close',div).onclick=()=>div.remove();}
  async function replaySentencePage(id){const data=await readyData(false),s=data.sentences[id];if(!s)return toast('句子不存在');const back='#wordbook';if(s.pool==='en_to_zh')return sentenceArrange('en2zh',{ids:[id],replay:true,back});if(s.pool==='zh_to_en')return sentenceArrange('zh2en',{ids:[id],replay:true,back});if(s.pool==='free_translation')return freeTranslationPage(data,{focus:[id],focusType:'translation'},{ids:[id],replay:true,back});if(s.pool==='analysis')return analysisPage(data,{focus:[id],focusType:'analysis'},{ids:[id],replay:true,back});toast('暂不支持重练这个句型');}

  async function statsPage(){
    const data=await readyData(false),w=Object.entries(Store.state.words),ss=Object.entries(Store.state.sentences),wvals=w.map(([,x])=>x),svals=ss.map(([,x])=>x),wacc=wvals.reduce((a,x)=>a+x.correct,0)/Math.max(1,wvals.reduce((a,x)=>a+x.attempts,0)),sacc=svals.reduce((a,x)=>a+x.correct,0)/Math.max(1,svals.reduce((a,x)=>a+x.attempts,0)),stable=wvals.filter(x=>x.stage>=5).length,weak=wvals.filter(x=>x.stage<=2&&x.attempts).length;
    const labels={en2zh:'英译汉',zh2en:'汉译英',free_translation:'自由翻译',analysis:'成分分析'};const modules=Object.keys(labels).map(m=>{const rows=svals.filter(x=>x.module===m),attempts=rows.reduce((a,x)=>a+x.attempts,0),score=rows.reduce((a,x)=>a+x.totalScore,0);return {m,n:rows.length,avg:attempts?Math.round(score/attempts):0};});
    const weakWords=w.filter(([,x])=>x.attempts>0).sort((a,b)=>(a[1].stage-b[1].stage)||(b[1].wrong-a[1].wrong)).slice(0,8);const weakSentences=ss.filter(([,x])=>x.attempts>0).sort((a,b)=>((a[1].totalScore/Math.max(1,a[1].attempts))-(b[1].totalScore/Math.max(1,b[1].attempts)))).slice(0,6);
    shell(`<main class="page">${head('学习记录','')}<section class="study-card"><div class="task-grid"><div class="task"><span class="emoji">📅</span><b>第 ${Store.state.currentDay}/100 天</b><small>账号起始 ${esc(Store.state.challengeStart||Auth.user?.challenge_start||Store.state.created)} · 按学习日推进</small></div><div class="task"><span class="emoji">📖</span><b>${w.length} 个词已接触</b><small>稳定掌握 ${stable} · 易错/模糊 ${weak}</small></div><div class="task"><span class="emoji">🎯</span><b>词汇正确率 ${Math.round(wacc*100)}%</b><small>包含连线与真题语境复习</small></div><div class="task"><span class="emoji">✍️</span><b>句子正确率 ${Math.round(sacc*100)}%</b><small>拼译、翻译、成分分析</small></div><div class="task"><span class="emoji">☁️</span><b>${Auth.user?'云端账号已登录':'尚未登录云端'}</b><small>${Auth.user?`${esc(Auth.user.display_name||Auth.user.username)} · ${CloudSync.status==='synced'?'已同步':'离线保存中'}`:'登录后可跨设备恢复'}</small></div><div class="task"><span class="emoji">🤖</span><b>AI 连接诊断</b><small id="aiDiagText">点击检查 Worker、Key、余额、模型与 JSON</small><button class="secondary mini-btn" id="checkAI">检查 AI</button></div></div><h3 class="section-title">哪里比较薄弱</h3><div class="weak-grid">${modules.map(x=>`<div class="weak-card"><b>${labels[x.m]}</b><span>${x.n?`平均 ${x.avg} 分 · 已练 ${x.n} 句`:'还没有练习记录'}</span></div>`).join('')}</div><div class="weak-columns"><div><h4>需要重点复习的词</h4>${weakWords.map(([term,x])=>`<div class="weak-row"><b>${esc(term)}</b><span>阶段 ${x.stage}/7 · 错 ${x.wrong}</span></div>`).join('')||'<div class="empty">暂时没有明显薄弱词。</div>'}</div><div><h4>目前分数较低的句子</h4>${weakSentences.map(([id,x])=>`<button class="weak-row weak-button" data-weak-sentence="${esc(id)}"><b>${esc(labels[x.module]||'真题句')}</b><span>${Math.round(x.totalScore/Math.max(1,x.attempts))} 分 · 再练</span></button>`).join('')||'<div class="empty">暂时没有句子记录。</div>'}</div></div><div class="finish-row"><button class="secondary" onclick="location.hash='#wordbook'">打开学习本</button><button class="secondary" onclick="location.hash='#account'">账号与云同步</button></div></section></main>`);
    $('#checkAI').onclick=async()=>{const b=$('#checkAI'),t=$('#aiDiagText');b.disabled=true;t.textContent='正在做真实自检…';const r=await aiDiagnostic(true);b.disabled=false;if(r.ok)t.innerHTML=`<span class="ai-ok">✓ Worker / Key / 余额 / 模型 / JSON 全部正常 · ${esc(r.version||'')}</span>`;else t.innerHTML=`<span class="ai-bad">✗ ${esc(aiErrorText(r.error||{}))}</span>`;};$$('[data-weak-sentence]').forEach(b=>b.onclick=()=>location.hash='#replay/'+encodeURIComponent(b.dataset.weakSentence));
  }

  async function route(){const h=(location.hash||'#home').slice(1);try{if(!Auth.user&&h!=='account'){location.hash='#account';return;}if(h==='account')return accountPage();if(h==='home')return home();if(h==='words')return wordsPage();if(h==='en2zh')return sentenceArrange('en2zh');if(h==='zh2en')return sentenceArrange('zh2en');if(h==='focus')return focusPage();if(h==='review')return reviewPage();if(h==='wordbook')return wordbookPage();if(h==='stats')return statsPage();if(h.startsWith('replay/'))return replaySentencePage(decodeURIComponent(h.slice(7)));location.hash=Auth.user?'#home':'#account';}catch(e){console.error(e);}}
  window.addEventListener('hashchange',route);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){Store.flush();CloudSync.push().catch(()=>{});}});
  window.addEventListener('pagehide',()=>{Store.flush();CloudSync.push().catch(()=>{});});
  window.addEventListener('beforeunload',()=>Store.save(false));
  window.addEventListener('load',async()=>{
    const logged=await Auth.restore();
    if(logged){await CloudSync.bootstrap({newAccount:false});}else{Store.setScope('guest');Store.load();await Store.hydrate();}
    if(!location.hash)location.hash=logged?'#home':'#account';route();
  });
})();
