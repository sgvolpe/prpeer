
// real data: window.PRDATA is injected by the server (prpeer --serve)
const PRD=window.PRDATA;
// a file cannot be both changed and linked, nor appear twice: the short key of a repeated path would never be unique
{const seen=new Set(PRD.files.map(f=>f.path));PRD.linked=PRD.linked.filter(l=>!seen.has(l.path)&&seen.add(l.path))}
const E=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
const EA=s=>E(s).replace(/"/g,'&quot;'); // for attribute values
const J=s=>EA(JSON.stringify(s)); // a JS literal inside an inline handler: file names are untrusted
// keys are the shortest path suffix that is unique (avoids clashes of __init__.py, test_*.py…)
const nodes=[...PRD.files.map(f=>f.path),...PRD.linked.map(l=>l.path)];
// keys and folders are used inside HTML and inline handlers: the PR's paths are untrusted data, so they are sanitized
const safe=s=>s.replace(/[^\w.\-\/@+ ]/g,'_');
const key={};
for(const p of nodes){const a=p.split('/');for(let k=1;k<=a.length;k++){const s=a.slice(-k).join('/');if(nodes.filter(x=>x===s||x.endsWith('/'+s)).length==1){key[p]=safe(s);break}}key[p]??=safe(p)}
const PATHOF={};for(const p of nodes)PATHOF[key[p]]=p;
const dirname=p=>safe(p.includes('/')?p.slice(0,p.lastIndexOf('/')):'.');
const D={},M={},L=[],DIRRAW={}; // DIRRAW: real folder of each sanitized key
const rawDir=p=>p.includes('/')?p.slice(0,p.lastIndexOf('/')):'.';
for(const f of PRD.files){
  const k=key[f.path];
  DIRRAW[dirname(f.path)]=rawDir(f.path);(D[dirname(f.path)]??=[]).push([k,'c',f.add,f.del,f.preview||'']);
  const what=$t('file.'+f.status,{from:f.oldPath})+(f.binary?$t('file.binary'):$t('file.stats',{add:f.add,del:f.del,n:f.sections.length}));
  // fns: [name, explanation, code, churn, start line, length, [[o,n] per line]]
  const fns=f.sections.map(s=>[s.name,E(s.doc?s.doc.split('\n')[0]:s.kind+' · +'+s.add+' −'+s.del),'',s.add+s.del,s.first,Math.max(1,s.last-s.first+1),null]);
  M[k]={what:E(what),doc:f.doc||'',loaded:false,fns,total:f.total||Math.max(0,...f.sections.map(s=>s.last))+15};
}
for(const l of PRD.linked){DIRRAW[dirname(l.path)]=rawDir(l.path);(D[dirname(l.path)]??=[]).push([key[l.path],'l']);M[key[l.path]]={what:E($t('file.linkedWith',{list:l.via.map(v=>key[v]).join(', ')})),doc:'',fns:[],total:0}}
for(const e of PRD.links)if(key[e.from]&&key[e.to])L.push([key[e.from],key[e.to]]);
const README=Object.fromEntries(Object.entries(PRD.readmes||{}).map(([d,t])=>[d,E(t)]));
const CL=PRD.changelog?PRD.changelog.map(([g,xs])=>[g,xs.map(E)]):null;
const PR=`<b>${E(PRD.title)}</b>`;
const POSKEY='prpeer:'+PRD.head;
ttl.textContent=PRD.title;ttl.title=PRD.title;if(/^https?:\/\//.test(PRD.url||'')){const a=document.createElement('a');a.href=PRD.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='↗';a.title=$t('home.openHost');a.style.cssText='margin-left:6px;text-decoration:none';a.onclick=e=>e.stopPropagation();ttl.after(a)}wt.textContent=$t('wt.title',{head:PRD.head.slice(0,8)});document.title='PR Peer · '+PRD.title;
const ch=f=>info(f).fns.reduce((s,x)=>s+(x[3]??x[2].split('\n').length),0);
const item=(f,[s,e,c])=>`<div class="fn"><code>${esc(s)}</code> <span class="doc">${E(f)}</span><p>${e}</p>${c?`<pre>${esc(c)}</pre>`:''}</div>`;
function fnList(fs){const it=fs.flatMap(f=>info(f).fns.map(x=>[f,x])).sort((a,b)=>(b[1][3]??0)-(a[1][3]??0)),h=it.slice(0,4).map(x=>item(...x)).join(''),t=it.slice(4);
  return h+(t.length?`<details><summary>${$t('fn.more',{n:t.length})}</summary>${t.map(x=>item(...x)).join('')}</details>`:'')}
const clHtml=full=>!CL?'':`<div class="cl"><h4>Changelog · [Unreleased]</h4>`+(full||zl>0?CL.map(([g,xs])=>`<p><b>${g}</b></p><ul>${xs.map(x=>`<li>${x}</li>`).join('')}</ul>`).join(''):`<p>${CL.map(([g,xs])=>xs.length+' '+g).join(' · ')}</p>`)+`</div>`;
// selectable context: chips for what is chosen + suggestions based on connections
function refresh(){render();bump()}
const addCtx=ks=>{for(const k of ks)if(M[k]&&!sels.some(x=>x.t=='file'&&x.k==k))sels.push({t:'file',k});refresh()};
const rm=i=>{sels.splice(i,1);refresh()};
function suggest(){
  const fl=new Set(sels.flatMap(x=>x.t=='dir'?D[x.k].map(y=>y[0]):[x.k])),out=new Map();
  const add=(g,why)=>{if(!fl.has(g)&&M[g]&&!out.has(g)&&!hidWhy(PATHOF[g]))out.set(g,why)};
  for(const f of fl){const c=conn(f);
    c.by.forEach(g=>add(g,$t(/spec/.test(g)?'sg.testOf':'sg.uses',{f})));c.uses.forEach(g=>add(g,$t('sg.usedBy',{f})));
    D[dirOf[f]].forEach(([g])=>info(g).fns.length&&add(g,$t('sg.sameDir')))}
  if(!fl.size)Object.values(D).flat().map(x=>x[0]).filter(g=>info(g).fns.length).forEach(g=>add(g,$t('sg.topChurn')));
  return [...out].sort((a,b)=>(info(b[0]).fns.length>0)-(info(a[0]).fns.length>0)||ch(b[0])-ch(a[0])).slice(0,6)}
// cards on screen in the map and their focus (0..1): they travel to the AI as extra context, the heavier ones with more code
let VIEW=[];
const viewChips=()=>{const v=[...VIEW].sort((a,b)=>b.w-a.w);return v.slice(0,8).map(x=>`<span class="chip2 vw" style="opacity:${(.4+.6*x.w).toFixed(2)}">${E(x.key.split('/').pop())}</span>`).join('')+(v.length>8?`<span class="chip2 vw">+${v.length-8}</span>`:'')};
const ctxBar=()=>{
  const chips=sels.length?sels.map((x,i)=>`<span class="chip2">${x.k}${x.t=='dir'?'/':''}<a onclick="rm(${i})">✕</a></span>`).join(''):`<span class="chip2">${$t('ctx.fullPR')}</span>`,sg=suggest();
  return `<h4>${$t('ctx.selected')}</h4><div class="chips">${chips}</div><h4>${$t('ctx.suggestions')}</h4><div class="chips">`
   +sg.map(([f,w])=>`<button class="sg" onclick="addCtx(${J([f])})">+ ${E(f)}<small>${w}</small></button>`).join('')
   +(sg.length>1?`<button class="sg" onclick="addCtx(${J(sg.map(x=>x[0]))})">${$t('ctx.addAll',{n:sg.length})}</button>`:'')
   +`</div><h4>${$t('ctx.inView')}</h4><div class="chips" id="inview">${viewChips()}</div><input class="add" list="allf" placeholder="${$t('ctx.addOther')}" onchange="addCtx([this.value]);this.value=''">`};
// one-paragraph summary focused on the diff; deepened with zoom (lvl 0/1/2)
const tot=f=>{const t=Object.values(D).flat().find(x=>x[0]==f);return t&&t[2]!=null?[t[2],t[3]]:[0,0]};
// PR mood: per-file risk heuristic (size, who uses it, tests, money flow)
const LBL=['calm','attention','risky'].map(k=>$t('mood.'+k));
// rules sent by the server (defaults < user config < .prpeer.json of the base branch); see mood.ts
const MC=PRD.mood,RISKRE=MC.riskWords.length?new RegExp(MC.riskWords.join('|'),'i'):null,PATHRULES=MC.riskPaths.map(r=>[new RegExp(r.match,'i'),r.weight]),IGNORE=MC.ignore.map(x=>new RegExp(x,'i'));
function mood(f){const i=M[f],path=PATHOF[f];if(!i||!i.fns.length||IGNORE.some(r=>r.test(path)))return{s:0,l:0,why:[]};
  const c=conn(f),n=Math.max(ch(f),tot(f)[0]+tot(f)[1]),why=[];let s=Math.min(MC.churnMax,n/MC.churnPer);
  if(n>200)why.push($t('mood.why.lines',{n}));
  if(c.by.length){s+=Math.min(MC.fanInMax,c.by.length*MC.fanInWeight);why.push($t('mood.why.fanIn',{n:c.by.length}))}
  if(!L.some(e=>e[1]==f&&/spec|test/i.test(e[0]))){s+=MC.noTestWeight;why.push($t('mood.why.noTest'))}
  const hit=RISKRE&&RISKRE.exec(i.doc+' '+i.what+' '+i.fns.map(x=>x[0]+' '+x[1]).join(' '));
  if(hit){s+=MC.riskWeight;why.push($t('mood.why.word',{w:hit[0]}))}
  for(const [re,w] of PATHRULES)if(re.test(path)){s+=w;why.push($t('mood.why.path'))}
  return{s,l:s<MC.thresholds[0]?0:s<MC.thresholds[1]?1:2,why}}
const moodHtml=chg=>{if(!chg.length)return'';
  const ms=chg.map(f=>[f,mood(f)]).sort((a,b)=>b[1].s-a[1].s),w=ms[0],cnt=[2,1,0].map(l=>[l,ms.filter(x=>x[1].l==l).length]).filter(x=>x[1]);
  return `<div class="mood"><b><i class="md m${w[1].l}"></i>${LBL[w[1].l]}</b> · ${cnt.map(([l,n])=>n+' '+LBL[l]).join(' · ')}<br><small>${w[0]}: ${w[1].why.map(E).join(', ')||$t('mood.why.none')}</small></div>`};
function summary(fl,lvl,label){
  const chg=fl.filter(f=>info(f).fns.length).sort((a,b)=>ch(b)-ch(a));
  if(!chg.length)return $t('sum.none',{label:esc(label)});
  const A=chg.reduce((s,f)=>s+tot(f)[0],0),X=chg.reduce((s,f)=>s+tot(f)[1],0),S=chg.reduce((s,f)=>s+info(f).fns.length,0);
  const set=new Set(fl),ext=[...new Set(chg.flatMap(f=>[...conn(f).uses,...conn(f).by]))].filter(g=>!set.has(g));
  const top=chg.flatMap(f=>info(f).fns.map(x=>[f,x])).sort((a,b)=>(b[1][3]??0)-(a[1][3]??0))[0];
  const kind=$t(X==0?'sum.kind.new':A>X*2?'sum.kind.added':'sum.kind.mixed');
  let s=$t('sum.main',{label:esc(label),files:$t('sum.files',{n:chg.length}),A,X,secs:$t('sum.secs',{n:S}),kind});
  if(lvl>=1)s+=$t('sum.top',{f:chg[0],n:ch(chg[0])})+(chg.length>1?$t('sum.then',{f:chg[1]}):'')+'.';
  if(lvl>=2&&top)s+=$t('sum.biggest',{fn:esc(top[1][0]),f:top[0],note:top[1][1]});
  if(ext.length)s+=$t('sum.reach',{n:ext.length,list:ext.slice(0,3).join(', ')+(ext.length>3?'…':'')});
  return s}
const rd=d=>README[d]?`<div class="rd"><h4>README · ${d}/</h4><p>${README[d]}</p></div>`:'';
const ordered=f=>M[f].fns.map((x,i)=>[x,i]).sort((a,b)=>a[0][4]-b[0][4]);
const mm=(f,click)=>{const T=M[f].total;return `<div class="mm">`+ordered(f).map(([x,i])=>`<b title="${x[0].replace(/"/g,'')} · L${x[4]}" style="left:${x[4]/T*100}%;width:${Math.max(1.5,x[5]/T*100)}%"${click?` onclick="document.getElementById('h${i}').scrollIntoView()"`:''}></b>`).join('')+`</div>`};
const treeFile={},treeDir={};const dirOf={};let sels=[],zl=1,openKey=null;
const tree=document.getElementById('tree'),map=document.getElementById('map');
// worktree tree (the map is drawn by React Flow)
// nested tree: each folder with its subfolders; those that only contain other folders are "virtual" rows that can only be collapsed
const TREE={depth:-1,kids:new Map()};
const kidOf=(p,seg,path)=>{let k=p.kids.get(seg);if(!k){k={path,label:seg,depth:p.depth+1,kids:new Map(),files:[],real:null,row:null};p.kids.set(seg,k)}return k};
const allNodes=[];
for(const dir of Object.keys(D)){
  const raw=DIRRAW[dir];let n=TREE,acc='';
  if(raw==='.')n=kidOf(TREE,'.','.');else for(const s of raw.split('/')){acc=acc?acc+'/'+s:s;n=kidOf(n,s,acc)}
  n.real=dir;n.files=D[dir].map(x=>x[0]);
}
(function walk(p){
  for(const n of [...p.kids.values()].sort((a,b)=>a.label.localeCompare(b.label))){
    const t=document.createElement('div');t.className='d';t.style.paddingLeft=12+n.depth*14+'px';t.title=n.path==='.'?$t('map.root'):n.path+'/';
    const car=document.createElement('span');car.className='car';car.title=$t('tree.toggle');car.onclick=e=>{e.stopPropagation();toggleDir(n.path)};
    t.append(car,document.createTextNode(n.label+'/'));tree.append(t);n.row=t;allNodes.push(n);
    if(n.real){const dir=n.real;t.onclick=e=>pick({t:'dir',k:dir},e.shiftKey||e.ctrlKey||e.metaKey);t.oncontextmenu=e=>hideMenu(e,{t:'dir',k:dir});treeDir[dir]=t}
    else t.onclick=()=>toggleDir(n.path);
    for(const nm of n.files){dirOf[nm]=n.real;
      const r=document.createElement('div');r.className='f '+D[n.real].find(x=>x[0]===nm)[1];r.style.paddingLeft=24+n.depth*14+'px';r.textContent=nm;r.onclick=e=>focus(nm,e);r.ondblclick=()=>openDiff(null,nm);r.oncontextmenu=e=>hideMenu(e,{t:'file',k:nm});treeFile[nm]=r;r.draggable=true;r.ondragstart=e=>e.dataTransfer.setData('text/plain',nm);tree.append(r);
    }
    walk(n);
  }
})(TREE);
// bridge to the map: a snapshot that changes (and notifies subscribers) whenever the selection, the open file or the hidden set changes
const mapStore={v:0,subs:new Set(),snap:{v:0,sels:[],open:null}};
function bump(){mapStore.snap={v:++mapStore.v,sels:sels.map(s=>({...s})),open:openKey};mapStore.subs.forEach(f=>f())}
const nm=f=>`<a onclick="focus(${J(f)})">${E(f)}</a>`;
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
const info=f=>M[f]||{what:$t('file.noRel'),doc:'',fns:[]};
const conn=f=>({uses:L.filter(e=>e[0]==f).map(e=>e[1]),by:L.filter(e=>e[1]==f).map(e=>e[0])});
const fnHtml=(f,full)=>info(f).fns.map(([s,e,c])=>`<div class="fn"><code>${esc(s)}</code> <span class="doc">${E(f)}</span><p>${e}</p>${full?`<pre>${esc(c)}</pre>`:''}</div>`).join('');
function connHtml(f){const c=conn(f);if(!c.uses.length&&!c.by.length)return'';
  return `<h4>${$t('conn.title')}</h4>`+(c.uses.length?`<p>${$t('conn.uses',{list:c.uses.map(nm).join(', ')})}</p>`:'')+(c.by.length?`<p>${$t('conn.usedBy',{list:c.by.map(nm).join(', ')})}</p>`:'')}
function render(){
  const lvn=$t('ctx.lvl.'+zl);let h='';
  const all=Object.values(D).flat().map(x=>x[0]).filter(k=>!hidWhy(PATHOF[k]));
  const fl=sels.length?[...new Set(sels.flatMap(x=>x.t=='dir'?D[x.k].map(y=>y[0]):[x.k]))]:all;
  const chg=fl.filter(f=>info(f).fns.length).sort((a,b)=>ch(b)-ch(a));
  const names=sels.map(x=>x.k+(x.t=='dir'?'/':''));
  const subj=names.length?names.join(', '):$t('ctx.thisPR');
  const subjShort=names.length>2?$t('ctx.nsel',{n:names.length}):subj;
  ctxlvl.textContent=lvn+' · '+subjShort;chip.textContent=names.length?$t('ctx.on',{x:subjShort}):'';
  if(sels.length==1&&sels[0].t=='file'){const k=sels[0].k,i=info(k);
    if(zl==0)h=`<p>${i.what}</p>`+connHtml(k);
    else if(zl==1)h=`<h4>${$t('ctx.whatChanged')}</h4><p>${i.what}</p>`+(i.doc?`<h4>Docstring</h4><p class="doc">${esc(i.doc)}</p>`:'')+connHtml(k);
    else h=(i.doc?`<h4>Docstring</h4><p class="doc">${esc(i.doc)}</p>`:'')+`<h4>${$t('ctx.fnsLines')}</h4>`+(fnList([k])||`<p>${$t('ctx.noChanges')}</p>`)+connHtml(k);
  }else{
    const lead=!sels.length?PR:`<b>${esc(subj)}</b>: `+(chg.map(f=>info(f).what).join(' ')||$t('ctx.noChangesShort'));
    if(zl==0)h=`<p>${lead}</p><p class="doc">${$t('sum.files',{n:chg.length})}${sels.length?'':' · '+nl.textContent}</p>`;
    else if(zl==1)h=`<p>${lead}</p><h4>${$t('ctx.byFile')}</h4>`+chg.map(f=>`<p>${nm(f)} — ${info(f).what}</p>`).join('');
    else h=`<h4>${$t('ctx.fnsLines')}</h4>`+fnList(chg);
    const between=sels.length>1?L.filter(e=>fl.includes(e[0])&&fl.includes(e[1])):[];
    if(between.length)h+=`<h4>${$t('ctx.between')}</h4>`+between.map(e=>`<p>${nm(e[0])} → ${nm(e[1])}</p>`).join('');
  }
  let extra='';
  if(sels.length==1&&sels[0].k=='CHANGELOG.md')extra=clHtml(1);
  else if(!sels.length)extra=clHtml()+rd('.');
  else if(sels.length==1&&sels[0].t=='dir')extra=rd(sels[0].k);
  else if(sels.length==1&&zl>0)extra=rd(dirOf[sels[0].k]);
  const label=names.length?(names.length>2?$t('ctx.nsel',{n:names.length}):names.join(', ')):$t('ctx.thisPRCap');
  lazyCode();
  ctx.innerHTML=`<div class="sum"><h4>${$t('ctx.summary')}</h4>${metaHtml()}<p>${summary(fl,zl,label)}</p>${moodHtml(chg)}${aiSumHtml()}</div>`+ctxBar()+(chg.length?`<button class="dbtn" onclick="openDiff()">${$t('diff.openAll',{n:chg.length})}</button>`:'')+h+extra+`<p class="doc" style="margin-top:8px">${$t('ctx.dropHint')}</p>`;
  if(aiAuto&&!aiSum[sumKey()]&&!aiRun.has(sumKey()))aiSummary();
}
function pick(s,add){
  const i=sels.findIndex(x=>x.t==s.t&&x.k==s.k);
  if(add){i>=0?sels.splice(i,1):sels.push(s)}else sels=[s];
  refresh();
}
top_.onclick=()=>{sels=[];refresh()};
// accordion: opens this file and closes the others; a second click closes it. With Shift/Ctrl it only adds to the selection.
function cardClick(n,e){
  if(e&&(e.shiftKey||e.ctrlKey||e.metaKey))return pick({t:'file',k:n},1);
  const was=openKey===n;
  sels=[{t:'file',k:n}];openKey=was?null:n;render();bump()}
function focus(n,e){
  if(e&&(e.shiftKey||e.ctrlKey||e.metaKey))return pick({t:'file',k:n},1);
  sels=[{t:'file',k:n}];openKey=n;render();bump();mapCtrl.focus?.(n)}
{const F=Object.values(D).flat(),C=F.filter(x=>x[1]=='c');nc.innerHTML='<b>'+C.length+'</b> '+$t('top.changed')+' <span class="a">+'+C.reduce((a,x)=>a+x[2],0)+'</span> <span class="x">−'+C.reduce((a,x)=>a+x[3],0)+'</span>';nl.innerHTML='<b>'+F.filter(x=>x[1]=='l').length+'</b> '+$t('top.linked')}
// dropping cards on the right panel = add to the selection
const rside=document.querySelector('aside.r');
rside.ondragover=e=>{e.preventDefault();rside.classList.add('drop')};
rside.ondragleave=e=>{if(!rside.contains(e.relatedTarget))rside.classList.remove('drop')};
rside.ondrop=e=>{e.preventDefault();rside.classList.remove('drop');const k=e.dataTransfer.getData('text/plain');if(M[k]&&!sels.some(x=>x.t=='file'&&x.k==k))pick({t:'file',k},1)};
// full diff in a dialog
const stat=f=>{const t=Object.values(D).flat().find(x=>x[0]==f);return t[2]!=null?`+${t[2]} −${t[3]}`:''};
const selFiles=()=>{const fl=sels.length?[...new Set(sels.flatMap(x=>x.t=='dir'?D[x.k].map(y=>y[0]):[x.k]))]:Object.values(D).flat().map(x=>x[0]).filter(k=>!hidWhy(PATHOF[k]));return fl.filter(f=>info(f).fns.length).sort((a,b)=>ch(b)-ch(a))};
function hunkLines(fi,x){return x[2].split('\n').map((l,i)=>[l[0]=='-'?'-':'+',l.slice(2),...(x[6]?.[i]||[])])}
let pe=1,dl=0;
function diffHtml(f){pe=1;dl=0;const T=M[f].total;return ordered(f).map(([x,i])=>{const st=x[4],gap=st>pe?`<div class="gap">${$t('diff.gap',{n:st-pe,a:pe,b:st-1})}</div>`:'';let ol=st,nl=st+dl;const n0=nl;
  const rows=hunkLines(i,x).map(([k,t,o,n])=>{const lo=o??'',ln=n??'';return `<div class="dl ${k=='+'?'p':k=='-'?'m':''}"><i>${lo}</i><i>${ln}</i><span>${k}${esc(t)}</span></div>`}),rest=rows.slice(30);
  const ls=hunkLines(i,x);dl+=ls.filter(l=>l[0]=='+').length-ls.filter(l=>l[0]=='-').length;pe=st+x[5];
  return gap+`<div class="hk" id="h${i}"><div class="hh">@@ L${st}–${st+x[5]-1} @@ ${esc(x[0])} <span class="doc">${esc(x[1].replace(/<[^>]+>/g,''))}</span></div>${rows.slice(0,30).join('')}${rest.length?`<details><summary>${$t('diff.moreLines',{n:rest.length})}</summary>${rest.join('')}</details>`:''}</div>`}).join('')+`<div class="gap">${$t('diff.gapEnd',{n:T-pe,t:T})}</div>`}
let dFiles=[],dAct='';
// the HTML carries only the first lines of each section; a file's full diff is requested when it is opened
async function ensureLoaded(f){
  const m=M[f];if(!m||m.loaded||!m.fns.length)return;
  m.p??=(async()=>{
    const res=await fetch('/api/file?s='+PRD.sid+'&path='+encodeURIComponent(PATHOF[f]));
    if(!res.ok)throw new Error($t('err.loadFile',{f,status:res.status}));
    (await res.json()).forEach((lines,i)=>{const x=m.fns[i];x[2]=lines.map(l=>l.k+' '+l.t).join('\n');x[6]=lines.map(l=>[l.o,l.n])});
    m.loaded=true})().catch(e=>{m.p=null;throw e});
  return m.p}
// with a single file chosen, fetches its code to show it in the context panel
function lazyCode(){const s=sels.length==1&&sels[0].t=='file'?sels[0].k:null;
  if(s&&M[s]&&!M[s].loaded&&M[s].fns.length)ensureLoaded(s).then(()=>{if(sels.length==1&&sels[0].k==s)render()}).catch(()=>{})}
async function drawDiff(){
  const f_=dAct;dmain.innerHTML=`<p class="doc">${$t('diff.loading')}</p>`;
  try{await ensureLoaded(f_)}catch(e){dmain.innerHTML='<p class="err">'+esc(e.message)+'</p>';return}
  if(f_!=dAct)return; // switched file while loading
  dside.innerHTML=dFiles.map(f=>`<div class="df ${f==dAct?'on':''}" onclick="dAct=${J(f)};drawDiff()">${E(f)}<small>${stat(f)}</small></div>`+(f==dAct?mm(f,1)+ordered(f).map(([x,i])=>`<div class="dfn" onclick="document.getElementById('h${i}').scrollIntoView()">${esc(x[0])}<small>L${x[4]} · ${x[3]??''}</small></div>`).join(''):'')).join('');
  dmain.innerHTML=`<h2>${E(dAct)} <small>${stat(dAct)}</small></h2><div class="sum"><p>${summary([dAct],2,dAct)}</p>${moodHtml([dAct])}</div><p class="doc">${esc(info(dAct).doc)}</p>`+diffHtml(dAct);dmain.scrollTop=0}
function openDiff(list,act){dFiles=list||selFiles();if(!dFiles.length){if(act){dside.innerHTML='';dmain.innerHTML=`<h2>${esc(act)}</h2><p class="doc">${$t('file.noRel')}</p>`;dlg.showModal()}return} // unchanged file: say so instead of doing nothing
if(!dFiles.includes(act)){if(act&&info(act).fns.length)dFiles=[act,...dFiles];else act=dFiles[0]}dAct=act||dFiles[0];dlg.showModal();drawDiff()}
// full diff: hover = tooltip, right click = menu with explanations
const NOTE=[];
function lineInfo(t){const hk=t.closest&&t.closest('.hk');if(!hk)return null;
  const x=info(dAct).fns[+hk.id.slice(1)],hh=t.closest('.hh'),r=t.closest('.dl');
  if(hh)return{x,head:1,title:x[0],note:x[1]};
  if(!r)return null;
  const k=r.classList.contains('p')?'+':r.classList.contains('m')?'-':' ',txt=r.querySelector('span').textContent.slice(1),ns=[...r.querySelectorAll('i')].map(i=>i.textContent);
  const n=(NOTE.find(a=>a[0].test(txt))||[])[1]||$t(k=='+'?'diff.note.add':k=='-'?'diff.note.del':'diff.note.ctx');
  return{x,k,txt,ln:ns[1]||ns[0],title:x[0],note:n}}
const cn=f=>{const c=conn(f);return [c.uses.length?$t('cn.uses',{list:c.uses.join(', ')}):'',c.by.length?$t('cn.usedBy',{list:c.by.join(', ')}):''].filter(Boolean).join(' · ')};
const tip=document.createElement('div'),menu=document.createElement('div');tip.id='dtip';menu.id='dmenu';dlg.append(tip,menu);let cur=null;
dmain.onmousemove=e=>{const i=lineInfo(e.target);if(!i){tip.style.display='none';return}
  tip.innerHTML=`<b>${esc(i.title)}</b>${i.head?'':' · L'+i.ln}<br>${i.note}`+(i.head?'':`<br><small>${i.x[1]}</small>`);
  tip.style.display='block';tip.style.left=Math.min(e.clientX+14,innerWidth-380)+'px';tip.style.top=e.clientY+16+'px'};
dmain.onmouseleave=()=>tip.style.display='none';
dmain.oncontextmenu=e=>{const i=lineInfo(e.target);if(!i)return;e.preventDefault();cur=i;tip.style.display='none';
  menu.innerHTML=`<div onclick="explain(0)">${$t(i.head?'menu.explainSec':'menu.explainLine')}</div>${i.head?'':`<div onclick="explain(1)">${$t('menu.explainWhole')}</div>`}<div onclick="explain(0);aiExplain(${i.head?1:0})">${$t('ai.explain')}</div><div onclick="askChat()">${$t('menu.askChat')}</div>`;
  menu.style.display='block';menu.style.left=Math.min(e.clientX,innerWidth-240)+'px';menu.style.top=Math.min(e.clientY,innerHeight-130)+'px'};
dlg.addEventListener('click',()=>menu.style.display='none');
function explain(full){menu.style.display='none';const i=cur,sec=full||i.head;
  dexp.hidden=false;dexp.innerHTML=`<a class="x" onclick="dexp.hidden=true">✕</a><b>${$t(sec?'exp.section':'exp.line')} · ${esc(i.title)}${sec?'':' · L'+i.ln}</b>`
   +(sec?'':`<p><code>${esc(i.txt.trim())}</code> — ${i.note}</p>`)+`<p>${i.x[1]}</p>`+(sec?`<pre>${esc(i.x[2])}</pre>`:'')
   +`<p class="doc">${esc(dAct)}${info(dAct).doc?' — '+esc(info(dAct).doc):''}</p><p class="doc">${cn(dAct)}</p><div class="ai"><button class="aib" onclick="aiExplain(${sec?1:0})">🤖 ${$t('ai.explain')}</button><div id="aiexp"></div></div>`}
function askChat(){const i=cur;dlg.close();q.value=$t(i.head?'ask.explainSec':'ask.explainLine',{what:i.head?i.title:i.txt.trim(),f:dAct});f.requestSubmit()}
document.body.insertAdjacentHTML('beforeend',`<datalist id="allf">${Object.keys(M).map(k=>`<option value="${EA(k)}">`).join('')}</datalist>`);
// ---- AI: provider / model / effort. Config and keys live on the server; here you only choose.
const LS='prpeer:llm';let LLM=null,llm={};
try{llm=JSON.parse(localStorage[LS]||'{}')}catch{}
const mdi=s=>E(s).replace(/`([^`\n]+)`/g,'<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g,'<b>$1</b>').replace(/(^|[\s(])[*_]([^*_\s][^*_\n]*?)[*_](?=[\s.,;:)!?]|$)/g,'$1<i>$2</i>').replace(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
// Markdown of the AI answers: headings, lists, quotes, code, tables, rules. Plain one-liners stay inline.
const md=t=>{t=String(t??'');if(!/^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|\||---)/m.test(t)&&!/\n\s*\n/.test(t))return mdi(t).replace(/\n/g,'<br>');
  const L=t.split('\n'),o=[];let i=0;
  while(i<L.length){const l=L[i];
    if(/^\s*```/.test(l)){const c=[];i++;while(i<L.length&&!/^\s*```/.test(L[i]))c.push(L[i++]);i++;o.push(`<pre><code>${E(c.join('\n'))}</code></pre>`);continue}
    let m=l.match(/^\s*(#{1,6})\s+(.*)/);if(m){const n=Math.min(6,m[1].length+2);o.push(`<h${n}>${mdi(m[2].replace(/\s#+$/,''))}</h${n}>`);i++;continue}
    if(/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)){o.push('<hr>');i++;continue}
    if(/^\s*>/.test(l)){const c=[];while(i<L.length&&/^\s*>/.test(L[i]))c.push(L[i++].replace(/^\s*>\s?/,''));o.push(`<blockquote>${md(c.join('\n'))}</blockquote>`);continue}
    if(/^\s*\|.*\|\s*$/.test(l)){const r=[];while(i<L.length&&/^\s*\|/.test(L[i]))r.push(L[i++]);const cells=x=>x.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
      const head=r[1]&&/^[\s|:-]+$/.test(r[1])?cells(r.splice(0,2)[0]):null;o.push(`<table>${head?`<tr>${head.map(c=>`<th>${mdi(c)}</th>`).join('')}</tr>`:''}${r.map(x=>`<tr>${cells(x).map(c=>`<td>${mdi(c)}</td>`).join('')}</tr>`).join('')}</table>`);continue}
    if(/^\s*([-*+]|\d+[.)])\s/.test(l)){const ol=/^\s*\d/.test(l),it=[];
      while(i<L.length&&(/^\s*([-*+]|\d+[.)])\s/.test(L[i])||(/^\s{2,}\S/.test(L[i])&&it.length))){const x=L[i++];if(/^\s*([-*+]|\d+[.)])\s/.test(x)&&!/^\s{2,}/.test(x))it.push(x.replace(/^\s*([-*+]|\d+[.)])\s+/,''));else it[it.length-1]+='\n'+x.trim()}
      o.push(`<${ol?'ol':'ul'}>${it.map(x=>`<li>${md(x)}</li>`).join('')}</${ol?'ol':'ul'}>`);continue}
    if(!l.trim()){i++;continue}
    const p=[L[i++]];while(i<L.length&&L[i].trim()&&!/^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|\|)/.test(L[i]))p.push(L[i++]);o.push(`<p>${mdi(p.join('\n')).replace(/\n/g,'<br>')}</p>`)}
  return`<div class="mdx">${o.join('')}</div>`};
const selPaths=()=>{const s=[...new Set(sels.flatMap(x=>x.t=='dir'?(D[x.k]||[]).map(y=>PATHOF[y[0]]):[PATHOF[x.k]]))];
  // no selection = the whole PR, minus what is hidden
  return s.length||!hiddenN()?s:Object.keys(M).filter(k=>!hidWhy(PATHOF[k])&&M[k].fns.length).map(k=>PATHOF[k])};
// provider/model/effort are chosen in ⚙ Ajustes → IA (settings.js); re-read on each use so a change there applies at once
function llmNow(){try{llm=JSON.parse(localStorage[LS]||'{}')}catch{llm={}}if(!LLM)return llm;
  const p=LLM.providers.find(x=>x.id==llm.provider)||LLM.providers[0];llm.provider=p.id;
  if(!llm.model)llm.model=(LLM.default.provider==p.id&&LLM.default.model)||p.models[0]||'';
  if(llm.effort==null)llm.effort=p.efforts.includes('low')?'low':''; // default: low effort
  return llm}
fetch('/api/llm').then(r=>r.json()).then(i=>{LLM=i;llmNow()}).catch(()=>{});
// LLM spend of this PR (every session and task, from ~/.prpeer/usage.jsonl)
const fmtTok=n=>n<1e3?String(n):n<1e6?(n/1e3).toFixed(1)+'k':(n/1e6).toFixed(2)+'M',fmtUsd=c=>'$'+(c<0.01&&c>0?c.toFixed(4):c.toFixed(2));
function drawUsage(){fetch('/api/usage?s='+PRD.sid).then(r=>r.ok?r.json():null).then(u=>{const el=document.getElementById('usage');if(!el||!u)return;
  el.textContent=fmtTok(u.in+u.out)+' tok · '+fmtUsd(u.cost)+(u.unpriced?'*':'');el.title=$t('usage.tip',{n:u.n,i:fmtTok(u.in),o:fmtTok(u.out)})+(u.unpriced?' '+$t('usage.unpriced',{n:u.unpriced}):'')}).catch(()=>{})}
drawUsage();
async function askAI(body,onText){
  llmNow();if(!LLM||!llm.model)throw new Error($t('err.pickModel'));
  const res=await fetch('/api/ask?s='+PRD.sid,{method:'POST',headers:{'content-type':'application/json','x-prpeer':'1'},body:JSON.stringify({...body,provider:llm.provider,model:llm.model,effort:llm.effort||undefined,view:[...VIEW,...[...PIN].filter(k=>!VIEW.some(v=>v.key==k)).map(k=>({key:k,w:1}))].map(v=>({path:PATHOF[v.key],w:v.w})).filter(v=>v.path)})});
  if(!res.ok||!res.body)throw new Error('HTTP '+res.status);
  const rd=res.body.getReader(),dec=new TextDecoder();let t='';
  try{for(;;){const {done,value}=await rd.read();if(done)break;t+=dec.decode(value,{stream:true});onText(t)}}finally{drawUsage()}
  return t}
const hasErr=t=>/(^|\n)\[error\]/.test(t);
// if the provider is disconnected, the error carries a button straight to Connections
// AI answers: first paragraph visible, the rest collapsed
const mda=x=>{x=String(x??'');const i=x.search(/\n\s*\n/);return i<0?md(x):md(x.slice(0,i))+`<details><summary>${$t('ai.more')}</summary>${md(x.slice(i))}</details>`};
const mdc=x=>mda(x)+(hasErr(x)&&/desconectado|disconnected/.test(x)?`<p><a class="aib" style="display:inline-block;text-decoration:none" href="/home#conexiones">${$t('conn.goto')}</a></p>`:'');
// chat
const hist=[];
f.onsubmit=async e=>{e.preventDefault();const t=q.value.trim();if(!t)return;q.value='';
  const mk=(c,h)=>{const m=document.createElement('div');m.className='m '+c;m.innerHTML=h;chat.append(m);thread.scrollTop=1e9;return m};
  mk('u',E(t));hist.push({role:'user',content:t});const m=mk('a','…');
  try{const a=await askAI({task:'chat',messages:hist,files:selPaths(),level:zl},x=>{m.innerHTML=mdc(x);thread.scrollTop=1e9});if(hasErr(a))hist.pop();else hist.push({role:'assistant',content:a})}
  catch(err){m.innerHTML='<span class="err">'+E(err.message)+'</span>';hist.pop()}};
// PR header strip: who, when, state, checks, comments, conflicts (GitHub only; /api/meta answers null otherwise)
let META=null;
let JIRA=[];fetch('/api/story?s='+PRD.sid).then(r=>r.ok?r.json():null).then(j=>{JIRA=j?.jira||[];if(JIRA.length)render()}).catch(()=>{});
function metaHtml(){const m=META||{checks:[]},url=/^https?:\/\//.test(META?.url||PRD.url||'')?(META?.url||PRD.url):'';if(!META&&!url&&!JIRA.length)return'';
  const extra=(url?`<a class="mc" href="${EA(url)}" target="_blank" rel="noopener noreferrer">↗ ${META?.id?'PR #'+E(META.id):$t('meta.pr')}</a>`:'')
   +JIRA.map(x=>`<a class="mc" ${x.url?`href="${EA(x.url)}" target="_blank" rel="noopener noreferrer"`:'href="/home#conexiones"'} title="${EA(x.summary||x.error||(x.url?'':$t('story.jiraTip')))}">🎫 ${E(x.key)}${x.status?' · '+E(x.status):''}</a>`).join('');
  if(!META)return `<div class="meta">${extra}</div>`;
  const ck=m.checks||[],ok=ck.filter(c=>c.state=='ok'||c.state=='skip').length,bad=ck.filter(c=>c.state=='fail'),wip=ck.filter(c=>c.state=='wip');
  const tip=ck.map(c=>({ok:'✓',fail:'✗',wip:'…',skip:'–'}[c.state])+' '+c.name).join('\n');
  const chip=(c,t,x)=>`<span class="mc ${c}"${x?` title="${EA(x)}"`:''}>${t}</span>`;
  return `<div class="meta">`+(m.author?chip('',E($t('meta.by',{a:m.author}))):'')+(m.created?chip('',E(new Date(m.created).toLocaleDateString()),new Date(m.created).toLocaleString()):'')
   +chip(m.state=='merged'?'ok':m.state=='closed'?'bad':'',E(m.state=='merged'?$t('meta.state.merged'):m.state=='closed'?$t('meta.state.closed'):$t('meta.state.open')))+(m.closed?chip('',E(new Date(m.closed).toLocaleDateString()),new Date(m.closed).toLocaleString()):'')+(m.draft?chip('',E($t('meta.draft'))):'')
   +(m.approvals!=null?chip(m.changesRequested?'bad':m.approvals?'ok':'',E('👍 '+m.approvals+(m.changesRequested?' · ✋ '+m.changesRequested:'')),$t('meta.approvalsTip',{n:m.approvals,c:m.changesRequested||0})):'')
   +(m.unresolved!=null?chip(m.unresolved?'wip':'ok',E($t('meta.unresolved',{n:m.unresolved}))):'')
   +(ck.length?chip(bad.length?'bad':wip.length?'wip':'ok',E($t('meta.checks',{ok,n:ck.length})),tip):'')
   +chip('',E('💬 '+m.comments),$t('meta.commentsTip',{n:m.comments}))
   +(m.conflicts===true?chip('bad',E($t('meta.conflicts'))):m.conflicts===false&&m.state=='open'?chip('ok',E('✓ '+$t('meta.clean'))):'')+extra+`</div>`}
fetch('/api/meta?s='+PRD.sid).then(r=>r.ok?r.json():null).then(j=>{META=j;if(j)render()}).catch(()=>{});
// AI summary (remembered per selection + zoom + model)
const aiSum={};
const sumKey=()=>(llmNow(),JSON.stringify([sels.map(x=>x.t+x.k),zl,llm.provider,llm.model,llm.effort]));
let aiAuto=false;try{aiAuto=localStorage['prpeer:aiauto']=='1'}catch{}
const aiRun=new Set();
function setAuto(v){aiAuto=v;try{localStorage['prpeer:aiauto']=v?'1':'0'}catch{}if(v)render()}
const aiSumHtml=()=>`<div class="ai"><button class="aib" onclick="aiSummary()">${$t('ai.explain')}</button> <label class="doc" title="${EA($t('ai.autoTip'))}"><input type="checkbox" ${aiAuto?'checked':''} onchange="setAuto(this.checked)"> ${$t('ai.auto')}</label><div id="aisum">${aiSum[sumKey()]?md(aiSum[sumKey()]):''}</div></div>`;
async function aiSummary(){
  const k=sumKey(),put=h=>{const b=document.getElementById('aisum');if(b&&sumKey()==k)b.innerHTML=h};
  put('…');aiRun.add(k);
  try{const t=await askAI({task:'summary',files:selPaths(),level:zl},x=>{aiSum[k]=x;put(mdc(x))});if(hasErr(t))delete aiSum[k]}
  catch(e){delete aiSum[k];put('<span class="err">'+E(e.message)+'</span>')}
  finally{aiRun.delete(k)}}
// explain a line or section of the diff with AI
async function aiExplain(whole){
  const i=cur,box=document.getElementById('aiexp');box.textContent='…';
  try{await askAI({task:'explain',files:[PATHOF[dAct]],level:2,target:{path:PATHOF[dAct],section:i.title,line:i.ln?+i.ln:undefined,text:i.txt,whole:!!whole}},x=>{box.innerHTML=mda(x)})}
  catch(e){box.innerHTML='<span class="err">'+E(e.message)+'</span>'}}
// story: the change told in pages by feature. Each page (and each step within it) selects and focuses on the map what it touches.
// Subpages of each page: 0 summary · 1..n each change (file, lines, code) · last: relationship between the modules.
let ST=null,STon=false;
const stKey=c=>key[c.path]&&M[key[c.path]]?key[c.path]:null;
// tolerant: ignores text or ``` around it, escapes newlines inside strings, and if the JSON was cut off it closes it and salvages the complete pages
function stJson(t){const s=t.indexOf('{');if(s<0)return null;let o='',str=false,esc_=false;const st=[];
  for(let i=s;i<t.length;i++){const c=t[i];
    if(str){if(esc_){esc_=false;o+=c}else if(c=='\\'){esc_=true;o+=c}else if(c=='"'){str=false;o+=c}else if(c=='\n'){o+='\\n'}else if(c=='\r'||c=='\t'){o+=' '}else o+=c;continue}
    if(c=='"'){str=true;o+=c}else if(c=='{'||c=='['){st.push(c=='{'?'}':']');o+=c}else if(c=='}'||c==']'){st.pop();o+=c;if(!st.length)return o}else o+=c}
  if(str)o+='"';o=o.replace(/[,:]\s*$/,'').replace(/,\s*"[^"]*"\s*$/,'');return o+st.reverse().join('')}
function stParse(t){const raw=stJson(t);if(!raw)throw new Error($t('story.invalid'));
  let j;try{j=JSON.parse(raw)}catch(e){console.warn('story:',e.message,t.slice(0,600));throw new Error($t('story.malformed',{msg:e.message.slice(0,80)}))}
  const arr=x=>Array.isArray(x)?x:[];
  const pages=arr(j.pages).map(p=>({title:String(p.title||$t('story.defTitle')),summary:String(p.summary||''),bullets:arr(p.bullets).map(String),
    changes:arr(p.changes).map(c=>({path:String(c.path||''),section:String(c.section||''),note:String(c.note||'')})).filter(stKey)}));
  if(!pages.length)throw new Error($t('story.empty'));return{headline:String(j.headline||''),pages}}
const stRels=pg=>{const fl=new Set(pg.changes.map(stKey));return L.filter(e=>fl.has(e[0])||fl.has(e[1])).sort((a,b)=>(fl.has(b[0])&&fl.has(b[1]))-(fl.has(a[0])&&fl.has(a[1]))).slice(0,12)};
const stCount=pg=>1+pg.changes.length+(stRels(pg).length?1:0);
function stSelect(){const pg=ST.pages[ST.i],n=pg.changes.length,all=[...new Set(pg.changes.map(stKey))];
  const ks=ST.j>=1&&ST.j<=n?[stKey(pg.changes[ST.j-1])]:all;if(!ks.length)return;
  sels=ks.map(k=>({t:'file',k}));openKey=null;render();bump();mapCtrl.show?mapCtrl.show(ks,ks.length==1?24:8):mapCtrl.focus?.(ks[0])}
function stGo(i,j){ST.i=Math.max(0,Math.min(i,ST.pages.length-1));ST.j=Math.max(0,Math.min(j,stCount(ST.pages[ST.i])-1));stSelect();stDraw()}
function stStep(d){const j=ST.j+d;
  if(j>=stCount(ST.pages[ST.i]))return ST.i<ST.pages.length-1?stGo(ST.i+1,0):0;
  if(j<0)return ST.i>0?stGo(ST.i-1,stCount(ST.pages[ST.i-1])-1):0;
  stGo(ST.i,j)}
function stFill(c,i,j){const k=stKey(c);
  ensureLoaded(k).then(()=>{const el=document.getElementById('stcode');if(!el||!ST||ST.i!=i||ST.j!=j)return;
    const x=M[k].fns.find(f=>f[0]==c.section);
    if(!x){el.textContent=$t('story.noSection');return}
    const ls=x[2].split('\n');
    el.innerHTML=ls.slice(0,60).map((l,n)=>{const ln=x[6]&&x[6][n]?x[6][n][1]??x[6][n][0]:'';return `<i>${ln}</i><span class="${l[0]=='+'?'p':l[0]=='-'?'m':''}">${esc(l.slice(2))}</span>`}).join('\n')+(ls.length>60?'\n'+$t('story.moreLines',{n:ls.length-60}):'')
  }).catch(e=>{const el=document.getElementById('stcode');if(el)el.textContent=e.message})}
// loader of the story: a line that changes every couple of seconds (jokes, and the names of the PR's own files)
let funI=Math.floor(Math.random()*10),funT=0;
const funLine=()=>{funI++;if(funI%3==2){const ks=Object.keys(M).filter(k=>M[k].fns.length);if(ks.length)return $t('story.funFile',{f:E(ks[Math.floor(Math.random()*ks.length)].split('/').pop())})}return [$t('story.fun.0'),$t('story.fun.1'),$t('story.fun.2'),$t('story.fun.3'),$t('story.fun.4'),$t('story.fun.5'),$t('story.fun.6'),$t('story.fun.7'),$t('story.fun.8'),$t('story.fun.9')][funI%10]};
function funStart(){clearInterval(funT);funT=setInterval(()=>{const p=document.getElementById('stfun');if(!p||!ST||!ST.busy){clearInterval(funT);return}p.classList.remove('in');p.innerHTML=funLine();void p.offsetWidth;p.classList.add('in')},2200)}
function stDraw(){const el=document.getElementById('story');stT.classList.toggle('on',STon);thread.classList.toggle('story',STon&&!!ST&&!ST.busy&&!ST.err);
  if(!STon||!ST){el.hidden=true;ctx.hidden=false;return}
  ctx.hidden=true;el.hidden=false;
  if(ST.busy){el.innerHTML=`<div class="stload"><div class="stcards"><i></i><i></i><i></i><i></i></div><p class="stfun" id="stfun">${funLine()}</p><p class="doc">${$t('story.building')}${ST.prog?$t('story.prog',{n:ST.prog}):''}</p></div>`;funStart();return}
  if(ST.err){el.innerHTML=`<div class="sth"><b class="err">${mdc(ST.err)}</b><button onclick="stClose()">✕</button></div><p><button class="aib" onclick="stOpen(true)">${$t('common.retry')}</button></p>`;return}
  const pg=ST.pages[ST.i],n=pg.changes.length,rel=stRels(pg),cnt=stCount(pg),j=ST.j;
  const jira=(ST.jira||[]).map(x=>`<a class="jc" ${x.url?`href="${EA(x.url)}" target="_blank" rel="noopener noreferrer"`:''} title="${EA(x.error||x.summary||'')}">${E(x.key)}${x.status?' · '+E(x.status):''}${x.error?' ⚠':''}</a>${x.summary?` <span class="doc">${E(x.summary)}</span>`:''}`).join(' ')+((ST.jira||[]).length&&!ST.jiraOk?' <a class="jc" href="/home#conexiones" title="'+$t('story.jiraTip')+'">'+$t('story.connectJira')+'</a>':'');
  let body,lbl;
  if(j==0){lbl=$t('story.lblSummary');body=`<div>${md(pg.summary)}</div><ul>${pg.bullets.map(b=>`<li>${md(b)}</li>`).join('')}</ul><p class="doc">${$t('story.counts',{n,f:new Set(pg.changes.map(c=>c.path)).size})}</p>`}
  else if(j<=n){const c=pg.changes[j-1],x=M[stKey(c)].fns.find(f=>f[0]==c.section);lbl=c.section||c.path;
    body=`<div class="stc"><b>${nm(stKey(c))}</b>${c.section?` · <code>${esc(c.section)}</code>`:''}${x?` <span class="doc">L${x[4]}–${x[4]+x[5]-1}</span>`:''}</div><div>${md(c.note)}</div><div class="stcode" id="stcode">…</div><div class="stf"><button class="aib" onclick="openDiff(null,${J(stKey(c))})">${$t('diff.openFile')}</button></div>`}
  else{lbl=$t('story.lblRelations');body=`<h4>${$t('story.relations')}</h4>`+rel.map(e=>`<p>${nm(e[0])} → ${nm(e[1])}</p>`).join('')}
  // compact: a fixed bar on top (navigation + pages + where I am) and the rest of the height for reading; the overall narrative stays on one line
  const sub=ST.pages.map((p,i)=>`<button class="${i==ST.i?'on':''}" title="${EA(p.title)}" onclick="stGo(${i},0)">${i+1}</button>`).join('');
  const tot=ST.pages.reduce((s,p)=>s+stCount(p),0),at=ST.pages.slice(0,ST.i).reduce((s,p)=>s+stCount(p),0)+j+1;
  el.innerHTML=`<div class="stbar"><div class="stn"><button onclick="stStep(-1)" title="${$t('story.prev')}"${ST.i==0&&j==0?' disabled':''}>◂</button><button class="${ST.play?'on':''}" onclick="stPlay()" title="${$t(ST.play?'story.pause':'story.play')}">${ST.play?'⏸':'▶'}</button><button onclick="stSpeed()" title="${$t('story.speed')}">${ST.speed}×</button><span><b>${ST.i+1}/${ST.pages.length}</b> ${E(pg.title)}</span><button onclick="stStep(1)" title="${$t('story.next')}"${ST.i==ST.pages.length-1&&j==cnt-1?' disabled':''}>▸</button><button onclick="stClose()" title="${$t('story.close')}">✕</button></div>`
   +`<div class="stg" title="${$t('story.stepOf',{at,tot})}"><i style="width:${Math.round(at/tot*100)}%"></i></div><div class="stt">${ST.play?'<i></i>':''}</div>`
   +`<div class="stp">${sub}<span class="doc">${j+1}/${cnt} · ${E(lbl)}</span></div>`
   +`<div class="sts" title="${EA(ST.headline)}">${jira?jira+' · ':''}${E(ST.headline)}</div></div><div class="stb">${body}</div>`;
  if(j>=1&&j<=n)stFill(pg.changes[j-1],ST.i,j);
  const nx=j+1<=n?pg.changes[j]:ST.pages[ST.i+1]?.changes[0];if(nx)ensureLoaded(stKey(nx)).catch(()=>{}); // the next step's code is already ready
  stSchedule()}
// autoplay: advances on its own and stays longer where there is more to read; ends at the last step
let STtm=0;
const stLast=()=>ST.i==ST.pages.length-1&&ST.j==stCount(ST.pages[ST.i])-1;
function stDelay(){const pg=ST.pages[ST.i],n=pg.changes.length,j=ST.j;
  const len=j==0?pg.summary.length+pg.bullets.join('').length:j<=n?pg.changes[j-1].note.length+120:120;
  return Math.min(15000,Math.max(3500,3000+len*40))/ST.speed}
function stSchedule(){clearTimeout(STtm);if(!STon||!ST||!ST.play)return;
  const d=stDelay();document.getElementById('story').style.setProperty('--std',d+'ms');
  STtm=setTimeout(()=>{if(!STon||!ST||!ST.play)return;if(stLast()){ST.play=false;stDraw()}else stStep(1)},d)}
function stPlay(){if(ST.play){ST.play=false;stDraw();return}if(stLast())stGo(0,0);ST.play=true;stDraw()}
function stSpeed(){ST.speed=ST.speed==1?1.5:ST.speed==1.5?2:1;stDraw()}
function stClose(){if(ST)ST.play=false;clearTimeout(STtm);STon=false;stDraw()}
async function stOpen(force){
  if(STon&&!force){stClose();return}
  if(RVon)rvClose();
  if(JRon)jrClose();
  STon=true;
  if(ST&&!ST.err&&!force){stDraw();return}
  ST={busy:true};stDraw();
  try{
    const jira=fetch('/api/story?s='+PRD.sid).then(r=>r.ok?r.json():{jira:[]}).catch(()=>({jira:[]}));
    const t=await askAI({task:'story'},x=>{if(ST&&ST.busy){const n=(x.match(/"title"/g)||[]).length;if(n!=ST.prog){ST.prog=n;stDraw()}}});
    if(hasErr(t))throw new Error(t);
    const s=stParse(t),jx=await jira;ST={...s,jira:jx.jira||[],jiraOk:jx.configured,i:0,j:0,speed:1,play:false};stGo(0,0)}
  catch(e){ST={err:e.message}; stDraw()}}
stT.onclick=()=>stOpen();
addEventListener('keydown',e=>{if(!STon||!ST||ST.busy||ST.err||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||dlg.open)return;
  if(e.key==' '&&!/BUTTON|A/.test(e.target.tagName)){stPlay();e.preventDefault()}else if(e.key=='ArrowRight'){stStep(1);e.preventDefault()}else if(e.key=='ArrowLeft'){stStep(-1);e.preventDefault()}});
// on-demand reviews (can be heavy: each runs when its button is pressed and is remembered). The security one shows the local scanner first, without AI.
const RV_TOOLS=['coherence','comments','security','tests','breaking'].map(id=>[id,$t('rv.'+id),$t('rv.'+id+'.tip')]);
let RVon=false,RVa=null;const RVr={};
const findHtml=fs=>fs.length?fs.map(x=>`<div class="fd ${x.level=='secret'?'s':'g'}"><b>${E($t('scan.level.'+x.level))}</b> · ${key[x.path]?nm(key[x.path]):E(x.path)}${x.line?':'+x.line:''} — ${E(x.rule)}<br><code>${E(x.sample)}</code></div>`).join(''):`<p class="doc">${$t('scan.none')}</p>`;
function rvDraw(){rev.hidden=!RVon;thread.classList.toggle('rv',RVon);rvT.classList.toggle('on',RVon);if(!RVon)return;
  const r=RVa&&RVr[RVa];
  rev.innerHTML=`<div class="sth"><b>${$t('rv.title')}</b><button onclick="rvClose()" title="${$t('common.close')}">✕</button></div><div class="rvb">${RV_TOOLS.map(([id,l,t])=>`<button class="${id==RVa?'on':''}${RVr[id]&&!RVr[id].busy&&!RVr[id].failed?' done':''}" title="${EA(t)}" onclick="rvRun('${id}')">${l}</button>`).join('')}</div>`
   +`<div id="rvout">${r?(r.pre||'')+(r.busy&&!r.txt?`<p class="doc">${$t('rv.analyzing')}</p>`:mdc(r.txt||''))+(r.busy?'':`<p><button class="aib" onclick="rvRun('${RVa}',true)">${$t(r.failed?'common.retry':'rv.rerun')}</button></p>`):`<p class="doc">${$t('rv.pick')}</p>`}</div>`}
function rvClose(){RVon=false;rvDraw()}
function rvOpen(){if(RVon){rvClose();return}if(STon)stClose();if(JRon)jrClose();RVon=true;rvDraw()}
async function rvRun(id,force){
  RVa=id;if(RVr[id]&&!force&&!RVr[id].failed){rvDraw();return}
  const r=RVr[id]={busy:true,txt:'',pre:''},upd=()=>{if(RVa==id)rvDraw()};
  upd();
  try{
    if(id=='coherence'){ // without the ticket content the comparison is weak: warn first and offer to connect Jira
      const j=await fetch('/api/story?s='+PRD.sid).then(x=>x.ok?x.json():null).catch(()=>null);
      const bad=j&&(j.jira||[]).filter(x=>!x.summary);
      if(bad&&bad.length)r.pre=`<div class="fd g">${bad.map(x=>E(x.key)+(x.error?' — '+E(x.error):'')).join('<br>')}<br>${$t(j.configured?'rv.ticketUnreadable':'rv.jiraOff')} <a href="/home#conexiones">${$t('conn.title')}</a></div>`;
      else if(j&&!(j.jira||[]).length)r.pre=`<div class="fd g">${$t('rv.noKey')}</div>`;
      upd()}
    if(id=='security'){const f=await fetch('/api/scan?s='+PRD.sid).then(x=>x.ok?x.json():[]);r.pre=`<h4>${$t('rv.localScan')}</h4>`+findHtml(f)+`<h4>${$t('rv.aiAnalysis')}</h4>`;upd()}
    r.txt=await askAI({task:'review',tool:id},x=>{r.txt=x;upd()});
    r.failed=hasErr(r.txt)
  }catch(e){r.txt='[error] '+e.message;r.failed=true}
  r.busy=false;upd()}
rvT.onclick=rvOpen;
// Jira ticket: link in the top bar and a section to read it without leaving the tool (all Jira text is escaped with E/EA)
let JR=null,JRon=false;
const jrStat=s=>/done|closed|resolved|hecho|cerrad|resuelt/i.test(s)?'ok':/progress|curso|review|revis|test/i.test(s)?'wip':'';
const jrLink=(x,c)=>x.url?`<a class="${c}" href="${EA(x.url)}" target="_blank" rel="noopener noreferrer" title="${$t('jira.open')}">${E(x.key)} ↗</a>`:`<span class="${c}">${E(x.key)}</span>`;
function jrBar(){const n=JR&&JR.jira?JR.jira.length:0;
  jrk.innerHTML=n?JR.jira.slice(0,2).map(x=>jrLink(x,'jc')).join('')+(n>2?`<span class="jmore" title="${EA(JR.jira.slice(2).map(x=>x.key).join(', '))}">+${n-2}</span>`:''):'';
  jrT.title=n?$t('jira.tipKeys',{keys:JR.jira.map(x=>x.key).join(', ')}):$t('jira.tip')}
const jrCard=x=>`<div class="jcard"><div class="jrh">${jrLink(x,'jk')}${x.type?`<span class="jtag">${E(x.type)}</span>`:''}${x.status?`<span class="jst ${jrStat(x.status)}">${E(x.status)}</span>`:''}</div>`
  +(x.summary?`<h4 class="jsum">${E(x.summary)}</h4>`:'')
  +(x.priority||x.assignee?`<div class="jmeta">${[x.priority&&$t('jira.priority',{v:x.priority}),x.assignee&&$t('jira.assignee',{v:x.assignee})].filter(Boolean).map(E).join(' · ')}</div>`:'')
  +(x.description?`<div class="jdesc">${E(x.description)}</div>`:x.summary?`<p class="doc">${$t('jira.noDesc')}</p>`:'')
  +(x.error?`<div class="fd g">${E(x.error)}</div>`:'')+'</div>';
function jrDraw(){jrp.hidden=!JRon;thread.classList.toggle('jrm',JRon);jrT.classList.toggle('on',JRon);if(!JRon)return;
  const head=`<div class="sth"><b>${$t('jira.title')}</b><button onclick="jrLoad(true)" title="${$t('jira.reload')}">↻</button><button onclick="jrClose()" title="${$t('common.close')}">✕</button></div>`;
  let body;
  if(!JR||JR.busy)body=`<p class="doc">${$t('jira.reading')}</p>`;
  else if(JR.err)body=`<div class="fd g">${E(JR.err)}</div>`;
  else if(!JR.jira.length)body=`<p class="doc">${$t('jira.noKey')}</p>`;
  else body=JR.jira.map(jrCard).join('')+(JR.configured?'':`<div class="fd g">${$t(JR.jira.some(x=>x.url)?'jira.off':'jira.offNoLink')} <a href="/home#conexiones">${$t('story.connectJiraPlain')}</a></div>`);
  jrp.innerHTML=head+body}
function jrClose(){JRon=false;jrDraw()}
function jrOpen(){if(JRon){jrClose();return}if(STon)stClose();if(RVon)rvClose();JRon=true;jrDraw();if(!JR)jrLoad()}
async function jrLoad(force){
  if(JR&&JR.busy)return;if(JR&&!force){jrDraw();return}
  JR={busy:true,jira:JR?JR.jira:[]};jrDraw();
  try{const r=await fetch('/api/story?s='+PRD.sid);if(!r.ok)throw new Error('HTTP '+r.status);const j=await r.json();JR={jira:j.jira||[],configured:!!j.configured}}
  catch(e){JR={err:$t('jira.readErr',{msg:e.message}),jira:[]}}
  jrBar();jrDraw()}
jrT.onclick=jrOpen;
jrLoad();
// side panels: drag the edge to resize, button to collapse, double-click the edge to widen/restore
const PL='prpeer:panels';let pw={l:260,r:320,lc:false,rc:false};
try{Object.assign(pw,JSON.parse(localStorage[PL]||'{}'))}catch{}
const other=s=>s=='l'?(pw.rc?0:pw.r):(pw.lc?0:pw.l);
const clampW=(w,s)=>Math.round(Math.max(180,Math.min(w,innerWidth*.65,innerWidth-16-240-other(s)))); // the map keeps at least 240px
function applyPanels(save){
  document.body.style.gridTemplateColumns=`${pw.lc?0:pw.l}px 10px 1fr 10px ${pw.rc?0:pw.r}px`;
  rzl.querySelector('button').textContent=pw.lc?'▶':'◀';rzr.querySelector('button').textContent=pw.rc?'◀':'▶';
  if(save)try{localStorage[PL]=JSON.stringify(pw)}catch{}}
function dragPanel(h,side){
  h.onmousedown=e=>{if(e.target.tagName=='BUTTON'||pw[side+'c'])return;e.preventDefault();
    const x0=e.clientX,w0=pw[side];document.body.style.userSelect='none';
    const mm=ev=>{pw[side]=clampW(w0+(side=='l'?ev.clientX-x0:x0-ev.clientX),side);applyPanels()};
    const mu=()=>{removeEventListener('mousemove',mm);removeEventListener('mouseup',mu);document.body.style.userSelect='';applyPanels(1)};
    addEventListener('mousemove',mm);addEventListener('mouseup',mu)};
  h.ondblclick=e=>{if(e.target.tagName=='BUTTON')return;pw[side+'c']=false;pw[side]=pw[side]>=innerWidth*.4?(side=='l'?260:320):clampW(innerWidth*.45,side);applyPanels(1)};
  h.querySelector('button').onclick=()=>{pw[side+'c']=!pw[side+'c'];applyPanels(1)}}
dragPanel(rzl,'l');dragPanel(rzr,'r');
addEventListener('resize',()=>{pw.r=clampW(pw.r,'r');pw.l=clampW(pw.l,'l');applyPanels()});
pw.r=clampW(pw.r,'r');pw.l=clampW(pw.l,'l');applyPanels();
// ---- hide files / modules / tests from the diagram (right click in the worktree or on a card)
const isTestPath=p=>/(^|\/)(tests?|__tests__|__mocks__|specs?|e2e|cypress)\//.test(p)||/_test\.(go|rb|rs|exs?)$|_spec\.rb$|(Test|Tests|IT)\.(java|kt|cs)$/.test(p)||/(^|\/)(test_[^/]*|[^/]*_test|conftest)\.py$/.test(p)||/\.(test|spec)\.[cm]?[jt]sx?$/.test(p);
const HK='prpeer:hide:'+PRD.head;
const LINKEDP=new Set(PRD.linked.map(l=>l.path)); // linked files (unchanged): start hidden
const hide={paths:[],dirs:[],tests:true,linked:true,queries:[],only:''}; // queries: hidden searches; only: show only what matches // tests: global; files and modules: per PR
try{const g=JSON.parse(localStorage['prpeer:hide:g']||'{}');hide.tests=g.tests??true;hide.linked=g.linked??true;const p=JSON.parse(localStorage[HK]||'{}');hide.paths=p.paths||[];hide.dirs=p.dirs||[];hide.queries=p.queries||[];hide.only=p.only||''}catch{}
const saveHide=()=>{try{localStorage['prpeer:hide:g']=JSON.stringify({tests:hide.tests,linked:hide.linked});localStorage[HK]=JSON.stringify({paths:hide.paths,dirs:hide.dirs,queries:hide.queries,only:hide.only})}catch{}};
const dirMatch=(d,p)=>d==='.'?!p.includes('/'):p===d||p.startsWith(d+'/');
// why a file is hidden: 'file' | 'dir' | 'tests' | 'query' | 'only' | null
const hidWhy=p=>hide.paths.includes(p)?'file':hide.dirs.some(d=>dirMatch(d,p))?'dir':hide.linked&&LINKEDP.has(p)?'linked':hide.tests&&isTestPath(p)?'tests':hide.queries.some(q=>pathQuery.matchQuery(q,p))?'query':hide.only&&!pathQuery.matchQuery(hide.only,p)?'only':null;
const hiddenN=()=>Object.keys(M).filter(k=>{const w=hidWhy(PATHOF[k]);return w&&w!=='linked'}).length; // linked ones have their own button
function applyHidden(){
  for(const k in M)treeFile[k]?.classList.toggle('hid',!!hidWhy(PATHOF[k]));
  if(openKey&&hidWhy(PATHOF[openKey]))openKey=null;
  // struck through = nothing it contains (not even in its subfolders) shows on the map
  const allHid=n=>n.files.every(k=>hidWhy(PATHOF[k]))&&[...n.kids.values()].every(allHid);
  for(const n of allNodes)n.row.classList.toggle('hid',allHid(n));
  sels=sels.filter(x=>x.t!='file'||!hidWhy(PATHOF[x.k])); // what is hidden does not stay selected
  const n=hiddenN();hidn.textContent=n?$t('hide.count',{n}):'';
  lnkT.style.display=PRD.linked.length?'':'none';
  lnkT.textContent=hide.linked?$t('hide.showLinked',{n:PRD.linked.length}):$t('hide.hideLinked');
  saveHide();drawChips();refresh()}
lnkT.onclick=()=>{hide.linked=!hide.linked;applyHidden();drawTree()};
// right-click actions: on a card, a folder or the empty map (the hide/show items go after them)
const PIN=new Set(); // cards pinned open: always full focus, and always context for the AI
const askIn=txt=>{q.value=txt;f.requestSubmit()};
function relate(k){const c=conn(k),ks=[...new Set([k,...c.uses,...c.by])].filter(x=>PATHOF[x]&&!hidWhy(PATHOF[x]));sels=ks.map(x=>({t:'file',k:x}));openKey=null;render();bump();mapCtrl.show?.(ks,6)}
function actionItems(t){
  const it=[];
  if(t?.t=='file'){const k=t.k,pin=PIN.has(k),n=conn(k).uses.length+conn(k).by.length;
    it.push([$t(pin?'act.unpin':'act.pin'),()=>{pin?PIN.delete(k):PIN.add(k);bump()}],
      [$t('act.explain'),()=>{sels=[{t:'file',k}];openKey=k;render();bump();askIn($t('ask.explainFile',{f:k}))}]);
    if(n)it.push([$t('act.relations',{n}),()=>relate(k)]);
    if(sels.length>1)it.push([$t('act.relateN',{n:sels.length}),()=>askIn($t('ask.relateN',{list:sels.map(x=>x.k).join(', ')}))]);
    it.push([$t('act.center'),()=>mapCtrl.focus?.(k)],[$t('act.copy'),()=>navigator.clipboard?.writeText(PATHOF[k])]);
    if(!hidWhy(PATHOF[k]))it.push([$t('act.onlyThis'),()=>{hide.only=PATHOF[k]}]);
  }else if(t?.t=='dir'){const ks=D[t.k].map(x=>x[0]),d=DIRRAW[t.k];
    it.push([$t('act.frame'),()=>mapCtrl.show?.(ks,0)],[$t('act.only'),()=>mapCtrl.only?.(ks,d)],
      [$t('act.explainDir',{d}),()=>{sels=[{t:'dir',k:t.k}];render();bump();askIn($t('ask.explainDir',{d}))}]);
  }else if(t?.t=='pane'){
    it.push([$t('act.fit'),()=>mapCtrl.fit?.()],[$t('act.openOne'),()=>mapCtrl.step?.(1)],[$t('act.closeOne'),()=>mapCtrl.step?.(-1)],[$t('act.closeAll'),()=>mapCtrl.levels?.(0)]);
    if(VIEW.length)it.push([$t('act.inView',{n:VIEW.length}),()=>{sels=VIEW.map(v=>({t:'file',k:v.key}));openKey=null;render();bump()}]);
  }
  return it}
function hideMenu(e,target){
  e.preventDefault();e.stopPropagation();
  const items=actionItems(target);
  if(target?.t=='file'){
    const p=PATHOF[target.k],w=hidWhy(p);
    if(!w)items.push([$t('hide.file'),()=>hide.paths.push(p)]);
    else if(w=='file')items.push([$t('hide.showFile'),()=>{hide.paths=hide.paths.filter(x=>x!==p)}]);
    else if(w=='dir'){const d=hide.dirs.find(x=>dirMatch(x,p));items.push([$t('hide.showDir',{d}),()=>{hide.dirs=hide.dirs.filter(x=>x!==d)}])}
    else if(w=='query'){const q=hide.queries.find(x=>pathQuery.matchQuery(x,p));items.push([$t('hide.showQuery',{q}),()=>{hide.queries=hide.queries.filter(x=>x!==q)}])}
    else if(w=='only')items.push([$t('hide.clearOnly',{q:hide.only}),()=>{hide.only=''}]);
  }
  if(target?.t=='dir'){
    const d=DIRRAW[target.k],has=hide.dirs.includes(d),n=D[target.k].length;
    items.push(has?[$t('hide.showDir',{d}),()=>{hide.dirs=hide.dirs.filter(x=>x!==d)}]:[$t('hide.dir',{d,n}),()=>hide.dirs.push(d)]);
  }
  const nt=Object.keys(M).filter(k=>isTestPath(PATHOF[k])).length;
  if(hide.tests)items.push([$t('hide.showTests'),()=>{hide.tests=false}]);
  else if(nt)items.push([$t('hide.hideTests',{n:nt}),()=>{hide.tests=true}]);
  if(hiddenN())items.push([$t('hide.showAll'),()=>{hide.paths=[];hide.dirs=[];hide.tests=false;hide.queries=[];hide.only=''}]);
  if(!items.length)return;
  hmenu.replaceChildren(...items.map(([label,fn])=>{const d=document.createElement('div');d.textContent=label;d.onclick=()=>{fn();hmenu.style.display='none';applyHidden()};return d}));
  hmenu.style.display='block';
  hmenu.style.left=Math.max(0,Math.min(e.clientX,innerWidth-hmenu.offsetWidth-8))+'px';
  hmenu.style.top=Math.max(0,Math.min(e.clientY,innerHeight-hmenu.offsetHeight-8))+'px'}
addEventListener('click',()=>hmenu.style.display='none');
addEventListener('contextmenu',e=>{if(!e.defaultPrevented)hmenu.style.display='none'});
hidn.onclick=e=>hideMenu(e,null);
// worktree search: filters the tree as you type; 🙈 hides from the map what matches and 👁 leaves only that (removed from the chips)
const TK='prpeer:tree:'+PRD.head;let collapsed=new Set();
try{collapsed=new Set(JSON.parse(localStorage[TK]||'[]'))}catch{}
const saveTree=()=>{try{localStorage[TK]=JSON.stringify([...collapsed])}catch{}};
function paint(n,show,q,qa){ // show: all its ancestors are open
  let c=0,any=false;const open=qa||!collapsed.has(n.path);
  for(const k of n.files){const m=!(hide.linked&&LINKEDP.has(PATHOF[k]))&&(!qa||pathQuery.matchQuery(q,PATHOF[k]));if(qa&&m)c++;any||=m;treeFile[k].style.display=show&&open&&m?'':'none'}
  for(const kid of n.kids.values()){const r=paint(kid,show&&open,q,qa);c+=r.c;any||=r.any}
  n.row.style.display=show&&any?'':'none';n.row.firstChild.textContent=open?'▾ ':'▸ ';
  return{c,any}}
function drawTree(){
  const q=tq.value.trim(),qa=!!q;let n=0;
  for(const top of TREE.kids.values())n+=paint(top,true,q,qa).c;
  tcount.textContent=qa?$t('tree.matches',{n}):'';
  tHide.disabled=tOnly.disabled=!qa||!n}
const toggleDir=d=>{collapsed.has(d)?collapsed.delete(d):collapsed.add(d);saveTree();drawTree()};
tColl.onclick=()=>{collapsed=new Set(allNodes.map(n=>n.path));saveTree();drawTree()};
tExp.onclick=()=>{collapsed.clear();saveTree();drawTree()};
const addRule=f=>{const q=tq.value.trim();if(!q)return;f(q);tq.value='';drawTree();applyHidden()};
tHide.onclick=()=>addRule(q=>{if(!hide.queries.includes(q))hide.queries.push(q)});
tOnly.onclick=()=>addRule(q=>{hide.only=q});
tq.oninput=drawTree;
const chip=(label,rm)=>{const s=document.createElement('span');s.className='tchip';s.textContent=label;const x=document.createElement('a');x.textContent=' ✕';x.title=$t('common.remove');x.onclick=rm;s.append(x);return s};
function drawChips(){tchips.replaceChildren(...[...hide.queries.map(q=>chip('🙈 '+q,()=>{hide.queries=hide.queries.filter(x=>x!==q);applyHidden()})),hide.only?chip($t('hide.onlyChip',{q:hide.only}),()=>{hide.only='';applyHidden()}):null].filter(Boolean))}
drawTree();applyHidden();
// ---- map with React Flow (web/map, compiled to /dist/map.js)
const mapData=()=>({dirs:Object.entries(D).map(([key,fs])=>({key,raw:DIRRAW[key],files:fs.map(([k,s,a,x,h])=>({key:k,status:s,add:a||0,del:x||0,preview:h||'',secs:M[k].fns.map(f=>[f[4],f[5]]),total:M[k].total||0}))})),links:L});
bump();
const mapCtrl=window.mountMap?window.mountMap(document.getElementById('rf'),{
  data:mapData(),posKey:POSKEY,
  snapshot:()=>mapStore.snap,subscribe:f=>{mapStore.subs.add(f);return()=>mapStore.subs.delete(f)},
  hidden:k=>!!hidWhy(PATHOF[k]),mood:k=>{const m=mood(k);return{l:m.l,why:m.why}},
  pinned:()=>PIN,
  onView:v=>{VIEW=v;const b=document.getElementById('inview');if(b)b.innerHTML=viewChips()},
  onLevel:z=>{if(z!==zl){zl=z;render()}},
  cardClick:(k,e)=>cardClick(k,e),dirClick:(d,e)=>pick({t:'dir',k:d},e.shiftKey||e.ctrlKey||e.metaKey),
  ctxMenu:(e,t)=>hideMenu(e,t),openDiff:k=>openDiff(null,k),
  code:async k=>{await ensureLoaded(k);return M[k].fns.flatMap(x=>x[2].split('\n')).filter(Boolean)}}):(document.getElementById('rf').textContent=$t('map.missing'),{});


// where the PR's weight is: lines changed (added + removed) per module, the heaviest ones named, the rest together; a click frames the module
(()=>{const mods=Object.entries(D).map(([d,fs])=>{const f=fs.map(([k,,a,x])=>({k,a:a||0,x:x||0,t:(a||0)+(x||0)})).filter(f=>f.t>0).sort((p,q)=>q.t-p.t);return{d:DIRRAW[d]||d,f,a:f.reduce((s,q)=>s+q.a,0),x:f.reduce((s,q)=>s+q.x,0)}}).map(m=>({...m,t:m.a+m.x})).filter(m=>m.t>0).sort((p,q)=>q.t-p.t);
  const tot=mods.reduce((s,m)=>s+m.t,0),el=document.getElementById('wchart');
  if(!tot){el.hidden=true;document.getElementById('rf').style.bottom='0';return}
  const TOP=7,shown=mods.slice(0,TOP),rest=mods.slice(TOP),pct=n=>Math.max(1,Math.round(n/tot*100)),sum=(xs,k)=>xs.reduce((s,m)=>s+m[k],0);
  if(rest.length)shown.push({d:$t('wchart.others',{n:rest.length}),f:rest.flatMap(m=>m.f).sort((p,q)=>q.t-p.t),a:sum(rest,'a'),x:sum(rest,'x'),t:sum(rest,'t'),other:true});
  const t=document.createElement('div');t.className='wt';t.textContent=$t('wchart.title',{m:mods.length,n:mods.reduce((s,m)=>s+m.f.length,0),t:tot});
  const b=document.createElement('div');b.className='wb';
  for(const m of shown){const i=document.createElement('i'),pa=Math.round(m.a/m.t*100);
    i.style.flex=String(m.t);i.style.background=`linear-gradient(90deg,var(--add) ${pa}%,var(--del) 0)`;if(m.other)i.style.opacity='.55';
    i.textContent=`${m.other?m.d:m.d.split('/').slice(-2).join('/')+'/'} ${pct(m.t)}%`;
    i.title=`${m.d} · +${m.a} −${m.x} · ${pct(m.t)}%\n`+m.f.slice(0,5).map(f=>`  ${PATHOF[f.k]||f.k}  +${f.a} −${f.x}`).join('\n')+(m.f.length>5?`\n  … +${m.f.length-5}`:'');
    i.onclick=()=>mapCtrl.show?.(m.f.slice(0,40).map(f=>f.k),0);b.append(i)}
  el.append(t,b)})();

;ctxT.onclick=()=>thread.classList.toggle('nc');
