(() => {
  'use strict';
  const CFG = window.XUANXUAN_CONFIG || {};
  const APP_VERSION = 'v22.0.0';
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
    fresh(){return {version:10,schemaVersion:10,currentDay:1,created:todayISO(),challengeStart:null,updatedAt:Date.now(),sound:true,music:false,accent:CFG.DEFAULT_ACCENT||'en-US',plans:{},days:{},words:{},sentences:{},aiDictionary:{},aiDiagnostics:null,drafts:{},reviewDays:{},errorDays:{}};},
    parse(raw){try{const o=typeof raw==='string'?JSON.parse(raw):raw;return this.valid(o)?o:null;}catch{return null;}},
    valid(o){return !!(o&&typeof o==='object'&&Number(o.currentDay)>=1&&o.days&&o.words&&o.sentences);},
    normalizeSentence(x){
      x=x&&typeof x==='object'?x:{};x.attempts=Number(x.attempts)||0;x.correct=Number(x.correct)||0;x.totalScore=Number(x.totalScore)||0;x.module ||= null;x.lastSeen ||= null;
      x.firstDay ||= null;x.bestScore=Number.isFinite(Number(x.bestScore))?Number(x.bestScore):0;x.lastScore=Number.isFinite(Number(x.lastScore))?Number(x.lastScore):0;x.history=Array.isArray(x.history)?x.history.slice(-30):[];return x;
    },
    normalize(o){
      o=this.valid(o)?o:this.fresh();o.version=10;o.schemaVersion=10;o.currentDay=Math.min(100,Math.max(1,Number(o.currentDay)||1));o.created ||= todayISO();o.challengeStart ||= null;o.updatedAt ||= Date.now();o.sound=o.sound!==false;o.music=!!o.music;o.accent ||= CFG.DEFAULT_ACCENT||'en-US';o.plans ||= {};o.days ||= {};o.words ||= {};o.sentences ||= {};o.aiDictionary ||= {};o.aiDiagnostics ||= null;o.drafts ||= {};o.reviewDays ||= {};o.errorDays ||= {};
      if(!o.v22LegacyMigrated){
        const legacyDay=o.days?.[o.currentDay]||{},date=todayISO(),rr=o.reviewDays[date] ||= {done:[]},er=o.errorDays[date] ||= {wordErrors:{},sentenceErrors:{}};
        if(!rr.done?.length&&Array.isArray(legacyDay.reviewDone))rr.done=[...legacyDay.reviewDone];
        if(!Object.keys(er.wordErrors||{}).length&&legacyDay.wordErrors)er.wordErrors={...legacyDay.wordErrors};
        if(!Object.keys(er.sentenceErrors||{}).length&&legacyDay.sentenceErrors)er.sentenceErrors={...legacyDay.sentenceErrors};
        o.v22LegacyMigrated=true;
      }
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
    day(n=this.state.currentDay){
      const d=this.state.days[n] ||= {};
      d.wordsDone ||= [];d.en2zhDone ||= [];d.zh2enDone ||= [];d.focusDone ||= [];d.reviewDone ||= [];
      d.wordErrors ||= {};d.sentenceErrors ||= {};d.completed=!!d.completed;d.completedAt ||= null;
      return d;
    },
    reviewDay(date=todayISO()){const row=this.state.reviewDays[date] ||= {done:[]};row.done ||= [];return row;},
    errorDay(date=todayISO()){const row=this.state.errorDays[date] ||= {wordErrors:{},sentenceErrors:{}};row.wordErrors ||= {};row.sentenceErrors ||= {};return row;},
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

  function shell(inner,opts={}){
    if(opts.minimal){
      $('#app').innerHTML=`<div class="app-shell minimal-shell">${inner}</div>`;
      return;
    }
    const who=Auth.user?esc((Auth.user.display_name||Auth.user.username||'我').slice(0,2)):'登录';
    $('#app').innerHTML=`<div class="app-shell"><header class="topbar"><div class="brand-mini">🌷 轩轩冲刺50分大作战！</div><div class="top-actions"><button id="accentBtn" class="icon-btn" title="切换英美音">${Store.state?.accent==='en-GB'?'🇬🇧':'🇺🇸'}</button><button id="soundBtn" class="icon-btn" title="音效">🔔</button><button id="musicBtn" class="icon-btn" title="轻音乐">♫</button><button id="accountBtn" class="account-btn" title="学习进度同步"><span id="cloudDot" class="cloud-dot"></span>${who}</button></div></header>${inner}</div>`;
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
    if(!Auth.user){let mode='login';const draw=()=>{Store.state ||= Store.fresh();shell(`<main class="page account-page"><section class="account-hero"><h1>☁️ 账号与云端学习记录</h1><p>同一个账号可以在不同浏览器、不同手机继续学习，每个人的100天进度互不影响。</p></section><section class="study-card auth-card"><div class="book-tabs"><button class="secondary ${mode==='login'?'active':''}" id="loginTab">登录</button><button class="secondary ${mode==='register'?'active':''}" id="registerTab">注册</button><button class="secondary ${mode==='reset'?'active':''}" id="resetTab">忘记密码</button></div>${mode==='register'?`<label class="form-label">昵称</label><input class="auth-input" id="displayName" maxlength="20" placeholder="例如：轩轩">`:''}<label class="form-label">账号</label><input class="auth-input" id="username" autocomplete="username" maxlength="24" placeholder="3–24位字母、数字或下划线">${mode==='reset'?`<label class="form-label">恢复码</label><input class="auth-input" id="recoveryCode" autocomplete="off" placeholder="注册时保存的恢复码">`:''}<label class="form-label">${mode==='reset'?'新密码':'密码'}</label><input class="auth-input" id="password" type="password" autocomplete="${mode==='login'?'current-password':'new-password'}" maxlength="72" placeholder="至少8位"><div class="auth-note">密码只在你的浏览器里经过 PBKDF2 派生后再发送，服务器不保存明文密码。注册成功后会生成一个恢复码，请单独保存。</div><div id="authMsg"></div><div class="finish-row"><button class="primary" id="authSubmit">${mode==='login'?'登录并恢复云端记录':mode==='register'?'注册并开始100天':'用恢复码重设密码'}</button></div></section></main>`);$('#loginTab').onclick=()=>{mode='login';draw();};$('#registerTab').onclick=()=>{mode='register';draw();};$('#resetTab').onclick=()=>{mode='reset';draw();};$('#authSubmit').onclick=async()=>{const btn=$('#authSubmit'),msg=$('#authMsg'),u=$('#username').value.trim(),pw=$('#password').value,dn=mode==='register'?$('#displayName').value.trim():'',rc=mode==='reset'?$('#recoveryCode').value.trim():'';if(!u||!pw||(mode==='register'&&!dn)||(mode==='reset'&&!rc)){msg.innerHTML='<div class="ai-error">请把信息填写完整。</div>';return;}btn.disabled=true;btn.textContent=mode==='login'?'正在登录…':mode==='register'?'正在注册…':'正在重设…';try{let out;if(mode==='login')out=await Auth.login(u,pw);else if(mode==='register')out=await Auth.register(u,pw,dn);else out=await Auth.resetPassword(u,rc,pw);if(out?.recovery_code)sessionStorage.setItem('xuanxuan50_recovery_once',out.recovery_code);await CloudSync.bootstrap({newAccount:mode==='register'});toast(mode==='login'?'登录成功，已恢复你的学习记录':mode==='register'?'注册成功，请先保存恢复码':'密码已重设，请先保存新的恢复码');location.hash=mode==='login'?'#welcome':'#account';route();}catch(e){msg.innerHTML=`<div class="ai-error">${esc(e?.message||'账号操作失败')}</div>`;btn.disabled=false;btn.textContent=mode==='login'?'登录并恢复云端记录':mode==='register'?'注册并开始100天':'用恢复码重设密码';}};};draw();return;}
    const last=CloudSync.lastSyncAt?new Date(CloudSync.lastSyncAt).toLocaleString():'尚未完成首次同步',status=CloudSync.status==='synced'?'已同步':CloudSync.status==='syncing'?'正在同步':'离线保存中';
    const recoveryOnce=sessionStorage.getItem('xuanxuan50_recovery_once')||'';shell(`<main class="page account-page">${head('账号与云同步','')}<section class="study-card">${recoveryOnce?`<div class="recovery-card"><b>🔐 请保存账号恢复码</b><code id="recoveryText">${esc(recoveryOnce)}</code><small>忘记密码时需要它。保存后不会再主动显示。</small><div class="finish-row"><button class="primary" id="copyRecovery">复制恢复码</button><button class="secondary" id="dismissRecovery">我已保存</button></div></div>`:''}<div class="account-profile"><div class="avatar">${esc((Auth.user.display_name||Auth.user.username).slice(0,1))}</div><div><h2>${esc(Auth.user.display_name||Auth.user.username)}</h2><div class="book-meta">@${esc(Auth.user.username)} · 100天开始于 ${esc(Auth.user.challenge_start||Store.state.challengeStart||'')}</div></div></div><div class="cloud-panel"><b>☁️ 云端状态：${status}</b><small>最后同步：${esc(last)}</small><small>当前学习进度：Day ${Store.state.currentDay}/100 · ${Object.keys(Store.state.words).length}词 · ${Object.keys(Store.state.sentences).length}句</small></div><div class="finish-row account-actions"><button class="primary" id="syncNow">立即同步</button><button class="secondary" id="exportBtn">导出备份</button><button class="secondary" id="importBtn">导入备份</button><input id="importFile" type="file" accept="application/json" hidden><button class="secondary danger-btn" id="logoutBtn">退出账号</button></div><div id="accountMsg"></div><div class="auth-note">换手机或换浏览器时，只需登录同一账号。云端记录会恢复到本机；断网时仍先保存在本机，网络恢复后再同步。</div></section></main>`);
    $('#copyRecovery')?.addEventListener('click',async()=>{const code=$('#recoveryText')?.textContent||'';try{await navigator.clipboard.writeText(code);toast('恢复码已复制');}catch{toast('请长按恢复码手动复制');}});$('#dismissRecovery')?.addEventListener('click',()=>{sessionStorage.removeItem('xuanxuan50_recovery_once');location.hash='#welcome';});
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

  const Drafts={
    key(kind,id){return `${Store.state.currentDay}:${kind}:${id}`;},
    get(kind,id){return Store.state.drafts?.[this.key(kind,id)]||null;},
    set(kind,id,value){Store.state.drafts ||= {};Store.state.drafts[this.key(kind,id)]={...(value||{}),updatedAt:Date.now()};Store.save(false,true);},
    clear(kind,id){if(Store.state.drafts?.[this.key(kind,id)]){delete Store.state.drafts[this.key(kind,id)];Store.save(false,true);}}
  };
  function markWordError(term,{resolved=false,source='practice'}={}){
    const d=Store.errorDay(),existing=d.wordErrors[term];if(resolved&&!existing)return;
    const row=existing||{wrongCount:0,resolved:false,firstAt:new Date().toISOString(),source};
    if(!resolved)row.wrongCount=(Number(row.wrongCount)||0)+1;row.resolved=!!resolved;row.lastAt=new Date().toISOString();row.source=source;d.wordErrors[term]=row;Store.save(false);
  }
  function markSentenceError(id,module,score,{resolved=null}={}){
    const d=Store.errorDay(),ok=resolved==null?Number(score)>=70:!!resolved,existing=d.sentenceErrors[id];if(ok&&!existing)return;
    const row=existing||{wrongCount:0,resolved:false,firstAt:new Date().toISOString(),module};
    if(!ok)row.wrongCount=(Number(row.wrongCount)||0)+1;row.resolved=ok;row.lastScore=Number(score)||0;row.lastAt=new Date().toISOString();row.module=module;d.sentenceErrors[id]=row;Store.save(false);
  }
  function todayErrorSummary(day=Store.errorDay()){
    const words=Object.entries(day.wordErrors||{}),sentences=Object.entries(day.sentenceErrors||{});
    return {
      wordTotal:words.length,wordOpen:words.filter(([,x])=>!x.resolved).length,
      sentenceTotal:sentences.length,sentenceOpen:sentences.filter(([,x])=>!x.resolved).length,
      total:words.length+sentences.length,open:words.filter(([,x])=>!x.resolved).length+sentences.filter(([,x])=>!x.resolved).length
    };
  }
  function advanceCompletedDayIfNeeded(){
    const d=Store.day();if(!d.completed||!d.completedAt||d.completedAt>=todayISO()||Store.state.currentDay>=100)return false;
    Store.state.currentDay++;Store.day();Store.save(false);return true;
  }

  function dueCandidates(lexicon){
    const now=todayISO(),map=new Map(lexicon.map(x=>[x.term,x]));const arr=[];
    for(const [term,st] of Object.entries(Store.state.words)){const rec=map.get(term);if(!rec)continue;if(st.nextReview&&st.nextReview<=now){arr.push({rec,st});}}
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
    const day=Store.state.currentDay,existing=Store.state.plans[day];
    if(existing){
      if(existing.reviewDate!==todayISO()){
        const rows=dueCandidates(data.lexicon||[]);existing.review=pickReviewLocal(rows,10);existing.reviewDate=todayISO();Store.state.plans[day]=existing;Store.save(false);
      }
      return existing;
    }
    const {schedule,lexicon,sentences}=data;const learned=new Set(Object.keys(Store.state.words));let fresh=[];
    for(let k=day-1;k<100&&fresh.length<70;k++)for(const t of (schedule.words[k]?.items||[]))if(!learned.has(t)&&!fresh.includes(t))fresh.push(t);
    const baselineWords=(schedule.words[day-1]?.items||[]).filter(t=>!learned.has(t));for(const t of fresh)if(baselineWords.length<30&&!baselineWords.includes(t))baselineWords.push(t);
    const dailyS=schedule.sentences[day-1]||{},poolCandidates=[],desiredPools=['en_to_zh','zh_to_en',dailyS.focus==='analysis'?'analysis':'free_translation'];
    for(const pool of desiredPools){let count=0;for(let k=day-1;k<100&&count<8;k++){const ds=schedule.sentences[k];const ids=pool==='en_to_zh'?ds.en_to_zh:pool==='zh_to_en'?ds.zh_to_en:((ds.focus===(pool==='analysis'?'analysis':'translation'))?ds.focus_ids:[]);for(const id of ids||[]){const st=Store.state.sentences[id];if(!st&&sentences[id]&&!poolCandidates.some(x=>x.id===id)){poolCandidates.push({id,pool,year:sentences[id].year,word_count:sentences[id].word_count});count++;if(count>=8)break;}}}}
    const reviewRows=dueCandidates(lexicon),baselineReview=pickReviewLocal(reviewRows,10),grouped={en_to_zh:[],zh_to_en:[],free_translation:[],analysis:[]};poolCandidates.forEach(x=>{if(grouped[x.pool]&&!grouped[x.pool].includes(x.id))grouped[x.pool].push(x.id);});const focusPool=dailyS.focus==='analysis'?'analysis':'free_translation';
    const plan={words:baselineWords.slice(0,30),en_to_zh:grouped.en_to_zh.slice(0,2),zh_to_en:grouped.zh_to_en.slice(0,2),focus:grouped[focusPool].slice(0,2),focusType:dailyS.focus,review:baselineReview,reviewDate:todayISO(),ai:false};Store.state.plans[day]=plan;Store.save();
    refinePlanInBackground(data,day,plan,fresh,reviewRows,poolCandidates).catch(()=>{});return plan;
  }
  async function refinePlanInBackground(data,day,plan,fresh,reviewRows,poolCandidates){
    if(!aiBase()||AIState.planTried.has(day))return;AIState.planTried.add(day);const d=Store.day(day);if(d.wordsDone.length||d.en2zhDone.length||d.zh2enDone.length||d.focusDone.length||Store.reviewDay().done.length)return;
    try{const lmap=new Map(data.lexicon.map(x=>[x.term,x]));const res=await ai('/daily-plan',{day,new_word_candidates:fresh.map(t=>{const r=lmap.get(t);return{id:t,band:r?.freq_band,count:r?.count||0,mastery:Store.state.words[t]?.stage||0};}),review_candidates:reviewRows.slice(0,40).map(x=>({id:x.rec.term,band:x.rec.freq_band,count:x.rec.count,wrong:x.st.wrong,mastery:x.st.stage,due:x.st.nextReview})),sentence_candidates:poolCandidates,weak_tags:weakTags()},{kind:'plan'});
      if(Store.state.currentDay!==day)return;const current=Store.day(day);if(current.wordsDone.length||current.en2zhDone.length||current.zh2enDone.length||current.focusDone.length||Store.reviewDay().done.length)return;
      if(Array.isArray(res.new_word_ids)){const ranked=enforceBandRatio(res.new_word_ids,fresh,t=>lmap.get(t)?.freq_band,[['high',15],['mid',9],['low',6]]);if(ranked.length===30)plan.words=ranked;}
      if(Array.isArray(res.review_ids)&&res.review_ids.length){const allReview=reviewRows.slice(0,40).map(x=>x.rec.term);plan.review=enforceBandRatio(res.review_ids,allReview,t=>lmap.get(t)?.freq_band,[['high',5],['mid',3],['low',2]]).slice(0,Math.min(10,allReview.length));}
      if(Array.isArray(res.sentence_ids)){const by={en_to_zh:[],zh_to_en:[],free_translation:[],analysis:[]};res.sentence_ids.forEach(id=>{const row=data.sentences[id];if(row&&by[row.pool]&&!by[row.pool].includes(id))by[row.pool].push(id);});if(by.en_to_zh.length>=2)plan.en_to_zh=by.en_to_zh.slice(0,2);if(by.zh_to_en.length>=2)plan.zh_to_en=by.zh_to_en.slice(0,2);const fp=plan.focusType==='analysis'?'analysis':'free_translation';if(by[fp].length)plan.focus=by[fp].slice(0,2);}
      plan.ai=true;plan.aiReason=String(res.reason||'');Store.state.plans[day]=plan;Store.save();if(location.hash==='#dashboard'||location.hash==='#home'||!location.hash)dashboardPage();
    }catch(e){console.warn('AI plan fallback:',aiErrorText(e));}
  }
  function weakTags(){const tags=[];const ss=Object.values(Store.state.sentences);if(ss.length&&ss.reduce((a,x)=>a+x.correct,0)/Math.max(1,ss.reduce((a,x)=>a+x.attempts,0))<.7)tags.push('翻译准确率偏低');return tags;}

  function dayCompletion(plan){
    const d=Store.day();
    const inPlan=(rows,ids)=>rows.filter(x=>(ids||[]).includes(x)).length;
    const w=plan?.words?.length?inPlan(d.wordsDone,plan.words):0;
    return {words:w,en2zh:inPlan(d.en2zhDone,plan?.en_to_zh),zh2en:inPlan(d.zh2enDone,plan?.zh_to_en),focus:inPlan(d.focusDone,plan?.focus),review:inPlan(Store.reviewDay().done,plan?.review)};
  }
  function focusRequired(plan){return plan?.focusType==='analysis'?2:1;}
  function allPracticeDone(plan){const c=dayCompletion(plan);return c.words>=30&&c.en2zh>=2&&c.zh2en>=2&&c.focus>=focusRequired(plan);}
  function estimatePracticeMinutes(c,plan){const left=Math.max(0,30-c.words)*.25+Math.max(0,2-c.en2zh)*2.1+Math.max(0,2-c.zh2en)*2.1+Math.max(0,focusRequired(plan)-c.focus)*3;return Math.max(0,Math.round(left));}
  function nextPracticeHash(plan){
    const c=dayCompletion(plan);
    if(c.words<30)return '#practice/words';
    if(c.en2zh<2)return '#practice/en2zh';
    if(c.zh2en<2)return '#practice/zh2en';
    if(c.focus<focusRequired(plan))return '#practice/focus';
    return '#daily-complete';
  }
  function nextPracticeLabel(plan){
    const h=nextPracticeHash(plan);return h.includes('/words')?'单词连线':h.includes('/en2zh')?'英译汉':h.includes('/zh2en')?'汉译英':h.includes('/focus')?(plan?.focusType==='analysis'?'成分分析':'今日翻译'):'今日完成';
  }
  function markDayCompleted(plan){
    if(!allPracticeDone(plan))return false;const d=Store.day();if(!d.completed){d.completed=true;d.completedAt=todayISO();Store.save();}return true;
  }

  async function welcomePage(){
    Sound.setQuiet(false);advanceCompletedDayIfNeeded();
    const d=Store.day(),name=Auth.user?esc(Auth.user.display_name||Auth.user.username):'轩轩',done=d.completed&&d.completedAt===todayISO();
    const encouragements=['今天也向目标靠近一点点 ✨','先做一点点，也很厉害 🌷','认真一点点，进步就会多一点点','坚持会把小小的努力变成很大的底气'];
    const line=encouragements[(Store.state.currentDay-1)%encouragements.length];
    shell(`<main class="welcome-page"><section class="welcome-hero">
      <div class="welcome-decor d1">🌸</div><div class="welcome-decor d2">✨</div><div class="welcome-decor d3">☁️</div><div class="welcome-decor d4">🍓</div><div class="welcome-decor d5">⭐</div><div class="welcome-decor d6">🐾</div>
      <div class="welcome-panel">
        <div class="welcome-kicker">Day ${Store.state.currentDay} / 100 · ${name}</div>
        <h1>轩轩冲刺50分大作战！</h1>
        <p>${done?'今天的正式任务已经完成啦，可以再回来看看 🌷':line}</p>
        <button class="welcome-start" id="startToday">${done?'今天完成啦，进去看看！':'开始今天的学习！'}</button>
      </div>
    </section></main>`,{minimal:true});
    $('#startToday').onclick=()=>location.hash='#daily-hub';
  }

  async function dailyHubPage(){
    Sound.setQuiet(false);advanceCompletedDayIfNeeded();
    let plan=null,err=null;try{plan=await ensurePlan(await Data.core());}catch(e){err=e;}
    const d=Store.day(),errors=todayErrorSummary(d),next=plan?nextPracticeLabel(plan):'今日任务',completed=!!(plan&&allPracticeDone(plan));
    shell(`<main class="hub-page"><section class="hub-hero">
      <div class="hub-title"><span>🌷 Day ${Store.state.currentDay}</span><b>${completed?'今天的正式练习完成啦':'今天想从哪里开始？'}</b><small>${plan?(completed?'可以自由复练，也可以看看复习和错题':`下一站：${esc(next)}`):'题库正在准备中'}</small></div>
      <div class="hub-triangle">
        <button class="animal-card cat-card" id="hubPractice"><span class="animal-face">🐱</span><b>${completed?'查看今日完成':'开始练习！'}</b><small>${completed?'看看今天的完成记录':`从「${esc(next)}」继续`}</small></button>
        <button class="animal-card sheep-card" id="hubReview"><span class="animal-face">🐑</span><b>复习回顾</b><small>到期复习 ${plan?.review?.length||0} · 今日错题 ${errors.open}</small></button>
        <button class="animal-card dog-card" id="hubDashboard"><span class="animal-face">🐶</span><b>返回首页</b><small>想练什么就自由选择</small></button>
      </div>
      ${err?`<div class="hub-note">题库暂时还没准备好：${esc(err.message||'请稍后刷新')}</div>`:''}
    </section></main>`,{minimal:true});
    $('#hubPractice').onclick=()=>{if(!plan)return location.hash='#dashboard';location.hash=nextPracticeHash(plan);};
    $('#hubReview').onclick=()=>location.hash='#review-center';
    $('#hubDashboard').onclick=()=>location.hash='#dashboard';
  }

  async function dashboardPage(){
    Sound.setQuiet(false);advanceCompletedDayIfNeeded();
    let meta=null,plan=null,releaseError=null,c={words:0,en2zh:0,zh2en:0,focus:0,review:0};
    try{meta=await Data.meta();const data=await Data.core();plan=await ensurePlan(data);c=dayCompletion(plan);}catch(e){releaseError=e;console.warn('release not ready:',e);}
    const ready=Boolean(meta?.ready&&plan&&!releaseError),day=Math.min(100,Store.state.currentDay);
    const done=ready?c.words+c.en2zh+c.zh2en+c.focus:0,total=ready?30+2+2+focusRequired(plan):35,pct=Math.min(100,Math.round(done/Math.max(1,total)*100));
    const focusTranslation=plan?.focusType!=='analysis',errs=todayErrorSummary(),formalDone=ready&&allPracticeDone(plan);
    const waiting=`<div class="setup"><b>正式题库还没有完整发布。</b><br>当前页面会主动拒绝加载半成品，所以你的学习记录不会被错误数据污染。<br><small>${esc(releaseError?.message||'正在等待完整发布包')}</small></div>`;
    shell(`<main class="page"><section class="hero"><div class="hero-copy"><h1>轩轩冲刺50分大作战！</h1><p>第 ${day} / 100 天 · ${Auth.user?esc(Auth.user.display_name||Auth.user.username)+' · 云端'+(CloudSync.status==='synced'?'已同步':'离线保存中'):'请登录后开始'} 🌷</p></div></section><section class="today-card"><div class="day-row"><div><div class="day-title">${formalDone?'今天正式练习完成啦 🎉':'今日练习'}</div><div class="day-sub">${ready?(formalDone?'下面可以按自己喜欢的顺序自由复练':`正式流程预计还需 ${estimatePracticeMinutes(c,plan)} 分钟${plan?.ai?' · AI已微调今日顺序':''}`):'正式题库发布中'}</div></div><b>${pct}%</b></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>${ready?`<div class="task-grid">
      ${taskCard('#words','🍓','单词连线',`${c.words}/30`,'每日 30 个')}
      ${taskCard('#en2zh','🫐','英译汉',`${c.en2zh}/2`,'真题意群拼译')}
      ${taskCard('#zh2en','🍒','汉译英',`${c.zh2en}/2`,'真题英语拼句')}
      ${taskCard('#review','🌱','今日复习',`${c.review}/${plan.review.length}`,'只包含遗忘曲线到期内容')}
      ${taskCard('#today-errors','❗','今日错题',`${errs.open} 待巩固`,'今天答错的内容单独练')}
      ${taskCard('#focus','🌸',focusTranslation?'今日翻译':'今日成分分析',`${Math.min(c.focus,focusRequired(plan))}/${focusRequired(plan)}`,focusTranslation?'1句必做 · 可反复评分':'精拆 → 粗拆 → 主干','focus-active')}
      ${taskCard('#focus','🕯️',focusTranslation?'成分分析':'翻译训练','隔日开启','明天轮到它','focus-inactive')}
      ${taskCard('#account','☁️','学习进度同步',Auth.user?'已登录':'未登录',Auth.user?'换设备也能继续学习':'注册后每人独立记录')}
      ${taskCard('#wordbook','📖','学习本',`${Object.keys(Store.state.words).length} 词 · ${Object.keys(Store.state.sentences).length} 句`,'单词 + 真题句 + 错题')}
      ${taskCard('#stats','✨','学习记录',`Day ${day}`,'进度、正确率与薄弱项')}
      </div><div class="dashboard-actions"><button class="secondary" id="backWelcome">回到欢迎页</button><button class="primary" id="guidedPractice">${formalDone?'查看今日完成':'按顺序继续今天练习'}</button></div>`:waiting}</section></main>`);
    $('#backWelcome')?.addEventListener('click',()=>location.hash='#welcome');
    $('#guidedPractice')?.addEventListener('click',()=>location.hash=formalDone?'#daily-complete':nextPracticeHash(plan));
    if(ready)Data.prefetch();
  }

  async function reviewCenterPage(){
    Sound.setQuiet(false);let plan=null;try{plan=await ensurePlan(await Data.core());}catch{}
    const errors=todayErrorSummary(),done=Store.reviewDay().done.length,due=plan?.review?.length||0;
    shell(`<main class="page">${head('复习回顾','', '#daily-hub')}<section class="study-card review-center">
      <div class="review-center-intro"><span class="review-big-emoji">🐑</span><div><h2>今天慢慢把记忆捡回来</h2><p>“今日复习”只看遗忘曲线到期内容；“今日错题”只看今天真正答错的内容，两套记录互不混淆。</p></div></div>
      <div class="review-center-grid">
        <button class="review-choice due-choice" id="goDue"><span>🌱</span><b>今日复习</b><small>到期 ${due} · 已完成 ${Math.min(done,due)}</small></button>
        <button class="review-choice error-choice" id="goErrors"><span>❗</span><b>今日错题</b><small>共错 ${errors.total} · 待巩固 ${errors.open}</small></button>
        <button class="review-choice book-choice" id="goBook"><span>📖</span><b>打开学习本</b><small>单词、真题句和历史错题</small></button>
      </div>
    </section></main>`);
    $('#goDue').onclick=()=>location.hash='#review';$('#goErrors').onclick=()=>location.hash='#today-errors';$('#goBook').onclick=()=>location.hash='#wordbook';
  }

  async function stageClearPage(module){
    Sound.setQuiet(false);let plan=null;try{plan=await ensurePlan(await Data.core());}catch{return location.hash='#dashboard';}
    const c=dayCompletion(plan),ok=module==='words'?c.words>=30:module==='en2zh'?c.en2zh>=2:module==='zh2en'?c.zh2en>=2:module==='focus'?c.focus>=focusRequired(plan):false;
    if(!ok){location.hash=`#practice/${module}`;return;}
    const map={words:['🍓','单词连线','30 个单词完成啦'],en2zh:['🫐','英译汉','两句真题拼译完成啦'],zh2en:['🍒','汉译英','两句英语拼句完成啦'],focus:['🌸',plan.focusType==='analysis'?'成分分析':'今日翻译','今天的专项练习也完成啦']};
    const [icon,title,msg]=map[module]||['✨','这一关','完成啦'];const next=nextPracticeHash(plan),last=next==='#daily-complete';
    shell(`<main class="celebrate-page"><section class="celebrate-card">
      <div class="sparkles"><i>✨</i><i>🌸</i><i>⭐</i><i>☁️</i><i>✨</i></div>
      <div class="celebrate-icon">${icon}</div><div class="celebrate-kicker">恭喜通过一关！</div><h1>${title}完成</h1><p>${msg}，辛苦啦。${last?'今天的正式任务已经全部完成！':'再往前一点点就好～'}</p>
      <div class="celebrate-actions"><button class="secondary" id="restNow">🌿 休息一会</button><button class="primary" id="continueNow">${last?'🎆 看看今天的完成礼花':'🐾 继续练习'}</button></div>
    </section></main>`,{minimal:true});
    $('#restNow').onclick=()=>location.hash='#welcome';$('#continueNow').onclick=()=>location.hash=next;
  }

  async function dailyCompletePage(){
    Sound.setQuiet(false);let plan=null;try{plan=await ensurePlan(await Data.core());}catch{return location.hash='#dashboard';}
    if(!allPracticeDone(plan)){location.hash=nextPracticeHash(plan);return;}markDayCompleted(plan);
    const c=dayCompletion(plan),label=plan.focusType==='analysis'?'成分分析':'今日翻译',errors=todayErrorSummary();
    shell(`<main class="celebrate-page final-celebrate"><section class="celebrate-card final-card">
      <div class="firework f1">✦</div><div class="firework f2">✧</div><div class="firework f3">✦</div><div class="firework f4">✧</div>
      <div class="celebrate-icon">🎆</div><div class="celebrate-kicker">Day ${Store.state.currentDay} 完成啦！</div><h1>恭喜完成今天练习！</h1><p>今天又离 50 分更近一点。剩下的时间可以自由复练，不会重复计算今日完成量。</p>
      <div class="complete-summary"><span>🍓 单词 ${c.words}/30</span><span>🫐 英译汉 ${c.en2zh}/2</span><span>🍒 汉译英 ${c.zh2en}/2</span><span>🌸 ${label} ${c.focus}/${focusRequired(plan)}</span></div>
      ${errors.open?`<div class="complete-note">今天还有 ${errors.open} 个错题可以在首页慢慢巩固。</div>`:'<div class="complete-note good-note">今天的错题也都已经巩固啦 🌷</div>'}
      <div class="celebrate-actions single"><button class="primary" id="completeBack">🏡 返回首页</button></div>
    </section></main>`,{minimal:true});
    Sound.sfx('finish');$('#completeBack').onclick=()=>location.hash='#dashboard';
  }

  async function home(){return dashboardPage();}
  function taskCard(h,e,t,n,s,cls=''){return `<a href="${h}" class="task ${cls}" style="text-decoration:none;color:inherit"><span class="emoji">${e}</span><b>${t}</b><small>${n} · ${s}</small></a>`;}

  async function readyData(quiet=false){try{const d=await Data.full();Sound.setQuiet(quiet);return d;}catch(e){toast('正式题库尚未完整发布');location.hash='#dashboard';setTimeout(dashboardPage,0);throw e;}}
  function head(title,stat,back='#dashboard'){return `<div class="module-head"><div class="module-title"><button class="back-btn" onclick="location.hash='${back}'">← 首页</button><h2>${title}</h2></div>${stat||''}</div>`;}

  async function wordsPage(opts={}){
    const data=await readyData(true),plan=await ensurePlan(data),day=Store.day(),done=new Set(day.wordsDone),terms=plan.words,flow=!!opts.flow;
    let round=Math.min(2,Math.floor([...done].filter(x=>terms.includes(x)).length/10));
    const render=()=>{
      const current=terms.slice(round*10,round*10+10),left=current.filter(t=>!done.has(t)),items=(left.length?left:current),lmap=data.lexIndex.byTerm;
      const chinese=shuffle(items.map(t=>({t,zh:lmap.get(t)?.sense_zh||lmap.get(t)?.dict_zh||''})));
      const stat=`<div class="module-stat">${flow?'第 1 / 4 关 · ':''}今日 ${done.size}/30 · 第 ${round+1}/3 轮<div class="thin-progress"><i style="width:${done.size/30*100}%"></i></div></div>`;
      shell(`<main class="page">${head('单词连线',stat)}<div class="split-layout"><section class="study-card"><div class="round-row"><span>先点英文，再点中文。读音按钮可以反复听。</span><span>高 : 中 : 低 = 5 : 3 : 2</span></div><div class="match-grid"><div class="match-col">${items.map(t=>`<button class="match-item eng" data-term="${esc(t)}"><span>${esc(t)}</span><span class="speak" data-speak="${esc(t)}">🔊</span></button>`).join('')}</div><div class="match-col">${chinese.map((x,i)=>`<button class="match-item zh" data-term="${esc(x.t)}"><span>${String.fromCharCode(97+i)}. ${esc(x.zh)}</span></button>`).join('')}</div></div><div id="roundDone" class="finish-row"></div></section><aside class="illustration"><img src="assets/word-match.jpg" alt="单词连线陪伴图"></aside></div></main>`);
      Sound.preload(items);bindMatch(items);
    };
    function bindMatch(items){
      let selected=null,wrongSet=new Set();
      $$('[data-speak]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();Sound.speak(b.dataset.speak);}));
      $$('.eng').forEach(b=>b.addEventListener('click',()=>{if(b.classList.contains('done'))return;$$('.eng').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');selected=b.dataset.term;}));
      $$('.zh').forEach(b=>b.addEventListener('click',()=>{
        if(!selected||b.classList.contains('done'))return;const e=$(`.eng[data-term="${CSS.escape(selected)}"]`);
        if(b.dataset.term===selected){
          e.classList.add('done','correct');b.classList.add('done','correct');const first=!wrongSet.has(selected);
          if(!done.has(selected)){done.add(selected);day.wordsDone.push(selected);updateWord(selected,first,null);Store.save();}
          Sound.sfx('ok');selected=null;
          if(items.every(t=>done.has(t))){
            $('#roundDone').innerHTML=round<2?'<button class="primary" id="nextRound">下一组 10 个</button>':`<button class="primary" id="finishWords">${flow?'本关完成，看看奖励 🌷':'今天的30个完成啦 🌷'}</button>`;
            $('#nextRound')?.addEventListener('click',()=>{round++;render();});
            $('#finishWords')?.addEventListener('click',()=>location.hash=flow?'#stage-clear/words':'#dashboard');
          }
        }else{
          wrongSet.add(selected);markWordError(selected,{source:'word_match'});e.classList.add('wrong');b.classList.add('wrong');Sound.sfx('bad');
          setTimeout(()=>{e.classList.remove('wrong');b.classList.remove('wrong');},300);
        }
      }));
    }
    render();
  }

  async function sentenceArrange(module,opts={}){
    const data=await readyData(false),plan=await ensurePlan(data),isEn2Zh=module==='en2zh',ids=opts.ids||(isEn2Zh?plan.en_to_zh:plan.zh_to_en),day=Store.day(),doneKey=isEn2Zh?'en2zhDone':'zh2enDone',done=new Set(day[doneKey]),replay=!!opts.replay,flow=!!opts.flow,back=opts.back||'#dashboard';
    const stage=isEn2Zh?2:3,stageHash=isEn2Zh?'en2zh':'zh2en',statNow=()=>{const n=ids.filter(id=>done.has(id)).length;return `<div class="module-stat">${flow?`第 ${stage} / 4 关 · `:''}今日 ${n}/${ids.length}<div class="thin-progress"><i style="width:${Math.round(n/Math.max(1,ids.length)*100)}%"></i></div></div>`;};
    let idx=replay?0:Math.max(0,ids.findIndex(id=>!done.has(id)));if(idx<0)idx=0;
    const render=()=>{
      const id=ids[idx],s=data.sentences[id];if(!s){toast('句子数据缺失');return;}
      const saved=Drafts.get(module,id),sourcePool=[...(isEn2Zh?s.zh_chunks:s.en_chunks),...(isEn2Zh?s.zh_distractors:s.en_distractors)];
      let pool=Array.isArray(saved?.pool)&&saved.pool.length===sourcePool.length?saved.pool:shuffle(sourcePool);
      let selected=Array.isArray(saved?.selected)?saved.selected.filter(i=>Number.isInteger(i)&&i>=0&&i<pool.length):[];
      if(!saved)Drafts.set(module,id,{pool,selected});
      shell(`<main class="page">${head(isEn2Zh?'英译汉':'汉译英',statNow(),back)}<div class="split-layout ${isEn2Zh?'image-left':''}">${isEn2Zh?`<aside class="illustration"><img src="assets/en-to-zh.jpg" alt="英译汉陪伴图"></aside>`:''}<section class="study-card"><div class="round-row"><span>${replay?'重练':'今日'}第 ${idx+1}/${ids.length} 句 · ${s.year} 真题</span><span>${replay?'学习本重练':done.size+'/2'}</span></div>${isEn2Zh?`<div class="sentence">${esc(s.en)}</div>`:`<div class="zh-prompt">${esc(s.zh)}</div>`}<div id="answer" class="answer-line"><span class="day-sub">按顺序点下面的意群块</span></div><div class="chips" id="choices">${pool.map((x,i)=>`<button class="chip" data-i="${i}">${esc(x)}</button>`).join('')}</div><div class="finish-row" style="gap:8px"><button class="secondary" id="undo">撤回</button><button class="primary" id="check">核对</button></div><div id="fb"></div></section>${!isEn2Zh?`<aside class="illustration"><img src="assets/zh-to-en.jpg" alt="汉译英陪伴图"></aside>`:''}</div></main>`);
      const ans=$('#answer'),buttons=$$('.chip');
      const save=()=>Drafts.set(module,id,{pool,selected});
      const redraw=()=>{ans.innerHTML=selected.length?selected.map((i,j)=>`<button class="answer-chip" data-j="${j}">${esc(pool[i])}</button>`).join(''):'<span class="day-sub">按顺序点下面的意群块</span>';buttons.forEach((b,i)=>b.classList.toggle('used',selected.includes(i)));};
      redraw();buttons.forEach((b,i)=>b.onclick=()=>{if(!selected.includes(i)){selected.push(i);save();redraw();}});$('#undo').onclick=()=>{selected.pop();save();redraw();};
      $('#check').onclick=()=>{
        const chosen=selected.map(i=>pool[i]),correctArr=isEn2Zh?s.zh_chunks:s.en_chunks,ok=chosen.length===correctArr.length&&chosen.every((x,i)=>x===correctArr[i]);
        recordSentence(id,module,ok,ok?100:0,{answer:chosen.join(' / '),meta:{reference:(isEn2Zh?s.zh:s.en)}});markSentenceError(id,module,ok?100:0,{resolved:ok});Drafts.clear(module,id);
        if(!replay&&!done.has(id)){done.add(id);day[doneKey].push(id);Store.save();}
        Sound.sfx(ok?'ok':'bad');
        const leaveHash=flow?`#stage-clear/${stageHash}`:back,leaveLabel=flow?'本关完成 →':(replay?'返回学习本':'返回首页');
        $('#fb').innerHTML=`<div class="feedback ${ok?'good':'bad'}"><b>${ok?'✓ 顺序正确':'这次没有完全拼对'}</b><div class="reference"><b>参考${isEn2Zh?'译文':'原句'}：</b><br>${esc(isEn2Zh?s.zh:s.en)}${renderTokens(s.en,id)}</div></div>${navButtons(idx,ids.length,replay,back,leaveHash,leaveLabel)}`;
        bindTokenClicks(data);bindSentenceNav(render,()=>idx,v=>idx=v,ids.length,replay,back,leaveHash);
      };
    };
    render();
  }
  function navButtons(idx,len,replay,back,leaveHash='',leaveLabel=''){const target=leaveHash||(replay?back:'#dashboard'),label=leaveLabel||(replay?'返回学习本':'返回首页');return `<div class="finish-row sentence-nav"><button class="secondary" id="prevSentence" ${idx<=0?'disabled':''}>← 上一句</button><button class="secondary" id="retrySentence">重做本句</button>${idx<len-1?'<button class="primary" id="nextSentence">下一句 →</button>':`<button class="primary" id="leaveSentence" data-leave="${esc(target)}">${esc(label)}</button>`}</div>`;}
  function bindSentenceNav(render,getIdx,setIdx,len,replay,back,leaveHash=''){$('#prevSentence')?.addEventListener('click',()=>{const i=getIdx();if(i>0){setIdx(i-1);render();}});$('#retrySentence')?.addEventListener('click',()=>{const i=getIdx();render(i);});$('#nextSentence')?.addEventListener('click',()=>{const i=getIdx();if(i<len-1){setIdx(i+1);render();}});$('#leaveSentence')?.addEventListener('click',()=>{location.hash=$('#leaveSentence').dataset.leave||leaveHash||back||'#dashboard';});}

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

  async function focusPage(opts={}){const data=await readyData(false),plan=await ensurePlan(data);if(plan.focusType==='analysis')return analysisPage(data,plan,opts);return freeTranslationPage(data,plan,opts);}
  async function freeTranslationPage(data,plan,opts={}){
    const flow=!!opts.flow,replay=!!opts.replay,back=opts.back||'#dashboard',baseIds=opts.ids||plan.focus,ids=flow?baseIds.slice(0,focusRequired(plan)):baseIds;
    const day=Store.day(),done=new Set(day.focusDone),statNow=()=>{const n=ids.filter(id=>done.has(id)).length;return `<div class="module-stat">${flow?'第 4 / 4 关 · ':''}今日 ${n}/${ids.length}<div class="thin-progress"><i style="width:${Math.round(n/Math.max(1,ids.length)*100)}%"></i></div></div>`;};
    let idx=replay?0:Math.max(0,ids.findIndex(id=>!done.has(id)));if(idx<0)idx=0;
    const render=()=>{
      const id=ids[idx],s=data.sentences[id],previous=Store.sentence(id).history.filter(x=>x.module==='free_translation').slice(-1)[0],draft=Drafts.get('free_translation',id);
      const initial=draft?.answer??previous?.answer??'';
      shell(`<main class="page">${head('翻译训练',statNow(),back)}<section class="study-card"><div class="round-row"><span>${replay?'重练':'今日'}第 ${idx+1}/${ids.length} 句 · ${s.year} 真题</span><span>${replay?'可无限重评':flow?'正式流程 · 可反复评分':'今天1句必做 · 第2句可选'}</span></div><div class="sentence">${esc(s.en)}</div><textarea id="translation" class="textarea" placeholder="写下你的中文翻译……">${esc(initial)}</textarea><div class="finish-row"><button class="primary" id="scoreBtn">AI 智能评分</button></div><div id="fb"></div></section></main>`);
      $('#translation').addEventListener('input',e=>Drafts.set('free_translation',id,{answer:e.target.value}));
      const leaveHash=flow?'#stage-clear/focus':back,leaveLabel=flow?'本关完成 →':(replay?'返回学习本':'返回首页');
      const scoreNow=async()=>{
        const answer=$('#translation').value.trim();if(!answer)return toast('先写下你的译文');Drafts.set('free_translation',id,{answer});
        const btn=$('#scoreBtn');btn.disabled=true;btn.textContent='正在评阅…';
        try{
          const r=await ai('/score-translation',{direction:'en_to_zh',source:s.en,reference:s.zh,answer},{kind:'score'}),ok=Number(r.score)>=70;
          recordSentence(id,'free_translation',ok,r.score,{answer,feedback:r});markSentenceError(id,'free_translation',r.score,{resolved:ok});
          if(!replay&&!done.has(id)){done.add(id);day.focusDone.push(id);Store.save();}
          showAI(r,s,id,data,ok,answer);
        }catch(e){
          btn.disabled=false;btn.textContent='重新尝试 AI 评分';
          $('#fb').innerHTML=`<div class="feedback bad"><b>AI评分没有完成</b><div class="ai-error">${esc(aiErrorText(e))}${e?.detail?`<small>${esc(e.detail)}</small>`:''}</div><div class="reference"><b>你的译文已经保存，不会丢失。</b><br><br><b>参考译文：</b><br>${esc(s.zh)}${renderTokens(s.en,id)}</div><div class="finish-row" style="gap:8px"><button class="secondary" id="selfBad">这句还不会</button><button class="secondary" id="selfGood">基本正确</button></div></div>`;
          bindTokenClicks(data);$('#selfGood').onclick=()=>selfFinish(true,80,answer);$('#selfBad').onclick=()=>selfFinish(false,40,answer);
        }
      };
      $('#scoreBtn').onclick=scoreNow;
      function showAI(r,s,id,data,ok,answer){
        $('#fb').innerHTML=`<div class="feedback ${ok?'good':'bad'}"><div class="ai-score"><div class="score-ring" style="--score:${r.score}"><b>${r.score}</b></div><div class="tips">${(r.strengths||[]).slice(0,2).map(x=>`<div class="ok">✓ ${esc(x)}</div>`).join('')}${(r.issues||[]).slice(0,3).map(x=>`<div class="warn">△ ${esc(x)}</div>`).join('')}<div>${esc(r.suggestion||'')}</div></div></div><div class="reference"><b>参考译文：</b><br>${esc(s.zh)}${renderTokens(s.en,id)}</div></div><div class="finish-row sentence-nav"><button class="secondary" id="prevSentence" ${idx<=0?'disabled':''}>← 上一句</button><button class="secondary" id="rescore">修改后再评</button>${idx<ids.length-1?'<button class="primary" id="nextSentence">下一句 →</button>':`<button class="primary" id="leaveSentence">${esc(leaveLabel)}</button>`}</div>`;
        bindTokenClicks(data);bindFreeNav();
      }
      function selfFinish(correct,score,answer){
        recordSentence(id,'free_translation',correct,score,{answer,feedback:{source:'self'}});markSentenceError(id,'free_translation',score,{resolved:correct});
        if(!replay&&!done.has(id)){done.add(id);day.focusDone.push(id);Store.save();}
        $('#fb').insertAdjacentHTML('beforeend',navButtons(idx,ids.length,replay,back,leaveHash,leaveLabel));bindSentenceNav(render,()=>idx,v=>idx=v,ids.length,replay,back,leaveHash);
      }
      function bindFreeNav(){
        $('#prevSentence')?.addEventListener('click',()=>{if(idx>0){idx--;render();}});
        $('#rescore')?.addEventListener('click',()=>{const btn=$('#scoreBtn');btn.disabled=false;btn.textContent='AI 再评分';$('#fb').innerHTML='';$('#translation').focus();});
        $('#nextSentence')?.addEventListener('click',()=>{if(idx<ids.length-1){idx++;render();}});
        $('#leaveSentence')?.addEventListener('click',()=>location.hash=leaveHash);
      }
    };
    render();
  }

  function analysisPage(data,plan,opts={}){
    const flow=!!opts.flow,replay=!!opts.replay,back=opts.back||'#dashboard',baseIds=opts.ids||plan.focus,ids=flow?baseIds.slice(0,focusRequired(plan)):baseIds;
    const day=Store.day(),done=new Set(day.focusDone),statNow=()=>{const n=ids.filter(id=>done.has(id)).length;return `<div class="module-stat">${flow?'第 4 / 4 关 · ':''}今日 ${n}/${ids.length}<div class="thin-progress"><i style="width:${Math.round(n/Math.max(1,ids.length)*100)}%"></i></div></div>`;};
    let idx=replay?0:Math.max(0,ids.findIndex(id=>!done.has(id)));if(idx<0)idx=0;
    const render=()=>{const id=ids[idx],a=data.analysis[id],s=data.sentences[id];if(!a)return toast('分析数据缺失');if(a.stage==='precise')renderPrecise(a,s,id);else if(a.stage==='coarse')renderCoarse(a,s,id);else renderStem(a,s,id);};
    const wrap=(a,s,body)=>{shell(`<main class="page">${head('成分分析',statNow(),back)}<section class="study-card"><div class="round-row"><span>${replay?'重练':'今日'}第 ${idx+1}/${ids.length} 句 · ${a.stage==='precise'?'精确拆分':a.stage==='coarse'?'粗略拆分':'抓主干'}</span><span>${s.year} 真题</span></div><div class="sentence">${esc(a.en)}</div>${body}<div id="analysisFb"></div></section></main>`);};
    const leaveHash=flow?'#stage-clear/focus':back,leaveLabel=flow?'本关完成 →':(replay?'返回学习本':'返回首页');
    function finishNav(){return navButtons(idx,ids.length,replay,back,leaveHash,leaveLabel);}
    function complete(id,score,detail={}){
      recordSentence(id,'analysis',score>=70,score,detail);markSentenceError(id,'analysis',score,{resolved:score>=70});Drafts.clear('analysis',id);
      if(!replay&&!done.has(id)){done.add(id);day.focusDone.push(id);Store.save();}
      Sound.sfx(score>=70?'ok':'bad');$('#analysisFb').insertAdjacentHTML('beforeend',finishNav());bindSentenceNav(render,()=>idx,v=>idx=v,ids.length,replay,back,leaveHash);
    }
    function reference(a,s,id){return `<div class="reference"><b>参考汉译：</b><br>${esc(a.zh||s.zh)}<br><br><b>最短主干：</b> ${esc(a.abridged_en||'')}<br><b>主干汉译：</b> ${esc(a.main_stem_zh||'')}<br><span class="day-sub">${esc(a.logic||'')}</span>${renderTokens(a.en,id)}</div>`;}
    function renderPrecise(a,s,id){
      const groups=a.groups||[],answers=new Map();groups.forEach((g,gi)=>(g.token_indices||[]).forEach(t=>{if(!answers.has(t))answers.set(t,gi);}));
      const saved=Drafts.get('analysis',id);let active=0,assign=saved?.stage==='precise'&&saved.assign&&typeof saved.assign==='object'?{...saved.assign}:{};
      wrap(a,s,`<div class="analysis-board"><div class="day-sub">先点一个结构框，再点上面的单词方块，把每个词放到它主要所属的结构里。</div><div class="token-bank">${a.tokens.map((t,i)=>`<button class="a-token ${assign[i]!=null?'assigned':''}" data-ti="${i}">${esc(t)}</button>`).join('')}</div><div class="zones">${groups.map((g,i)=>`<div class="zone ${i===0?'active':''}" data-zone="${i}"><strong>${esc(g.label)}</strong><span class="mini">${esc(g.note||'')}</span><div class="zone-chips" id="zone${i}"></div></div>`).join('')}</div><div class="finish-row" style="gap:8px"><button class="secondary" id="resetA">重置</button><button class="primary" id="checkA">核对拆分</button></div></div>`);
      $$('.zone').forEach(z=>z.onclick=()=>{$$('.zone').forEach(x=>x.classList.remove('active'));z.classList.add('active');active=+z.dataset.zone;});
      $$('.a-token').forEach(b=>b.onclick=()=>{assign[+b.dataset.ti]=active;b.classList.add('assigned');Drafts.set('analysis',id,{stage:'precise',assign});draw();});
      const draw=()=>groups.forEach((g,gi)=>{const el=$(`#zone${gi}`);if(el)el.innerHTML=Object.entries(assign).filter(([,v])=>Number(v)===gi).map(([k])=>`<span class="answer-chip">${esc(a.tokens[+k])}</span>`).join('');});draw();
      $('#resetA').onclick=()=>{assign={};$$('.a-token').forEach(x=>x.classList.remove('assigned'));Drafts.set('analysis',id,{stage:'precise',assign});draw();};
      $('#checkA').onclick=()=>{const lexical=a.tokens.map((t,i)=>/[A-Za-z0-9]/.test(t)?i:null).filter(x=>x!==null),right=lexical.filter(i=>Number(assign[i])===answers.get(i)).length,score=Math.round(right/Math.max(1,lexical.length)*100);$('#analysisFb').innerHTML=`<div class="feedback ${score>=70?'good':'bad'}"><b>结构归位 ${score}%</b>${reference(a,s,id)}</div>`;bindTokenClicks(data);complete(id,score,{answer:JSON.stringify(assign),meta:{stage:'precise'}});};
    }
    function renderCoarse(a,s,id){
      const segs=a.segments||[],labels=shuffle([...new Set(segs.map(x=>x.label))]),saved=Drafts.get('analysis',id),chosen=saved?.stage==='coarse'&&Array.isArray(saved.chosen)?saved.chosen:[];
      wrap(a,s,`<div class="day-sub">这一阶段不再逐词抠细节：先把整块看成主句、从句或修饰块。</div>${segs.map((seg,i)=>`<div class="coarse-row"><b>${esc((seg.token_indices||[]).map(k=>a.tokens[k]).join(' '))}</b><select data-seg="${i}"><option value="">选择这一块的作用</option>${labels.map(l=>`<option ${chosen[i]===l?'selected':''}>${esc(l)}</option>`).join('')}</select></div>`).join('')}<div class="finish-row"><button class="primary" id="checkA">核对层级</button></div>`);
      $$('select[data-seg]').forEach(el=>el.onchange=()=>{chosen[+el.dataset.seg]=el.value;Drafts.set('analysis',id,{stage:'coarse',chosen});});
      $('#checkA').onclick=()=>{let r=0;const vals=[];segs.forEach((g,i)=>{const v=$(`select[data-seg="${i}"]`).value;vals.push(v);if(v===g.label)r++;});const score=Math.round(r/Math.max(1,segs.length)*100);$('#analysisFb').innerHTML=`<div class="feedback ${score>=70?'good':'bad'}"><b>层级判断 ${score}%</b>${reference(a,s,id)}</div>`;bindTokenClicks(data);complete(id,score,{answer:vals.join(' | '),meta:{stage:'coarse'}});};
    }
    function renderStem(a,s,id){
      const target=new Set(a.main_stem_indices||[]),saved=Drafts.get('analysis',id),sel=new Set(saved?.stage==='main_stem'&&Array.isArray(saved.selected)?saved.selected:[]),savedText=saved?.stage==='main_stem'?String(saved.abridge||''):'';
      wrap(a,s,`<div class="day-sub">只点“不能再删”的主干词，然后把原句缩写成一句最短英语。主干选择占70%，缩写句占30%。</div><div class="token-bank">${a.tokens.map((t,i)=>`<button class="stem-token ${sel.has(i)?'on':''}" data-ti="${i}">${esc(t)}</button>`).join('')}</div><textarea class="textarea" id="abridge" placeholder="把原句缩写成一句最短英语……">${esc(savedText)}</textarea><div class="finish-row"><button class="primary" id="checkA">核对主干</button></div>`);
      const save=()=>Drafts.set('analysis',id,{stage:'main_stem',selected:[...sel],abridge:$('#abridge')?.value||''});
      $$('.stem-token').forEach(b=>b.onclick=()=>{const i=+b.dataset.ti;sel.has(i)?sel.delete(i):sel.add(i);b.classList.toggle('on',sel.has(i));save();});$('#abridge').oninput=save;
      $('#checkA').onclick=async()=>{
        const abridge=$('#abridge').value.trim();if(!abridge)return toast('请先写出缩写句');save();const btn=$('#checkA');btn.disabled=true;btn.textContent='正在核对…';
        const inter=[...sel].filter(x=>target.has(x)).length,precision=inter/Math.max(1,sel.size),recall=inter/Math.max(1,target.size),local=Math.round((precision+recall?2*precision*recall/(precision+recall):0)*100);
        $$('.stem-token').forEach(b=>{const i=+b.dataset.ti;if(target.has(i)&&!sel.has(i))b.classList.add('miss');});
        let aiPart=null,aiNote='';try{aiPart=await ai('/score-abridgement',{source:a.en,reference:a.abridged_en||'',answer:abridge},{kind:'abridge'});}catch(e){aiNote=`<div class="ai-error">缩写句 AI 评分暂不可用：${esc(aiErrorText(e))}<small>你的答案已经保存，主干选择仍会正常计分。</small></div>`;}
        const score=aiPart?Math.round(local*.7+Number(aiPart.score||0)*.3):local;
        $('#analysisFb').innerHTML=`<div class="feedback ${score>=70?'good':'bad'}"><b>综合 ${score}%</b><div class="book-meta">主干选择 ${local}%${aiPart?` · 缩写句 ${aiPart.score}%`:' · AI部分待补评'}</div>${aiPart?.issues?.length?`<div class="tips">${aiPart.issues.map(x=>`<div class="warn">△ ${esc(x)}</div>`).join('')}<div>${esc(aiPart.suggestion||'')}</div></div>`:''}${aiNote}${reference(a,s,id)}</div>`;bindTokenClicks(data);complete(id,score,{answer:abridge,feedback:aiPart,meta:{stage:'main_stem',selected:[...sel],localScore:local}});
      };
    }
    render();
  }

  async function reviewPage(){
    const data=await readyData(true),plan=await ensurePlan(data),reviewDay=Store.reviewDay(),done=new Set(reviewDay.done),terms=plan.review;
    let idx=Math.max(0,terms.findIndex(t=>!done.has(t)));if(idx<0)idx=0;
    const mastered=terms.filter(t=>(Store.state.words[t]?.stage||0)>=5).length;
    if(!terms.length){
      shell(`<main class="page">${head('今日复习','', '#review-center')}<section class="study-card empty"><div class="review-empty-icon">🌱</div><h2>今天没有到期复习</h2><p>记忆计划今天给你放个小假，想回顾时可以直接打开学习本。</p><div class="finish-row"><button class="secondary" id="reviewBook">📖 打开学习本</button></div></section></main>`);$('#reviewBook').onclick=()=>location.hash='#wordbook';return;
    }
    const render=()=>{
      const term=terms[idx],rec=data.lexIndex.byTerm.get(term),st=Store.word(term),ctx=chooseContext(rec,st,data),q=makeCloze(rec,ctx,data.lexicon),translation=data.ctx[ctx.sentence_id]||'',left=Math.max(0,terms.length-done.size);
      shell(`<main class="page">${head('今日复习',`<div class="module-stat">待复习 ${terms.length} · 已完成 ${done.size} · 已掌握 ${mastered}<div class="thin-progress"><i style="width:${done.size/terms.length*100}%"></i></div></div>`, '#review-center')}<section class="study-card"><div class="review-tools"><span>🌱 遗忘曲线复习 · 还剩 ${left}</span><button class="secondary mini-btn" id="reviewBook">📖 单词本</button></div><div class="round-row"><span>真题语境填词 · ${ctx.year}</span><span>答完可点每个词查看词义</span></div><div class="review-q">${esc(q.blank)}</div><div class="options">${q.options.map(o=>`<button class="option" data-opt="${esc(o)}">${esc(o)}</button>`).join('')}</div><div id="fb"></div></section></main>`);
      $('#reviewBook').onclick=()=>location.hash='#wordbook';
      $$('.option').forEach(b=>b.onclick=()=>{
        if($('#fb').innerHTML)return;const ok=b.dataset.opt===q.answer;b.classList.add(ok?'correct':'wrong');
        if(!ok){const good=$(`.option[data-opt="${CSS.escape(q.answer)}"]`);good?.classList.add('correct');markWordError(term,{source:'review'});}
        updateWord(term,ok,ctx.sentence_id);if(!done.has(term)){done.add(term);reviewDay.done.push(term);Store.save();}Sound.sfx(ok?'ok':'bad');
        $('#fb').innerHTML=`<div class="feedback ${ok?'good':'bad'}"><b>${ok?'✓ 正确':'正确答案：'+esc(q.answer)}</b><div class="reference"><b>原句：</b><br>${esc(ctx.text)}<br><br><b>汉译：</b><br>${esc(translation)}${renderTokens(ctx.text,ctx.sentence_id)}<br><b>${esc(rec.term)}</b>：${esc(rec.sense_zh)} · 七年出现 ${rec.count} 次</div></div><div class="finish-row"><button class="primary" id="nextR">${idx<terms.length-1?'下一题':'完成今日复习'}</button></div>`;
        bindTokenClicks(data);$('#nextR').onclick=()=>{if(idx<terms.length-1){idx++;render();}else location.hash='#review-center';};
      });
    };
    render();
  }

  async function todayErrorsPage(){
    const data=await readyData(true),day=Store.day(),summary=todayErrorSummary(day);
    const wordRows=Object.entries(day.wordErrors||{}).sort((a,b)=>(Number(a[1].resolved)-Number(b[1].resolved))||((b[1].wrongCount||0)-(a[1].wrongCount||0)));
    const sentenceRows=Object.entries(day.sentenceErrors||{}).sort((a,b)=>(Number(a[1].resolved)-Number(b[1].resolved))||((b[1].wrongCount||0)-(a[1].wrongCount||0)));
    const openWords=wordRows.filter(([,x])=>!x.resolved);
    const render=()=>{
      const sum=todayErrorSummary(day),current=openWords.find(([term])=>!day.wordErrors[term]?.resolved);
      let drill='';
      if(current){
        const [term,row]=current,rec=data.lexIndex.byTerm.get(term)||data.lexIndex.byForm.get(term);
        if(rec){
          const peers=shuffle(data.lexicon.filter(x=>x.term!==rec.term&&x.freq_band===rec.freq_band)).slice(0,3),opts=shuffle([{term:rec.term,zh:rec.sense_zh},...peers.map(x=>({term:x.term,zh:x.sense_zh}))]);
          drill=`<div class="error-drill"><div class="error-drill-top"><span>🍓 错词再练</span><small>${openWords.filter(([t])=>!day.wordErrors[t]?.resolved).length} 个待巩固</small></div><div class="error-word">${esc(rec.term)} <button class="speak" id="errorSpeak">🔊</button></div><div class="options">${opts.map(x=>`<button class="option" data-error-word="${esc(x.term)}">${esc(x.zh)}</button>`).join('')}</div><div id="errorWordFb"></div></div>`;
        }
      }else if(wordRows.length){drill='<div class="error-drill done-drill">🌷 今天的错词已经全部重新巩固过啦。</div>';}
      shell(`<main class="page">${head('今日错题',`<div class="module-stat">今天共错 ${sum.total} · 待巩固 ${sum.open}</div>`, '#review-center')}<section class="study-card"><div class="error-summary-grid"><div><b>${sum.wordOpen}</b><span>待巩固错词</span></div><div><b>${sum.sentenceOpen}</b><span>待巩固句子</span></div><div><b>${sum.total-sum.open}</b><span>今天已重新掌握</span></div></div>${summary.total===0?'<div class="empty"><div class="review-empty-icon">✨</div><h2>今天暂时没有错题</h2><p>保持这个状态，很棒！</p></div>':`${drill}<h3 class="section-title">今天做错过的句子</h3><div class="book-list">${sentenceRows.map(([id,row])=>{const st=Store.state.sentences[id],sen=data.sentences[id],label={en2zh:'英译汉',zh2en:'汉译英',free_translation:'自由翻译',analysis:'成分分析'}[row.module]||'真题句';return `<div class="book-item sentence-book-item ${row.resolved?'resolved-error':''}"><div class="book-top"><div><span class="book-term">${row.resolved?'✓ ':'❗ '}${esc(label)}</span> <span class="book-meta">${esc(sen?.year||'')} 真题</span></div><span class="badge">${row.resolved?'已巩固':'待巩固'} · 错 ${row.wrongCount||1}</span></div><div class="book-context">${esc(sen?.en||'')}</div><div class="book-meta">最近 ${Math.round(st?.lastScore||0)} 分 · 最佳 ${Math.round(st?.bestScore||0)} 分</div><div class="finish-row sentence-actions"><button class="primary" data-error-replay="${esc(id)}">${row.resolved?'再练一次':'去巩固'}</button></div></div>`;}).join('')||'<div class="empty">今天没有句子错题。</div>'}</div>`}</section></main>`);
      $('#errorSpeak')?.addEventListener('click',()=>{const cur=openWords.find(([t])=>!day.wordErrors[t]?.resolved);if(cur)Sound.speak(cur[0]);});
      $$('[data-error-word]').forEach(b=>b.onclick=()=>{
        const cur=openWords.find(([t])=>!day.wordErrors[t]?.resolved);if(!cur)return;const [term]=cur,ok=b.dataset.errorWord===term;b.classList.add(ok?'correct':'wrong');
        if(ok){updateWord(term,true,null);markWordError(term,{resolved:true,source:'today_error'});Sound.sfx('ok');$('#errorWordFb').innerHTML='<div class="feedback good"><b>✓ 这次掌握啦</b><div class="day-sub">正在把它从“待巩固”移到“已掌握”。</div></div>';setTimeout(render,650);}
        else{updateWord(term,false,null);markWordError(term,{source:'today_error'});Sound.sfx('bad');$('#errorWordFb').innerHTML='<div class="feedback bad"><b>再看一眼再试试</b></div>';}
      });
      $$('[data-error-replay]').forEach(b=>b.onclick=()=>location.hash='#error-replay/'+encodeURIComponent(b.dataset.errorReplay));
    };
    render();
  }

  function chooseContext(rec,st,data){const cs=rec.contexts||[];const c=cs.find(x=>!st.contextsUsed.includes(x.sentence_id))||cs[st.contextsUsed.length%Math.max(1,cs.length)]||{sentence_id:'',year:''};const src=data.corpus?.[c.sentence_id]||{};return {...c,year:c.year||src.year||'',page:c.page||src.page||'',text:src.en||''};}
  function makeCloze(rec,ctx,lexicon){let matched=rec.term;const forms=[...(rec.forms||[]),rec.term].sort((a,b)=>b.length-a.length);for(const f of forms){const re=new RegExp(`\\b${escapeRe(f)}\\b`,'i');if(re.test(ctx.text)){matched=(ctx.text.match(re)||[f])[0];break;}}const blank=ctx.text.replace(new RegExp(`\\b${escapeRe(matched)}\\b`,'i'),'_____');const pattern=matched.toLowerCase();const same=lexicon.filter(x=>x.term!==rec.term&&x.type===rec.type&&x.freq_band===rec.freq_band&&posKey(x.pos)===posKey(rec.pos));const opts=[matched];for(const d of shuffle(same)){const form=formLike(d,pattern);if(!opts.includes(form))opts.push(form);if(opts.length===4)break;}for(const d of shuffle(lexicon)){if(opts.length===4)break;const form=formLike(d,pattern);if(!opts.includes(form))opts.push(form);}return{blank,answer:matched,options:shuffle(opts)};}
  const escapeRe=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const posKey=p=>String(p||'').split('/')[0].split(':')[0];
  function formLike(rec,target){const fs=rec.forms||[rec.term];if(target.endsWith('ing'))return fs.find(x=>x.endsWith('ing'))||rec.term;if(target.endsWith('ed'))return fs.find(x=>x.endsWith('ed'))||rec.term;if(target.endsWith('s'))return fs.find(x=>x.endsWith('s'))||rec.term;return rec.term;}

  async function wordbookPage(){
    const data=await readyData(true);let tab='words',filter='all',search='';
    const render=()=>{
      const wordCount=Object.keys(Store.state.words).length,sentenceEntries=Object.entries(Store.state.sentences).filter(([,x])=>x?.attempts>0);
      const errorWords=Object.entries(Store.state.words).filter(([,x])=>Number(x.wrong)>0).sort((a,b)=>(b[1].wrong-a[1].wrong)||(a[1].stage-b[1].stage));
      const errorSentences=sentenceEntries.filter(([,x])=>(x.history||[]).some(h=>!h.correct||Number(h.score)<70)).sort((a,b)=>(a[1].bestScore||0)-(b[1].bestScore||0));
      const tabs=`<div class="book-tabs"><button class="secondary ${tab==='words'?'active':''}" id="tabWords">单词</button><button class="secondary ${tab==='sentences'?'active':''}" id="tabSentences">真题句</button><button class="secondary ${tab==='errors'?'active':''}" id="tabErrors">错题</button></div>`;
      if(tab==='words'){
        let rows=data.lexicon.filter(x=>Store.state.words[x.term]);if(search)rows=rows.filter(x=>x.term.includes(search.toLowerCase())||x.sense_zh.includes(search));if(filter!=='all')rows=rows.filter(x=>filter==='weak'?(Store.state.words[x.term].stage<=2||Store.state.words[x.term].wrong>0):x.freq_band===filter);rows.sort((a,b)=>(Store.state.words[b.term].learnedDay||0)-(Store.state.words[a.term].learnedDay||0)||b.count-a.count);
        shell(`<main class="page">${head('学习本',`<div class="module-stat">${wordCount} 词 · ${sentenceEntries.length} 句 · ${errorWords.length+errorSentences.length} 条错题</div>`)}<section class="study-card">${tabs}<div class="wordbook-tools"><input id="bookSearch" placeholder="搜索单词或中文义" value="${esc(search)}" style="flex:1;min-width:180px;border:1px solid var(--line);border-radius:14px;padding:10px"><button class="secondary" data-filter="all">全部</button><button class="secondary" data-filter="high">高频</button><button class="secondary" data-filter="mid">中频</button><button class="secondary" data-filter="low">低频</button><button class="secondary" data-filter="weak">易错/模糊</button></div><div class="book-list">${rows.slice(0,120).map(bookRow).join('')||'<div class="empty">还没有学过的单词。</div>'}</div>${rows.length>120?'<div class="empty">当前显示前 120 个，使用搜索或筛选可以更快定位。</div>':''}</section></main>`);
        bindTabs();$('#bookSearch').oninput=e=>{search=e.target.value;setTimeout(render,100);};$$('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;render();});$$('[data-book-speak]').forEach(b=>b.onclick=()=>Sound.speak(b.dataset.bookSpeak));
      }else if(tab==='sentences'){
        const rows=sentenceEntries.map(([id,st])=>({id,st,s:data.sentences[id]})).filter(x=>x.s).sort((a,b)=>(b.st.lastSeen||'').localeCompare(a.st.lastSeen||''));
        shell(`<main class="page">${head('学习本',`<div class="module-stat">${wordCount} 词 · ${rows.length} 句</div>`)}<section class="study-card">${tabs}<div class="book-list">${rows.map(sentenceRow).join('')||'<div class="empty">做过的英译汉、汉译英、翻译和成分分析会自动保存在这里。</div>'}</div></section></main>`);
        bindTabs();$$('[data-replay]').forEach(b=>b.onclick=()=>location.hash='#replay/'+encodeURIComponent(b.dataset.replay));$$('[data-history]').forEach(b=>b.onclick=()=>showSentenceHistory(b.dataset.history,data));
      }else{
        const wordHtml=errorWords.slice(0,80).map(([term,st])=>{const r=data.lexIndex.byTerm.get(term);return `<div class="book-item"><div class="book-top"><div><span class="book-term">❗ ${esc(term)}</span> <button class="speak" data-book-speak="${esc(term)}">🔊</button></div><span class="badge">累计错 ${st.wrong}</span></div><div class="book-meaning">${esc(r?.sense_zh||r?.dict_zh||'')}</div><div class="book-meta">记忆阶段 ${st.stage}/7 · 下次复习 ${st.nextReview||'待安排'}</div></div>`;}).join('');
        const sentenceHtml=errorSentences.map(([id,st])=>sentenceRow({id,st,s:data.sentences[id]})).join('');
        shell(`<main class="page">${head('学习本',`<div class="module-stat">${errorWords.length} 个易错词 · ${errorSentences.length} 个易错句</div>`)}<section class="study-card">${tabs}<h3 class="section-title">历史易错单词</h3><div class="book-list">${wordHtml||'<div class="empty">暂时没有历史错词。</div>'}</div><h3 class="section-title">历史易错句子</h3><div class="book-list">${sentenceHtml||'<div class="empty">暂时没有历史错句。</div>'}</div></section></main>`);
        bindTabs();$$('[data-book-speak]').forEach(b=>b.onclick=()=>Sound.speak(b.dataset.bookSpeak));$$('[data-replay]').forEach(b=>b.onclick=()=>location.hash='#replay/'+encodeURIComponent(b.dataset.replay));$$('[data-history]').forEach(b=>b.onclick=()=>showSentenceHistory(b.dataset.history,data));
      }
    };
    const bindTabs=()=>{$('#tabWords')?.addEventListener('click',()=>{tab='words';render();});$('#tabSentences')?.addEventListener('click',()=>{tab='sentences';render();});$('#tabErrors')?.addEventListener('click',()=>{tab='errors';render();});};
    function bookRow(r){const st=Store.state.words[r.term],dots=Array.from({length:8},(_,i)=>`<i class="dot ${i<=st.stage?'on':''}"></i>`).join(''),ctx=(r.contexts||[])[0],src=ctx?data.corpus?.[ctx.sentence_id]:null;return `<div class="book-item"><div class="book-top"><div><span class="book-term">${esc(r.term)}</span> <button class="speak" data-book-speak="${esc(r.term)}">🔊</button></div><span class="badge ${r.freq_band}">${r.freq_band==='high'?'高频':r.freq_band==='mid'?'中频':'低频'} · ${r.count}次</span></div><div class="book-meaning">${esc(r.sense_zh)}</div><div class="book-meta">${r.phonetic?'/'+esc(r.phonetic)+'/ · ':''}第 ${st.learnedDay} 天加入 · 下次复习 ${st.nextReview||'待安排'} · 累计错 ${st.wrong||0}</div><div class="mastery">${dots}</div>${src?`<div class="book-context">${esc(src.en)}</div>`:''}</div>`;}
    function sentenceRow(x){const label={en2zh:'英译汉',zh2en:'汉译英',free_translation:'自由翻译',analysis:'成分分析'}[x.st.module]||x.s?.pool||'真题句';return `<div class="book-item sentence-book-item"><div class="book-top"><div><span class="book-term">${esc(label)}</span> <span class="book-meta">${esc(x.s?.year||'')} 真题</span></div><span class="badge">练习 ${x.st.attempts} 次</span></div><div class="book-context">${esc(x.s?.en||'')}</div><div class="book-meaning">${esc(x.s?.zh||'')}</div><div class="book-meta">最近 ${Math.round(x.st.lastScore||0)} 分 · 最佳 ${Math.round(x.st.bestScore||0)} 分 · 第 ${x.st.firstDay||'?'} 天首次练习</div><div class="finish-row sentence-actions"><button class="secondary" data-history="${esc(x.id)}">历次记录</button><button class="primary" data-replay="${esc(x.id)}">再练一次</button></div></div>`;}
    render();
  }
  function showSentenceHistory(id,data){const st=Store.sentence(id),s=data.sentences[id];document.querySelector('.word-pop')?.remove();const div=document.createElement('div');div.className='word-pop history-pop';const rows=[...st.history].reverse().slice(0,30);div.innerHTML=`<button class="close">×</button><h3>历次练习 · ${esc(s?.year||'')} 真题</h3><div class="book-context">${esc(s?.en||'')}</div><div class="history-list">${rows.map((h,i)=>`<div class="history-row"><b>${rows.length-i}. ${Math.round(h.score||0)} 分</b><span>${esc((h.at||'').replace('T',' ').slice(0,16))}</span>${h.answer?`<div>${esc(h.answer)}</div>`:''}${h.feedback?.suggestion?`<small>${esc(h.feedback.suggestion)}</small>`:''}</div>`).join('')||'<div class="empty">暂无详细历史（旧版本记录只保留总次数）。</div>'}</div>`;document.body.appendChild(div);$('.close',div).onclick=()=>div.remove();}
  async function replaySentencePage(id,back='#wordbook'){const data=await readyData(false),s=data.sentences[id];if(!s)return toast('句子不存在');if(s.pool==='en_to_zh')return sentenceArrange('en2zh',{ids:[id],replay:true,back});if(s.pool==='zh_to_en')return sentenceArrange('zh2en',{ids:[id],replay:true,back});if(s.pool==='free_translation')return freeTranslationPage(data,{focus:[id],focusType:'translation'},{ids:[id],replay:true,back});if(s.pool==='analysis')return analysisPage(data,{focus:[id],focusType:'analysis'},{ids:[id],replay:true,back});toast('暂不支持重练这个句型');}

  async function statsPage(){
    const data=await readyData(false),w=Object.entries(Store.state.words),ss=Object.entries(Store.state.sentences),wvals=w.map(([,x])=>x),svals=ss.map(([,x])=>x),wacc=wvals.reduce((a,x)=>a+x.correct,0)/Math.max(1,wvals.reduce((a,x)=>a+x.attempts,0)),sacc=svals.reduce((a,x)=>a+x.correct,0)/Math.max(1,svals.reduce((a,x)=>a+x.attempts,0)),stable=wvals.filter(x=>x.stage>=5).length,weak=wvals.filter(x=>x.stage<=2&&x.attempts).length;
    const labels={en2zh:'英译汉',zh2en:'汉译英',free_translation:'自由翻译',analysis:'成分分析'};const modules=Object.keys(labels).map(m=>{const rows=svals.filter(x=>x.module===m),attempts=rows.reduce((a,x)=>a+x.attempts,0),score=rows.reduce((a,x)=>a+x.totalScore,0);return {m,n:rows.length,avg:attempts?Math.round(score/attempts):0};});
    const weakWords=w.filter(([,x])=>x.attempts>0).sort((a,b)=>(a[1].stage-b[1].stage)||(b[1].wrong-a[1].wrong)).slice(0,8);const weakSentences=ss.filter(([,x])=>x.attempts>0).sort((a,b)=>((a[1].totalScore/Math.max(1,a[1].attempts))-(b[1].totalScore/Math.max(1,b[1].attempts)))).slice(0,6);
    shell(`<main class="page">${head('学习记录','')}<section class="study-card"><div class="task-grid"><div class="task"><span class="emoji">📅</span><b>第 ${Store.state.currentDay}/100 天</b><small>账号起始 ${esc(Store.state.challengeStart||Auth.user?.challenge_start||Store.state.created)} · 按学习日推进</small></div><div class="task"><span class="emoji">📖</span><b>${w.length} 个词已接触</b><small>稳定掌握 ${stable} · 易错/模糊 ${weak}</small></div><div class="task"><span class="emoji">🎯</span><b>词汇正确率 ${Math.round(wacc*100)}%</b><small>包含连线与真题语境复习</small></div><div class="task"><span class="emoji">✍️</span><b>句子正确率 ${Math.round(sacc*100)}%</b><small>拼译、翻译、成分分析</small></div><div class="task"><span class="emoji">☁️</span><b>${Auth.user?'云端账号已登录':'尚未登录云端'}</b><small>${Auth.user?`${esc(Auth.user.display_name||Auth.user.username)} · ${CloudSync.status==='synced'?'已同步':'离线保存中'}`:'登录后可跨设备恢复'}</small></div><div class="task"><span class="emoji">🤖</span><b>AI 连接诊断</b><small id="aiDiagText">点击检查 Worker、Key、余额、模型与 JSON</small><button class="secondary mini-btn" id="checkAI">检查 AI</button></div></div><h3 class="section-title">哪里比较薄弱</h3><div class="weak-grid">${modules.map(x=>`<div class="weak-card"><b>${labels[x.m]}</b><span>${x.n?`平均 ${x.avg} 分 · 已练 ${x.n} 句`:'还没有练习记录'}</span></div>`).join('')}</div><div class="weak-columns"><div><h4>需要重点复习的词</h4>${weakWords.map(([term,x])=>`<div class="weak-row"><b>${esc(term)}</b><span>阶段 ${x.stage}/7 · 错 ${x.wrong}</span></div>`).join('')||'<div class="empty">暂时没有明显薄弱词。</div>'}</div><div><h4>目前分数较低的句子</h4>${weakSentences.map(([id,x])=>`<button class="weak-row weak-button" data-weak-sentence="${esc(id)}"><b>${esc(labels[x.module]||'真题句')}</b><span>${Math.round(x.totalScore/Math.max(1,x.attempts))} 分 · 再练</span></button>`).join('')||'<div class="empty">暂时没有句子记录。</div>'}</div></div><div class="finish-row"><button class="secondary" onclick="location.hash='#wordbook'">打开学习本</button><button class="secondary" onclick="location.hash='#account'">账号与云同步</button></div></section></main>`);
    $('#checkAI').onclick=async()=>{const b=$('#checkAI'),t=$('#aiDiagText');b.disabled=true;t.textContent='正在做真实自检…';const r=await aiDiagnostic(true);b.disabled=false;if(r.ok)t.innerHTML=`<span class="ai-ok">✓ Worker / Key / 余额 / 模型 / JSON 全部正常 · ${esc(r.version||'')}</span>`;else t.innerHTML=`<span class="ai-bad">✗ ${esc(aiErrorText(r.error||{}))}</span>`;};$$('[data-weak-sentence]').forEach(b=>b.onclick=()=>location.hash='#replay/'+encodeURIComponent(b.dataset.weakSentence));
  }

  async function route(){
    const h=(location.hash||'#welcome').slice(1);
    try{
      if(!Auth.user&&h!=='account'){location.hash='#account';return;}
      if(h==='account')return accountPage();
      if(h==='welcome')return welcomePage();
      if(h==='daily-hub')return dailyHubPage();
      if(h==='dashboard'||h==='home')return dashboardPage();
      if(h==='review-center')return reviewCenterPage();
      if(h==='today-errors')return todayErrorsPage();
      if(h==='daily-complete')return dailyCompletePage();
      if(h.startsWith('stage-clear/'))return stageClearPage(h.slice('stage-clear/'.length));
      if(h==='practice/words')return wordsPage({flow:true});
      if(h==='practice/en2zh')return sentenceArrange('en2zh',{flow:true,back:'#dashboard'});
      if(h==='practice/zh2en')return sentenceArrange('zh2en',{flow:true,back:'#dashboard'});
      if(h==='practice/focus')return focusPage({flow:true,back:'#dashboard'});
      if(h==='words')return wordsPage();
      if(h==='en2zh')return sentenceArrange('en2zh');
      if(h==='zh2en')return sentenceArrange('zh2en');
      if(h==='focus')return focusPage();
      if(h==='review')return reviewPage();
      if(h==='wordbook')return wordbookPage();
      if(h==='stats')return statsPage();
      if(h.startsWith('replay/'))return replaySentencePage(decodeURIComponent(h.slice(7)));
      if(h.startsWith('error-replay/'))return replaySentencePage(decodeURIComponent(h.slice('error-replay/'.length)),'#today-errors');
      location.hash=Auth.user?'#welcome':'#account';
    }catch(e){console.error(e);toast('这个页面暂时没有加载成功，请返回首页重试。');}
  }
  if(window.__XUANXUAN_TEST_MODE__)window.__XUANXUAN_TEST__={Store,dayCompletion,focusRequired,allPracticeDone,nextPracticeHash,todayErrorSummary,advanceCompletedDayIfNeeded,markDayCompleted};
  window.addEventListener('hashchange',route);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){Store.flush();CloudSync.push().catch(()=>{});}});
  window.addEventListener('pagehide',()=>{Store.flush();CloudSync.push().catch(()=>{});});
  window.addEventListener('beforeunload',()=>Store.save(false));
  window.addEventListener('load',async()=>{
    const logged=await Auth.restore();
    if(logged){await CloudSync.bootstrap({newAccount:false});}else{Store.setScope('guest');Store.load();await Store.hydrate();}
    if(logged)advanceCompletedDayIfNeeded();if(!location.hash)location.hash=logged?'#welcome':'#account';route();
  });
})();
