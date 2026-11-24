// Home screen: source -> repo -> PR or commit -> opens the map. Everything that comes from the API is untrusted text:
// it is built with DOM nodes and textContent, never with innerHTML.
const $=s=>document.querySelector(s);
const POST={method:'POST',headers:{'x-prpeer':'1','content-type':'application/json'}};
async function api(path,opts){
  const r=await fetch(path,opts),j=await r.json().catch(()=>({}));
  if(!r.ok)throw Object.assign(new Error(j.error||'HTTP '+r.status),{code:j.code});
  return j}
function h(tag,attrs,...kids){
  const e=document.createElement(tag);
  for(const[k,v] of Object.entries(attrs||{}))k.startsWith('on')?e[k]=v:k=='class'?e.className=v:e.setAttribute(k,v);
  e.append(...kids.flat().filter(x=>x!=null&&x!==false));return e}
// a div that acts as a button: reachable and activable with the keyboard
const act=fn=>({role:'button',tabindex:'0',onclick:fn,onkeydown:e=>{if(e.target==e.currentTarget&&(e.key=='Enter'||e.key==' ')){e.preventDefault();fn()}}});
const ago=d=>{if(!d)return'';const m=(Date.now()-new Date(d))/6e4;return m<60?Math.round(m)+' min':m<1440?Math.round(m/60)+' h':Math.round(m/1440)+' d'};
const short=t=>t&&t.length>90?t.slice(0,89)+'…':t;

// filter and sort preferences: remembered between visits
const pref=Object.assign({src:'local',owner:'',mine:false,vis:'',clone:'',rsort:'updated',rdir:'desc',isort:'updated',idir:'desc'},(()=>{try{return JSON.parse(localStorage['prpeer:home']||'{}')}catch{return{}}})());
const save=()=>{try{localStorage['prpeer:home']=JSON.stringify(pref)}catch{}};
const sel=(opts,val,on,title)=>h('select',{title,onchange:e=>on(e.target.value)},...opts.map(([v,l])=>h('option',{value:v,...(v==val?{selected:''}:{})},l)));
const dirBtn=(dir,flip)=>h('button',{class:'tab dir',title:$t('home.flip'),onclick:flip},dir=='desc'?'↓':'↑');
const cmp=(a,b)=>a<b?-1:a>b?1:0;

let sources=[],repos=[],cur=null,tab='prs',prState='open',commitRef='';
let items=[],hasMore=false,page=1,itemText='',itemAuthor='';
const virt=o=>o=='_mine'||o=='_review',ownerLabel=o=>o=='_mine'?$t('home.mine'):o=='_review'?$t('home.review'):'@'+o; // GitHub only: my PRs / PRs I must review
let ownerSel=null,ownerText=''; // search of PRs/commits across all of an owner's repos (no repo chosen)
const skel=n=>Array.from({length:n},()=>h('div',{class:'skrow'},h('span',{class:'sk av'}),h('div',{},h('span',{class:'sk l1'}),h('span',{class:'sk l2'}))));
const enter=el=>{el.classList.remove('enter');void el.offsetWidth;el.classList.add('enter');setTimeout(()=>el.classList.remove('enter'),900)}; // triggers the staggered entrance of the rows
const say=(node)=>{$('#msg').replaceChildren(...(node?[node]:[]))};
const note=(cls,...kids)=>h('div',{class:'note '+cls},...kids);

async function init(){
  try{sources=await api('/api/sources')}catch(e){say(note('err',e.message));return}
  if(!sources.some(s=>s.id==pref.src))pref.src=sources[0].id;
  drawSources();loadRepos(false);drawFooter()}
function drawFooter(){ // status at a glance; each chip opens Settings. A failed call just leaves its chip hidden
  const dot=ok=>h('i',{class:'dot'+(ok?'':' off')});
  api('/api/llm').then(i=>{const p=i.providers.find(x=>x.id==i.default.provider)||i.providers[0];if(p)$('#fAi').replaceChildren($t('home.fAi')+': '+(i.default.model||p.models[0]||p.label),dot(p.ready))}).catch(()=>{});
  api('/api/integrations').then(l=>{const j=l.find(x=>x.id=='jira');if(j)$('#fJira').replaceChildren('Jira',dot(j.ready))}).catch(()=>{});
  api('/api/usage').then(u=>{fPrs=u.prs.length;if(u.total.n)$('#fUse').textContent=$t('home.fUse',{c:u.total.n,d:u.total.cost.toFixed(2)})}).catch(()=>{}); // {c} not {n}: {n} would trigger the one|other plural rule
  tick();setInterval(()=>{if(!document.hidden)tick()},8000)}
let fPrs=0,fI=0;
function fStats(){ // built on every turn so repos and time stay current
  let d={};try{d=JSON.parse(localStorage.getItem('prpeer-days')||'{}')}catch{}
  const days=Object.keys(d).length,opens=Object.values(d).reduce((a,b)=>a+b,0),today=d[new Date().toISOString().slice(0,10)]||0;
  let m=0;try{m=Math.round((Number(localStorage.getItem('prpeer-time'))||0)/60)}catch{}
  return [repos.length&&$t('home.stRepos',{n:repos.length}),fPrs&&$t('home.stPrs',{n:fPrs}),days&&$t('home.stDays',{n:days,d:(opens/days).toFixed(1)}),today&&$t('home.stToday',{n:today}),m&&$t('home.stTime',{c:m<60?m+' min':Math.floor(m/60)+' h '+m%60+' min'})].filter(Boolean)}
function tick(){ // alternates a tip and a stat
  const tips=$t('home.tips').split('|'),st=fStats(),k=fI++;
  $('#fTick').textContent=k%2&&st.length?st[(k>>1)%st.length]:tips[(k>>1)%tips.length]}
function drawSources(){
  $('#src').replaceChildren(...sources.map(s=>h('button',{class:'tab'+(s.id==pref.src?' on':''),onclick:()=>{pref.src=s.id;save();cur=null;ownerSel=null;drawSources();drawDetail();loadRepos(false)}},s.label,h('i',{class:'dot'+(s.ready?'':' off'),title:$t(s.ready?'conn.st.on':'conn.st.none')}))));
  const s=sources.find(x=>x.id==pref.src);$('#srcnote').textContent=s&&!s.ready?s.hint:''}

// ---- repos: search, filter by owner / visibility / clone and sort
const owner=r=>r.id.split('/')[0],nameOf=r=>r.id.split('/').slice(1).join('/');
async function loadRepos(refresh){
  $('#repos').replaceChildren(...skel(6));
  try{repos=await api(`/api/repos?source=${pref.src}${refresh?'&refresh=1':''}`)}
  catch(e){repos=[];$('#repos').replaceChildren(note('err',e.message));$('#rfilters').replaceChildren();$('#rcount').textContent='';return}
  if(pref.owner&&!repos.some(r=>owner(r)==pref.owner))pref.owner='';
  drawRepoFilters();drawRepos();enter($('#repos'))}
function drawRepoFilters(){
  const owners=[...new Set(repos.map(owner))].sort((a,b)=>a.localeCompare(b));
  $('#rfilters').replaceChildren(...[
    ...(pref.src=='github'?[h('button',{class:'tab'+(pref.mine?' on':''),title:$t('home.mineReposTip'),onclick:()=>{pref.mine=!pref.mine;save();drawRepoFilters();drawRepos()}},$t('home.mineRepos'))]:[]),
    ...(pref.src=='github'?['_mine','_review'].map(o=>h('button',{class:'tab'+(ownerSel==o?' on':''),onclick:()=>pickOwner(o)},ownerLabel(o))):[]),
    sel([['',$t('home.f.ownerAll')],...owners.map(o=>[o,`${o} (${repos.filter(r=>owner(r)==o).length})`])],pref.owner,v=>{pref.owner=v;save();drawRepos()},$t('home.f.ownerTip')),
    pref.src=='github'?sel([['',$t('home.f.visAll')],['private',$t('home.f.private')],['public',$t('home.f.public')]],pref.vis,v=>{pref.vis=v;save();drawRepos()},$t('home.f.vis')):null,
    sel([['',$t('home.f.cloneAll')],['with',$t('home.f.withClone')],['without',$t('home.f.withoutClone')]],pref.clone,v=>{pref.clone=v;save();drawRepos()},$t('home.f.clone')),
    sel([['updated',$t('home.f.sortActivity')],['name',$t('home.f.name')],['owner','Owner']],pref.rsort,v=>{pref.rsort=v;pref.rdir=v=='updated'?'desc':'asc';save();drawRepoFilters();drawRepos()},$t('home.f.sortBy')),
    dirBtn(pref.rdir,()=>{pref.rdir=pref.rdir=='desc'?'asc':'desc';save();drawRepoFilters();drawRepos()})].filter(Boolean))}
const repoSort={updated:(a,b)=>cmp(Date.parse(a.updated)||0,Date.parse(b.updated)||0)||cmp(a.id,b.id),name:(a,b)=>cmp(nameOf(a).toLowerCase(),nameOf(b).toLowerCase()),owner:(a,b)=>cmp(owner(a).toLowerCase(),owner(b).toLowerCase())||cmp(nameOf(a).toLowerCase(),nameOf(b).toLowerCase())};
function drawRepos(){
  const f=$('#q').value.trim().toLowerCase().replace(/^@/,''); // "@owner/repo" filters like "owner/repo"
  const list=repos.filter(r=>(!f||r.id.toLowerCase().includes(f)||(r.desc||'').toLowerCase().includes(f))
    &&(!pref.owner||owner(r)==pref.owner)
    &&(!pref.mine||pref.src!='github'||r.mine)
    &&(!pref.vis||(pref.vis=='private'?r.private===true:r.private===false))
    &&(!pref.clone||(pref.clone=='with'?!!r.local:!r.local))).sort(repoSort[pref.rsort]);
  if(pref.rdir=='desc')list.reverse();
  $('#rcount').textContent=$t('home.reposCount',{a:list.length,b:repos.length});
  const rows=list.map(r=>h('div',{class:'row click'+(cur&&cur.id==r.id?' on':''),...act(()=>pickRepo(r))},
    h('span',{class:'av',style:`background:hsl(${[...owner(r)].reduce((a,c)=>a*31+c.charCodeAt(0)|0,7)%360} 40% 34%)`},owner(r)[0]),
    h('div',{class:'t'},h('div',{class:'nm'},h('span',{class:'ow'},owner(r)+'/'),nameOf(r),r.private?h('span',{class:'lock',title:$t('home.private')},'🔒'):null,ext(r.url,$t('home.openHost'))),
      h('small',{},r.local?h('span',{class:'chip ok'},$t('home.localClone')):null,[r.updated?ago(r.updated):'',r.desc?short(r.desc):''].filter(Boolean).join(' · ')))));
  if(!rows.length)rows.push(h('div',{class:'note mut'},repos.length?$t('home.noMatch'):$t(pref.src=='local'?'home.noLocal':'home.noRepos')));
  rows.unshift(...ownerHits().map(o=>h('div',{class:'row click owner'+(ownerSel==o?' on':''),...act(()=>pickOwner(o))},
    h('span',{class:'av avs'},'🔎'),h('div',{class:'t'},h('div',{class:'nm'},$t('home.ownerSearch'),h('b',{},'@'+o)),h('small',{},repos.some(r=>owner(r)==o)?$t('home.ownerRepos',{n:repos.filter(r=>owner(r)==o).length}):$t('home.ownerAll'))))));
  $('#repos').replaceChildren(...rows)}
// owners offered by the search: those containing the text, or anything typed as @owner (on GitHub it need not be in the list)
function ownerHits(){
  const raw=$('#q').value.trim().replace(/\/$/,''),t=raw.toLowerCase().replace(/^@/,''),all=[...new Set(repos.map(owner))];
  if(!/^[\w.-]+$/.test(t)||(raw[0]!='@'&&t.length<2))return[];
  const hit=all.filter(o=>o.toLowerCase().includes(t)).slice(0,3);
  return raw[0]=='@'&&!all.some(o=>o.toLowerCase()==t)?[t,...hit]:hit}
function pickOwner(o){ownerSel=o;cur=null;tab='prs';commitRef='';itemText='';itemAuthor='';ownerText='';say();drawRepoFilters();drawRepos();drawDetail();loadItems()}

// ---- PRs / branches / commits of the chosen repo: search, filter by author and sort; requested 50 at a time
function pickRepo(r){cur=r;ownerSel=null;ownerText='';commitRef='';itemText='';itemAuthor='';say();drawRepos();drawDetail();loadItems()}
function sortOpts(){
  return tab=='prs'?[['updated',$t('home.f.sortActivity')],...(items.some(i=>i.created)?[['created',$t('home.f.created')]]:[]),['title',$t('home.f.title')],['author',$t('home.f.author')]]
    :[['updated',$t('home.f.sortDate')],['author',$t('home.f.author')],['title',$t('home.f.message')]]}
function drawDetail(){
  const bar=$('#detailbar'),fb=$('#itemfilters'),ic=$('#icount');
  fb.hidden=ic.hidden=!(cur||ownerSel);
  if(!cur&&!ownerSel){bar.replaceChildren(h('span',{class:'mut'},$t('home.pickRepoLeft')));$('#items').replaceChildren(h('div',{class:'empty'},h('div',{class:'ic'},'🗺️'),h('b',{},$t('home.pickRepo')),h('span',{},$t('home.pickRepoHint')),h('span',{},$t('home.ownerHint1'),h('code',{},'@my-org'),$t('home.ownerHint2'))));return}
  const t=(k,l)=>h('button',{class:'tab'+(tab==k?' on':''),onclick:()=>{tab=k;itemAuthor='';drawDetail();loadItems()}},l);
  bar.replaceChildren(...[cur?h('b',{},cur.id):h('b',{},ownerLabel(ownerSel),virt(ownerSel)?null:h('small',{class:'mut'},$t('home.allRepos'))),t('prs',pref.src=='local'?$t('home.branches'):'PRs'),virt(ownerSel)?null:t('commits','Commits'),cur&&cur.local?t('graph',$t('home.graph')):null,
    tab=='prs'&&pref.src!='local'?sel([['open',$t('home.state.openPl')],['merged',$t('home.state.mergedPl')],['closed',$t('home.state.closedPl')],['all',$t('home.state.all')]],prState,v=>{prState=v;loadItems()},$t('home.state.tip')):null,
    ownerSel?h('input',{placeholder:$t(pref.src=='local'?'home.searchOwnerLocal':'home.searchOwner',{o:ownerLabel(ownerSel)}),value:ownerText,onkeydown:e=>{if(e.key=='Enter'){ownerText=e.target.value.trim();loadItems()}}}):null,
    cur&&tab=='commits'?h('input',{placeholder:$t('home.refPh'),value:commitRef,onkeydown:e=>{if(e.key=='Enter'){commitRef=e.target.value.trim();loadItems()}}}):null].filter(Boolean)); // replaceChildren(null) would write the word "null"
  if(tab=='graph'){fb.hidden=ic.hidden=true;return}
  drawItemFilters()}
// ---- branch map: SVG graph drawn from commits + parents. Straight runs of plain commits collapse into one row;
// a branch can be focused (its history lit, the rest dimmed), shown alone, or opened as a map.
const lane=i=>`hsl(${i*67%360} 70% 62%)`;
const GW=16,GH=32; // lane width and row height, px
let gData=[],gOpen=new Set(),gAll=false,gFocus='',gOnly=false;
const refName=r=>r.replace(/^HEAD -> /,''),isTag=r=>r.startsWith('tag: ');
async function loadGraph(){
  const box=$('#items'),repo=cur.id;box.replaceChildren(...skel(4));
  try{
    const data=await api('/api/graph?repo='+encodeURIComponent(repo));
    if(!cur||cur.id!=repo||tab!='graph')return; // changed repo or tab while loading
    gData=data;gOpen=new Set();gFocus='';gOnly=false;gSumBox.hidden=true;drawGraph();enter(box)
  }catch(e){box.replaceChildren(note('err',e.message))}}
// commits reachable from the focused ref (within what was loaded)
function reach(ref=gFocus){
  if(!ref)return null;
  const byId=new Map(gData.map(c=>[c.id,c])),tip=gData.find(c=>c.refs.some(r=>refName(r)==ref)),seen=new Set(),st=tip?[tip.id]:[];
  while(st.length){const id=st.pop();if(seen.has(id)||!byId.has(id))continue;seen.add(id);st.push(...byId.get(id).parents)}
  return seen}
// the branch a commit belongs to: its own branch label, else the most specific branch (smallest history) that contains it, local before remote
function branchOf(c){
  const own=c.refs.map(refName).filter(r=>r!='HEAD'&&!isTag(r));
  if(own.length)return own.find(r=>!r.startsWith('origin/'))||own[0];
  let best='',size=Infinity;
  for(const n of new Set(gData.flatMap(x=>x.refs.map(refName)).filter(r=>r!='HEAD'&&!isTag(r)))){
    const s=reach(n),k=s.size+(n.startsWith('origin/')?.5:0);
    if(s.has(c.id)&&k<size){best=n;size=k}}
  return best}
// visible rows: optional filter by the focused branch, then runs of >=3 plain commits (1 parent, 1 child, no refs) become one row
function graphRows(lit){
  const list=gOnly&&lit?gData.filter(c=>lit.has(c.id)):gData,byId=new Map(list.map(c=>[c.id,c])),kids=new Map();
  for(const c of list)for(const p of c.parents)kids.set(p,(kids.get(p)||0)+1);
  const plain=c=>c&&c.parents.length==1&&kids.get(c.id)==1&&!c.refs.length;
  const out=[],done=new Set();
  for(const c of list){
    if(done.has(c.id))continue;
    const run=[c];
    if(plain(c))for(let p=byId.get(c.parents[0]);plain(p)&&!done.has(p.id);p=byId.get(p.parents[0]))run.push(p);
    if(run.length<3||!plain(c)){out.push(c);continue}
    run.forEach(r=>done.add(r.id));
    if(gAll||gOpen.has(c.id))out.push(...run.map((r,i)=>i?r:{...r,runHead:run.length}));
    else out.push({id:c.id,run:run.length,parents:run[run.length-1].parents,refs:[],title:'',last:run[run.length-1]})}
  return out}
// lanes: each open lane waits for one commit id; a commit takes the lane waiting for it (or a free one)
function layout(rows){
  const lanes=[],pos=new Map(),edges=[];let max=1;
  const free=()=>{const f=lanes.indexOf(null);return f<0?lanes.length:f};
  rows.forEach((c,y)=>{
    let x=lanes.indexOf(c.id);if(x<0)x=free();
    lanes.forEach((v,i)=>{if(v===c.id)lanes[i]=null}); // branches merging back into this commit end here
    lanes[x]=null;pos.set(c.id,{x,y});
    c.parents.forEach((p,k)=>{let l=k==0?x:lanes.indexOf(p);if(l<0)l=free();lanes[l]=p;edges.push({from:c.id,to:p,l})}); // the first parent keeps this lane so the main line stays straight
    max=Math.max(max,lanes.length,x+1);
    while(lanes.length&&lanes[lanes.length-1]==null)lanes.pop()});
  return{pos,edges,max}}
const svg=(tag,a)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const k in a)e.setAttribute(k,a[k]);return e};
function drawGraph(){
  const box=$('#items'),lit=reach(),rows=graphRows(lit),{pos,edges,max}=layout(rows);
  const P=(x,y)=>[x*GW+GW/2+4,y*GH+GH/2],on=id=>!lit||lit.has(id);
  const g=svg('svg',{class:'gsvg',width:max*GW+8,height:rows.length*GH});
  for(const e of edges){
    const a=pos.get(e.from),b=pos.get(e.to)||{x:e.l,y:rows.length}; // parent beyond the loaded history: the line runs off the bottom
    let x=a.x,y=a.y,d='M'+P(x,y);
    const curve=(nx,ny)=>{const[p1,q1]=P(x,y),[p2,q2]=P(nx,ny),m=(q1+q2)/2;d+=` C${p1},${m} ${p2},${m} ${p2},${q2}`;x=nx;y=ny};
    if(b.y==a.y+1)curve(b.x,b.y);
    else{if(e.l!=x)curve(e.l,y+1);const end=b.x==e.l?b.y:b.y-1;if(end>y){d+=' L'+P(e.l,end);y=end}if(b.x!=x)curve(b.x,b.y)}
    g.append(svg('path',{d,stroke:lane(e.l),'stroke-width':2,fill:'none',opacity:on(e.from)&&on(e.to)?1:.15}))}
  rows.forEach(c=>{const{x,y}=pos.get(c.id),[cx,cy]=P(x,y);
    g.append(c.run?svg('rect',{x:cx-5,y:cy-9,width:10,height:18,rx:5,fill:'var(--bg,#111)',stroke:lane(x),'stroke-width':2,opacity:on(c.id)?1:.2})
      :svg('circle',{cx,cy,r:c.refs.length?6:4,fill:c.parents.length>1?'var(--bg,#111)':lane(x),stroke:lane(x),'stroke-width':2,opacity:on(c.id)?1:.2}))});
  const branches=[...new Set(gData.flatMap(c=>c.refs).filter(r=>r!='HEAD').map(refName))].sort();
  const focus=v=>{gFocus=branches.includes(v)?v:'';if(!gFocus)gOnly=false;drawGraph()};
  const local=pref.src=='local'&&gFocus&&!isTag(gFocus);
  const bar=h('div',{class:'bar f gbar'},
    sel([['',$t('home.g.pick')],...branches.map(b=>[b,b])],gFocus,focus,$t('home.g.pick')),
    gFocus?h('label',{class:'mut'},h('input',{type:'checkbox',...(gOnly?{checked:''}:{}),onchange:e=>{gOnly=e.target.checked;drawGraph()}}),' '+$t('home.g.only')):null,
    gFocus?h('button',{class:'tab',onclick:()=>focus('')},$t('home.g.clear')):null,
    gFocus?ext(branchUrl(gFocus),$t('home.openHost')):null,
    local?h('button',{class:'go',title:$t('home.g.openTip'),onclick:e=>open('pr',gFocus,e.target)},$t('home.g.open')):null,
    h('button',{class:'tab',style:'margin-left:auto',onclick:()=>{gAll=!gAll;gOpen=new Set();drawGraph()}},$t(gAll?'home.g.collapse':'home.g.expand')));
  const row=c=>h('div',{class:'grow'+(on(c.id)?'':' dim'),...(c.run?{}:{onclick:e=>{if(!e.target.closest('button,a,.chip')){const b=branchOf(c);focus(b==gFocus?'':b)}},onmouseenter:e=>tip(e,c),onmousemove:moveTip,onmouseleave:hideTip,oncontextmenu:e=>{e.preventDefault();summarize('commit',c.id,c.title)}})},
    c.run?h('button',{class:'tab more',onclick:()=>{gOpen.add(c.id);drawGraph()}},$t('home.g.run',{n:c.run}))
    :h('div',{class:'t'},h('div',{},...c.refs.map(r=>h('span',{class:'chip ref'+(isTag(r)?' tag':'')+(refName(r)==gFocus?' on':''),title:$t('home.g.chipTip'),...act(()=>focus(refName(r)==gFocus?'':refName(r))),oncontextmenu:e=>{e.preventDefault();e.stopPropagation();summarize('branch',refName(r).replace(/^tag: /,''),refName(r))}},refName(r))),' '+c.title),
      h('small',{},h('code',{},c.id.slice(0,7)),' '+[c.author,ago(c.date)].filter(Boolean).join(' · '))),
    c.runHead?h('button',{class:'tab',title:$t('home.g.fold'),onclick:()=>{gOpen.delete(c.id);gAll=false;drawGraph()}},'▴'):null,
    c.run?null:ext(webUrl('commit/'+c.id),$t('home.openHost')),
    c.run?null:h('button',{class:'go',onclick:e=>open('commit',c.id,e.target)},$t('home.open')));
  box.replaceChildren(bar,h('div',{class:'note mut'},$t('home.graphTip')),h('div',{class:'gwrap'},g,h('div',{class:'grows',style:`margin-left:${max*GW+12}px`},...rows.map(row))),gSumBox)}
// links to the repo's web page: the id comes from the origin remote; shortcut: assumes github.com unless the repo carries its own url
const webUrl=path=>(cur&&cur.url?cur.url.replace(/\/$/,''):'https://github.com/'+(cur&&cur.id))+'/'+path;
const branchUrl=b=>webUrl((isTag(b)?'releases/tag/':'tree/')+b.replace(/^tag: /,'').replace(/^origin\//,''));
// hover card: one floating element reused by every row
const gTip=h('div',{class:'gtip',hidden:''});document.body.append(gTip);
function tip(e,c){
  gTip.replaceChildren(...[h('b',{},c.title),h('div',{},h('code',{},c.id)),
    h('div',{class:'mut'},[c.author,new Date(c.date).toLocaleString()].filter(Boolean).join(' · ')),
    c.parents.length>1?h('div',{class:'mut'},$t('home.g.merge',{n:c.parents.length})):null,
    c.refs.length?h('div',{},...c.refs.map(r=>h('span',{class:'chip'},refName(r)))):null,
    h('div',{class:'mut'},$t('home.g.rclick'))].filter(Boolean));
  gTip.hidden=false;moveTip(e)}
function moveTip(e){const w=gTip.offsetWidth,hh=gTip.offsetHeight;gTip.style.left=Math.min(e.clientX+14,innerWidth-w-8)+'px';gTip.style.top=(e.clientY+16+hh>innerHeight?e.clientY-hh-10:e.clientY+16)+'px'}
function hideTip(){gTip.hidden=true}
// right click: short AI summary at the foot of the map; answers are remembered per repo + commit/branch
const gSumBox=h('div',{class:'gsum',hidden:''}),gSums=new Map();
async function summarize(kind,id,label){
  hideTip();const key=cur.id+'|'+kind+'|'+id,head=h('div',{class:'gsh'},h('b',{},'✨ '+short(label)),
    kind=='branch'?ext(branchUrl(label),$t('home.openHost')):ext(webUrl('commit/'+id),$t('home.openHost')),
    h('button',{class:'tab',style:'margin-left:auto',title:$t('common.close'),onclick:()=>{gSumBox.hidden=true}},'✕'));
  const body=h('div',{class:'mut'},$t('home.g.thinking'));
  gSumBox.replaceChildren(head,body);gSumBox.hidden=false;
  try{
    if(!gSums.has(key))gSums.set(key,api('/api/graph-summary',{...POST,body:JSON.stringify({repo:cur.id,kind,id})}).catch(e=>{gSums.delete(key);throw e}));
    const {text}=await gSums.get(key);if(body.isConnected){body.className='';body.textContent=text}
  }catch(e){if(body.isConnected){body.className='err';body.textContent=e.message}}}
function drawItemFilters(){
  const opts=sortOpts();if(!opts.some(o=>o[0]==pref.isort)){pref.isort='updated';pref.idir='desc'}
  $('#itemfilters').replaceChildren(...[
    ownerSel?null:h('input',{id:'fi',placeholder:$t(tab=='prs'?'home.f.searchPr':'home.f.searchCommit'),value:itemText,oninput:e=>{itemText=e.target.value;drawItems()}}),
    h('input',{id:'fa',list:'authors',placeholder:$t('home.f.authorPh'),title:$t('home.f.authorTip'),value:itemAuthor,autocomplete:'off',onchange:e=>pickAuthor(e.target.value)}),h('datalist',{id:'authors'}),
    sel(opts,pref.isort,v=>{pref.isort=v;pref.idir=v=='updated'||v=='created'?'desc':'asc';save();drawItemFilters();drawItems()},$t('home.f.sortBy')),
    dirBtn(pref.idir,()=>{pref.idir=pref.idir=='desc'?'asc':'desc';save();drawItemFilters();drawItems()})].filter(Boolean))}
function pickAuthor(v){
  v=v.trim();
  const known=[...new Set(items.map(i=>i.author).filter(Boolean))],low=v.toLowerCase();
  const part=known.filter(a=>a.toLowerCase().includes(low));
  itemAuthor=!v?'':known.find(a=>a.toLowerCase()==low)||(part.length==1?part[0]:v);
  const fa=$('#fa');if(fa)fa.value=itemAuthor;
  loadItems()}
async function loadItems(append){
  const sk=()=>(cur?cur.id:ownerSel?'@'+ownerSel+'|'+ownerText:'')+tab+prState+'|'+itemAuthor;
  if(!cur&&!ownerSel)return;
  if(tab=='graph'){if(cur&&cur.local)return loadGraph();tab='prs';drawDetail()} // the map needs a local clone
  const box=$('#items'),mine=sk();
  if(!append){page=1;items=[];box.replaceChildren(...skel(4));$('#icount').textContent=''}
  try{
    const q=`source=${pref.src}&repo=${encodeURIComponent(cur?cur.id:'')}&page=${page}${itemAuthor?'&author='+encodeURIComponent(itemAuthor):''}`;
    const data=!cur?await api(`/api/search?source=${pref.src}&owner=${encodeURIComponent(ownerSel)}&kind=${tab}&state=${prState}&q=${encodeURIComponent(ownerText)}&page=${page}${itemAuthor?'&author='+encodeURIComponent(itemAuthor):''}`)
      :tab=='prs'?await api(`/api/prs?${q}&state=${prState}`):await api(`/api/commits?${q}${commitRef?'&ref='+encodeURIComponent(commitRef):''}`);
    if(sk()!=mine)return; // the user changed repo, owner or search while loading
    for(const it of data)it.updated??=it.date; // commits carry `date`
    items=append?items.concat(data):data;
    hasMore=data.length>=50&&(cur?!(pref.src=='local'&&tab=='prs'):pref.src!='local');
    drawItemFilters();drawItems();if(!append)enter(box)
  }catch(e){box.replaceChildren(note('err',e.message))}}
const itemKey={updated:i=>Date.parse(i.updated)||0,created:i=>Date.parse(i.created)||0,title:i=>(i.title||'').toLowerCase(),author:i=>(i.author||'').toLowerCase()};
function drawItems(){
  const box=$('#items');
  // authors come from what has been loaded so far
  const authors=[...new Set(items.map(i=>i.author).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  $('#authors').replaceChildren(...authors.map(a=>h('option',{value:a},$t('home.f.authorLoaded',{n:items.filter(i=>i.author==a).length}))));
  const f=itemText.trim().toLowerCase();
  const key=itemKey[pref.isort];
  const list=items.filter(i=>(!f||[i.title,i.author,i.head,i.base,i.id,i.repo].join(' ').toLowerCase().includes(f))).sort((a,b)=>cmp(key(a),key(b)));
  if(pref.idir=='desc')list.reverse();
  $('#icount').textContent=$t('home.loaded',{a:list.length,b:items.length})+(hasMore?$t('home.hasMore'):'');
  const rows=list.map(it=>tab=='prs'?prRow(it):commitRow(it));
  if(!rows.length)rows.push(h('div',{class:'note mut'},items.length?$t('home.noMatch'):$t(tab=='prs'?'home.nothing':'home.noCommits')));
  if(hasMore)rows.push(h('button',{class:'tab more',onclick:async e=>{e.target.disabled=true;e.target.textContent=$t('common.loading');page++;await loadItems(true)}},$t('home.loadMore')));
  box.replaceChildren(...rows)}
const stateLbl=s=>['open','merged','closed'].includes(s)?$t('home.state.'+s):s;
const ext=(u,tip)=>/^https?:\/\//.test(u||'')?h('a',{class:'ext',href:u,target:'_blank',rel:'noopener noreferrer',title:tip,onclick:e=>e.stopPropagation()},'↗'):null; // link to the host's page
const prRow=p=>h('div',{class:'row'},h('span',{class:'pill '+p.state},stateLbl(p.state)),
  h('div',{class:'t'},h('div',{},(/^\d+$/.test(p.id)?'#'+p.id+' ':'')+p.title),h('small',{},p.repo?h('span',{class:'chip'},p.repo):null,[p.author,p.base&&p.head?p.base+' ← '+p.head:'',ago(p.updated)].filter(Boolean).join(' · '))),
  ext(p.url,$t('home.openHost')),h('button',{class:'go',onclick:e=>open('pr',p.id,e.target,p.repo)},$t('home.open')));
const commitRow=c=>h('div',{class:'row'},h('code',{},c.id.slice(0,7)),
  h('div',{class:'t'},h('div',{},c.title),h('small',{},c.repo?h('span',{class:'chip'},c.repo):null,[c.author,ago(c.date)].filter(Boolean).join(' · '))),
  ext(c.url,$t('home.openHost')),h('button',{class:'go',onclick:e=>open('commit',c.id,e.target,c.repo)},$t('home.open')));

async function open(kind,id,btn,repo=cur&&cur.id){
  say();btn.disabled=true;$('#busy').classList.add('on');
  try{const {sid}=await api('/api/open',{...POST,body:JSON.stringify({source:pref.src,repo,kind,id})});location.href='/pr/'+sid}
  catch(e){
    $('#busy').classList.remove('on');btn.disabled=false;
    if(e.code=='needs_clone')say(note('warn',h('div',{},$t('home.needsClone',{repo})),
      h('button',{class:'go',style:'margin-top:8px',onclick:async b=>{b.target.disabled=true;b.target.textContent=$t('home.cloning');$('#busy').classList.add('on');
        try{await api('/api/clone',{...POST,body:JSON.stringify({repo})});$('#busy').classList.remove('on');say(note('mut',$t('home.cloned')));await loadRepos(true)}
        catch(er){$('#busy').classList.remove('on');say(note('err',er.message))}}},$t('home.clone'))));
    else say(note('err',e.message))}}

let qTimer;$('#q').oninput=()=>{clearTimeout(qTimer);qTimer=setTimeout(drawRepos,120)}; // not on every key: the list can have hundreds of rows
$('#q').onkeydown=e=>{ // owner/repo typed by hand: open that repo even if it is not in the list
  const v=e.target.value.trim(),rv=v.replace(/^@/,'');
  if(e.key=='Enter'&&/^[\w.-]+\/[\w.-]+$/.test(rv)){const v=rv,r=repos.find(x=>x.id==v)||{id:v,local:undefined};if(!repos.some(x=>x.id==v))repos.unshift(r);pickRepo(r)}
  else if(e.key=='Enter'){const m=/^@?([\w.-]+)\/?$/.exec(v);if(m){const o=repos.map(owner).find(x=>x.toLowerCase()==m[1].toLowerCase())||(v[0]=='@'?m[1]:null);if(o)pickOwner(o)}}};
$('#refresh').onclick=()=>loadRepos(true);
init();

// ⚙ Ajustes lives in settings.js (shared with the PR page); home only refreshes what a change affects
prpeerSettings.onChange=k=>k=='conn'?init():loadRepos(k=='cache');
