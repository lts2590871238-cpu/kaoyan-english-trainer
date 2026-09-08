$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$appPath = Join-Path $root "app.js"
$cssPath = Join-Path $root "v22.css"
$indexPath = Join-Path $root "index.html"

if (!(Test-Path $appPath)) { throw "没有找到 app.js。请把本脚本放到 kaoyan-english-trainer 仓库根目录后再运行。" }
if (!(Test-Path $cssPath)) { throw "没有找到 v22.css。请把本脚本放到 kaoyan-english-trainer 仓库根目录后再运行。" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $appPath "$appPath.bak-$stamp"
Copy-Item $cssPath "$cssPath.bak-$stamp"
if (Test-Path $indexPath) { Copy-Item $indexPath "$indexPath.bak-$stamp" }

$app = Get-Content $appPath -Raw -Encoding UTF8

function Replace-Required {
    param(
        [string]$Text,
        [string]$Old,
        [string]$New,
        [string]$Label
    )
    if (-not $Text.Contains($Old)) {
        throw "补丁失败：没有找到 [$Label] 对应的旧代码。仓库可能已经更新，请不要继续覆盖。"
    }
    return $Text.Replace($Old, $New)
}

$app = Replace-Required $app "const APP_VERSION = 'v22.0.0';" "const APP_VERSION = 'v22.1.0';" "版本号"

$app = Replace-Required $app `
"const data=await readyData(true),day=Store.day(),summary=todayErrorSummary(day);" `
"const data=await readyData(true),day=Store.errorDay(),summary=todayErrorSummary(day);" `
"今日错题数据源"

$app = $app.Replace("summary.total===0?", "sum.total===0?")

$app = Replace-Required $app `
'<div id="roundDone" class="finish-row"></div>' `
'<div id="wordMatchFb" class="word-match-feedback" aria-live="polite"></div><div id="roundDone" class="finish-row"></div>' `
"单词连线反馈区"

$oldSuccess = @'
      if(b.dataset.term===selected){
        e.classList.add('done','correct');b.classList.add('done','correct');const first=!wrongSet.has(selected);
        if(!done.has(selected)){done.add(selected);day.wordsDone.push(selected);updateWord(selected,first,null);Store.save();}
        Sound.sfx('ok');selected=null;
'@

$newSuccess = @'
      if(b.dataset.term===selected){
        const term=selected,hadWrong=wrongSet.has(term);
        e.classList.add('done','correct');b.classList.add('done','correct');e.disabled=true;b.disabled=true;
        if(!done.has(term)){done.add(term);day.wordsDone.push(term);updateWord(term,true,null);Store.save();}
        const fb=$('#wordMatchFb');
        if(fb)fb.innerHTML=hadWrong
          ?`<div class="feedback good compact-feedback"><b>✓ 这次配对正确</b><span>${esc(term)} 刚才错过，所以仍保留在“今日错题”里，稍后再巩固一次。</span></div>`
          :`<div class="feedback good compact-feedback"><b>✓ 配对正确</b><span>继续找下一组。</span></div>`;
        Sound.sfx('ok');selected=null;
'@

$app = Replace-Required $app $oldSuccess $newSuccess "单词正确判定"

$oldWrong = @'
      }else{
        wrongSet.add(selected);markWordError(selected,{source:'word_match'});e.classList.add('wrong');b.classList.add('wrong');Sound.sfx('bad');
        setTimeout(()=>{e.classList.remove('wrong');b.classList.remove('wrong');},300);
      }
'@

$newWrong = @'
      }else{
        const term=selected;
        wrongSet.add(term);
        updateWord(term,false,null);
        markWordError(term,{source:'word_match'});
        e.classList.add('wrong');b.classList.add('wrong');
        const fb=$('#wordMatchFb');
        if(fb)fb.innerHTML=`<div class="feedback bad compact-feedback"><b>✗ 配错啦，已经判错</b><span>${esc(term)} 已立即记入今日错题。别急，保持这个英文选中，再找一次正确释义。</span></div>`;
        Sound.sfx('bad');
        setTimeout(()=>{e.classList.remove('wrong');b.classList.remove('wrong');},650);
      }
'@

$app = Replace-Required $app $oldWrong $newWrong "单词错误判定"

$newPrecise = @'
    function renderPrecise(a,s,id){
      const groups=a.groups||[],answers=new Map();
      groups.forEach((g,gi)=>(g.token_indices||[]).forEach(t=>{if(!answers.has(t))answers.set(t,gi);}));
      const lexical=a.tokens.map((t,i)=>/[A-Za-z0-9]/.test(t)?i:null).filter(x=>x!==null);
      const saved=Drafts.get('analysis',id);
      let assign=saved?.stage==='precise'&&saved.assign&&typeof saved.assign==='object'?{...saved.assign}:{};
      let picked=null;

      wrap(a,s,`<div class="analysis-board">
        <div class="analysis-drop-hint">
          <b>先自己找结构，不提前看答案。</b>
          <span>电脑：把单词拖进下面的结构区；手机：先点一个单词，再点目标结构区。结构解释会在提交以后才展开。</span>
          <small id="analysisRemain"></small>
        </div>
        <div class="token-bank">${a.tokens.map((t,i)=>`<button type="button" class="a-token ${assign[i]!=null?'assigned':''}" draggable="true" data-ti="${i}">${esc(t)}</button>`).join('')}</div>
        <div class="zones">${groups.map((g,i)=>`<div class="zone" data-zone="${i}" role="button" tabindex="0"><strong>${esc(g.label||`结构 ${i+1}`)}</strong><span class="mini">把属于这一结构的词放到这里</span><div class="zone-chips" id="zone${i}"></div></div>`).join('')}</div>
        <div class="finish-row" style="gap:8px"><button class="secondary" id="resetA">重置</button><button class="primary" id="checkA">核对拆分</button></div>
      </div>`);

      const save=()=>Drafts.set('analysis',id,{stage:'precise',assign});

      const draw=()=>{
        $$('.a-token').forEach(b=>{
          const i=+b.dataset.ti;
          b.classList.toggle('assigned',assign[i]!=null);
          b.classList.toggle('picked',picked===i);
          b.setAttribute('aria-pressed',picked===i?'true':'false');
        });
        groups.forEach((g,gi)=>{
          const el=$(`#zone${gi}`);
          if(!el)return;
          el.innerHTML=Object.entries(assign)
            .filter(([,v])=>Number(v)===gi)
            .sort((a,b)=>Number(a[0])-Number(b[0]))
            .map(([k])=>`<button type="button" class="answer-chip analysis-chip" data-unassign="${k}" title="点一下放回词库">${esc(a.tokens[+k])}</button>`)
            .join('');
        });
        const missing=lexical.filter(i=>assign[i]==null).length;
        const remain=$('#analysisRemain');
        if(remain)remain.textContent=missing?`还有 ${missing} 个英文词没有归位`:'所有英文词都已经归位，可以核对了';
      };

      const place=(ti,gi)=>{
        if(!Number.isInteger(ti)||!Number.isInteger(gi)||gi<0||gi>=groups.length)return;
        assign[ti]=gi;
        picked=null;
        save();
        draw();
      };

      $$('.a-token').forEach(b=>{
        b.onclick=()=>{
          picked=+b.dataset.ti;
          draw();
        };
        b.ondragstart=e=>{
          const ti=+b.dataset.ti;
          e.dataTransfer.setData('text/plain',String(ti));
          e.dataTransfer.effectAllowed='move';
          b.classList.add('dragging');
        };
        b.ondragend=()=>b.classList.remove('dragging');
      });

      $$('.zone').forEach(z=>{
        z.onclick=e=>{
          if(e.target.closest('[data-unassign]'))return;
          if(picked!=null)place(picked,+z.dataset.zone);
        };
        z.onkeydown=e=>{
          if((e.key==='Enter'||e.key===' ')&&picked!=null){e.preventDefault();place(picked,+z.dataset.zone);}
        };
        z.ondragover=e=>{
          e.preventDefault();
          e.dataTransfer.dropEffect='move';
          z.classList.add('drag-hover');
        };
        z.ondragleave=()=>z.classList.remove('drag-hover');
        z.ondrop=e=>{
          e.preventDefault();
          z.classList.remove('drag-hover');
          const ti=Number(e.dataTransfer.getData('text/plain'));
          place(ti,+z.dataset.zone);
        };
      });

      $('.zones').addEventListener('click',e=>{
        const chip=e.target.closest('[data-unassign]');
        if(!chip)return;
        e.stopPropagation();
        delete assign[chip.dataset.unassign];
        picked=null;
        save();
        draw();
      });

      $('#resetA').onclick=()=>{
        assign={};
        picked=null;
        save();
        draw();
      };

      $('#checkA').onclick=()=>{
        const missing=lexical.filter(i=>assign[i]==null);
        if(missing.length){
          toast(`还有 ${missing.length} 个词没有归位，先自己找完再核对`);
          return;
        }
        const right=lexical.filter(i=>Number(assign[i])===answers.get(i)).length;
        const score=Math.round(right/Math.max(1,lexical.length)*100);
        const wrong=lexical.filter(i=>Number(assign[i])!==answers.get(i));
        $$('.a-token').forEach(b=>{
          const i=+b.dataset.ti;
          if(!/[A-Za-z0-9]/.test(a.tokens[i]))return;
          b.classList.toggle('analysis-right',Number(assign[i])===answers.get(i));
          b.classList.toggle('analysis-wrong',Number(assign[i])!==answers.get(i));
        });
        const detail=groups.map((g,gi)=>{
          const words=(g.token_indices||[]).map(i=>a.tokens[i]).join(' ');
          return `<div class="analysis-answer-row"><b>${esc(g.label||`结构 ${gi+1}`)}</b><span>${esc(words)}</span>${g.note?`<small>${esc(g.note)}</small>`:''}</div>`;
        }).join('');
        $('#analysisFb').innerHTML=`<div class="feedback ${score>=70?'good':'bad'}"><b>结构归位 ${score}%</b><div class="day-sub">${wrong.length?`有 ${wrong.length} 个词需要再看看。下面现在才展开标准拆分和原因。`:'全部归位正确！现在看看为什么这样拆。'}</div><div class="analysis-answer-detail"><h3>核对后答案</h3>${detail}</div>${reference(a,s,id)}</div>`;
        bindTokenClicks(data);
        const btn=$('#checkA');if(btn){btn.disabled=true;btn.textContent='已经核对';}
        complete(id,score,{answer:JSON.stringify(assign),meta:{stage:'precise'}});
      };

      draw();
    }
'@

$pattern = '(?s)    function renderPrecise\(a,s,id\)\{.*?\r?\n    \}\r?\n\r?\n    function renderCoarse'
$rx = [regex]::new($pattern)
if (-not $rx.IsMatch($app)) {
    throw "补丁失败：没有找到精确拆分 renderPrecise()。仓库可能已经更新。"
}
$app = $rx.Replace($app, $newPrecise + "`r`n    function renderCoarse", 1)

Set-Content $appPath $app -Encoding UTF8

$css = Get-Content $cssPath -Raw -Encoding UTF8
if (-not $css.Contains("/* V22.1 correctness + anatomy interaction hotfix */")) {
$cssPatch = @'

/* V22.1 correctness + anatomy interaction hotfix */
.word-match-feedback{min-height:0;margin-top:10px}.word-match-feedback:empty{display:none}.compact-feedback{display:flex;align-items:flex-start;gap:10px;padding:11px 13px;margin-top:0}.compact-feedback b{white-space:nowrap}.compact-feedback span{line-height:1.5}.match-item.done{pointer-events:none}
.analysis-drop-hint{display:grid;gap:5px;padding:13px 15px;border:1px solid #dceaf1;background:#f6fbfe;border-radius:17px;line-height:1.55}.analysis-drop-hint b{color:#416f86}.analysis-drop-hint span,.analysis-drop-hint small{color:var(--muted)}.analysis-drop-hint small{font-weight:800}
.a-token[draggable="true"]{cursor:grab;user-select:none}.a-token.dragging{opacity:.4;transform:scale(.96)}.a-token.picked{outline:3px solid rgba(191,228,247,.95);background:#eef7ff}.a-token.analysis-right{border-color:#98cfac;background:#eef9f2}.a-token.analysis-wrong{border-color:#e49bb0;background:#fff1f4}
.zone{transition:border-color .16s,background .16s,transform .16s}.zone.drag-hover{border-color:#7ebbd8;background:#eef9ff;transform:translateY(-2px)}.zone .mini{display:block;margin-bottom:8px}.analysis-chip{border:0;cursor:pointer}.analysis-chip:hover{background:#ffeef3}
.analysis-answer-detail{display:grid;gap:9px;margin-top:15px;padding:14px;border:1px solid #e7ddd6;border-radius:16px;background:#fff}.analysis-answer-detail h3{margin:0 0 3px}.analysis-answer-row{display:grid;grid-template-columns:minmax(110px,.7fr) minmax(0,1.3fr);gap:5px 12px;padding:9px 10px;border-radius:12px;background:#faf7f3}.analysis-answer-row b{color:#5b6574}.analysis-answer-row span{font-family:Georgia,"Times New Roman",serif}.analysis-answer-row small{grid-column:1/-1;color:var(--muted);line-height:1.55}
@media(max-width:700px){.compact-feedback{display:grid}.analysis-answer-row{grid-template-columns:1fr}.analysis-answer-row small{grid-column:auto}.a-token[draggable="true"]{cursor:pointer}}
'@
    $css = $css.TrimEnd() + "`r`n" + $cssPatch + "`r`n"
    Set-Content $cssPath $css -Encoding UTF8
}

if (Test-Path $indexPath) {
    $index = Get-Content $indexPath -Raw -Encoding UTF8
    $index = $index.Replace("v22.css?v=22.0.0","v22.css?v=22.1.0")
    $index = $index.Replace("app.js?v=22.0.0","app.js?v=22.1.0")
    Set-Content $indexPath $index -Encoding UTF8
}

Write-Host ""
Write-Host "V22.1 修复已写入：" -ForegroundColor Green
Write-Host "  1. 今日错题改为读取 errorDays[今天]"
Write-Host "  2. 单词第一次选错立即计入 wrong + 今日错题，并给明显反馈"
Write-Host "  3. 精确句子成分分析不再提前显示 note 答案"
Write-Host "  4. 精确分析加入电脑拖拽；手机支持先点词再点结构区"
Write-Host "  5. 提交后才展开逐块答案与原因"
Write-Host ""
Write-Host "备份文件后缀：.bak-$stamp"
Write-Host ""

if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "正在检查 app.js JavaScript 语法..."
    & node --check $appPath
    if ($LASTEXITCODE -ne 0) { throw "node --check 未通过，请恢复备份并把报错发给我。" }
    Write-Host "JavaScript 语法检查通过。" -ForegroundColor Green
} else {
    Write-Host "未检测到 node，已跳过自动 JavaScript 语法检查。"
}

Write-Host ""
Write-Host "接下来请在本地测试后提交 app.js、v22.css（以及有变化时的 index.html）。"
