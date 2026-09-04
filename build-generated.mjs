import fs from 'node:fs';
import vm from 'node:vm';
import {searchWord,findLemma} from 'ecdict';
import {pipeline} from '@huggingface/transformers';

function loadWindow(file,key){const ctx={window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(file,'utf8'),ctx);return ctx.window[key]}
const D=loadWindow('data.js','KAOYAN_DATA');
const Q=loadWindow('quality-data.js','KAOYAN_QUALITY');
let previous={lexicon:{},sentences:{},meta:{}};
try{previous=loadWindow('generated-data.js','KAOYAN_GENERATED')||previous}catch{}

const skip=new Set((Q.skipWords||[]).map(x=>String(x).toLowerCase()));
const keepPhrases=new Set(Q.keepPhrases||Object.keys(Q.phrases||{}));
const lex=[...D.vocab,...D.phrases].filter(v=>v.type==='phrase'?keepPhrases.has(v.term):!skip.has(String(v.term).toLowerCase()));

function cleanText(x){return String(x||'').replace(/\r/g,'').trim()}
function coreZh(x){let lines=cleanText(x).split('\n').map(s=>s.trim()).filter(Boolean).filter(s=>!/^\[网络\]/.test(s));if(!lines.length)return '';let s=lines.slice(0,2).join('；').replace(/\s+/g,' ');return s.slice(0,150)}
function defs(x,pos=''){return cleanText(x).split('\n').map(s=>s.trim()).filter(Boolean).slice(0,3).map(definition=>({pos,definition}))}
function normalizeResult(r){if(!r)return null;if(Array.isArray(r))r=r[0];if(r?.dict)r={...r.dict,...r};return r}
async function ecdictLookup(term){try{let r=normalizeResult(await Promise.resolve(searchWord(term,{withResemble:true,withRoot:true,caseInsensitive:true})));if(!r?.translation){try{const lemma=await Promise.resolve(findLemma(term,true));const l=Array.isArray(lemma)?lemma[0]:lemma;if(l&&l!==term)r=normalizeResult(await Promise.resolve(searchWord(l,{withResemble:true,withRoot:true,caseInsensitive:true})))}catch{}}return r}catch{return null}}
let translator=null;
async function getTranslator(){if(!translator)translator=await pipeline('translation','Xenova/opus-mt-en-zh',{dtype:'q8'});return translator}
async function translateBatch(texts){const tr=await getTranslator();const res=await tr(texts);const arr=Array.isArray(res)?res:[res];return arr.map(x=>cleanText(x?.translation_text||x?.generated_text||''))}

const out={lexicon:{},sentences:{},meta:{}};
const missing=[];
for(let i=0;i<lex.length;i++){
  const v=lex[i],term=v.term;
  if(v.type==='phrase'&&Q.phrases?.[term]){
    const r=await ecdictLookup(term);
    out.lexicon[term]={zh:Q.phrases[term],phonetic:r?.phonetic||'',pos:r?.pos||'phrase',definitions:defs(r?.definition||'',r?.pos||'phrase'),source:r?.translation?'ECDICT + curated':'curated'};
  }else{
    const r=await ecdictLookup(term),zh=coreZh(r?.translation||'');
    if(zh){out.lexicon[term]={zh,phonetic:r?.phonetic||'',pos:r?.pos||'',definitions:defs(r?.definition||'',r?.pos||''),source:'ECDICT'}}
    else missing.push(v);
  }
  if(i%250===0)console.log('dictionary',i,'/',lex.length);
}

if(missing.length){console.log('dictionary fallback translation:',missing.length);for(let i=0;i<missing.length;i+=24){const batch=missing.slice(i,i+24);const zs=await translateBatch(batch.map(v=>v.term));for(let j=0;j<batch.length;j++){const z=coreZh(zs[j]);if(z)out.lexicon[batch[j].term]={zh:z,phonetic:'',pos:'',definitions:[],source:'MT fallback'}}}}

// Preserve all manually curated sentence translations first.
for(const s of D.sentences){const old=previous.sentences?.[s.id],z=s.zh||(typeof old==='string'?old:old?.zh||old?.translation||'');if(z)out.sentences[s.id]={zh:z,source:s.manual_translation?'manual':'curated'}}
const todo=D.sentences.filter(s=>!out.sentences[s.id]);
console.log('sentence translations to build:',todo.length);
for(let i=0;i<todo.length;i+=12){const batch=todo.slice(i,i+12);const zs=await translateBatch(batch.map(s=>s.en));for(let j=0;j<batch.length;j++){const z=cleanText(zs[j]);if(z)out.sentences[batch[j].id]={zh:z,source:'local MT'}}console.log('sentences',Math.min(i+12,todo.length),'/',todo.length)}

const lexMissing=lex.filter(v=>!out.lexicon[v.term]?.zh);
const sentMissing=D.sentences.filter(s=>!out.sentences[s.id]?.zh);
out.meta={version:5,builtAt:new Date().toISOString(),dictionary:'ECDICT',translationModel:'Xenova/opus-mt-en-zh',lexiconTotal:lex.length,lexiconReady:lex.length-lexMissing.length,sentenceTotal:D.sentences.length,sentenceReady:D.sentences.length-sentMissing.length};
if(lexMissing.length||sentMissing.length){console.error('QA FAIL',{lexMissing:lexMissing.map(v=>v.term),sentMissing:sentMissing.map(s=>s.id)});process.exit(2)}
fs.writeFileSync('generated-data.js','window.KAOYAN_GENERATED='+JSON.stringify(out)+';\n');
fs.writeFileSync('build-report.json',JSON.stringify(out.meta,null,2)+'\n');
console.log('QA PASS',out.meta);
