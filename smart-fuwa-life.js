(() => {
"use strict";

const PREF_KEY="fuwaLifeIntelligenceV1";
const MAX_DOCS=2400;
const OPEN_PATTERNS=[
  /\b(?:i need to|i should|i have to|remember to|don't forget to|dont forget to|i want to|i'd like to|id like to|i plan to|i hope to|i'll|ill)\s+([^.!?\n]{3,150})/gi,
  /\b(?:decide|figure out|follow up|check|ask|message|call|book|buy|try|visit|watch|read)\s+([^.!?\n]{2,130})/gi
];
const CHAPTER_MARKERS={
  travel:["trip","travel","japan","tokyo","hotel","flight","vacation","journey"],
  work:["new job","work","office","project","promotion","team","client","shift"],
  relationship:["dating","wedding","married","partner","husband","wife","relationship","anniversary"],
  health:["health","doctor","recovery","medicine","exercise","healing","symptom"],
  learning:["class","course","study","learning","jlpt","school","exam"],
  home:["move","moving","house","home","room","apartment","declutter"],
  creativity:["app","build","project","write","drawing","photo","creative"]
};
let renderQueued=false;

const api=()=>window.fuwaSmartApi||null;
const snap=()=>api()?.snapshot?.()||{data:{}};
const esc=(v="")=>String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const norm=(v="")=>String(v).toLowerCase().replace(/[^a-z0-9\s'-]/g," ").replace(/\s+/g," ").trim();
const excerpt=(v="",n=150)=>{const s=String(v||"").replace(/\s+/g," ").trim();return s.length>n?s.slice(0,n-1)+"…":s};
const dateLabel=v=>{try{return new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric",year:"numeric"}).format(new Date(v))}catch{return""}};
const loadPrefs=()=>{try{return JSON.parse(localStorage.getItem(PREF_KEY)||"{}")}catch{return{}}};
const savePrefs=p=>{try{localStorage.setItem(PREF_KEY,JSON.stringify(p))}catch{}};
const textOf=x=>[x.title,x.body,x.text,x.note,x.notes,x.afterthought,x.highlight,x.gratitude,x.learning,x.tomorrow,x.lookingForward,x.memory,x.place].filter(v=>typeof v==="string").join(" ").trim();
function docs(){
  const d=snap().data||{},out=[];
  const add=(kind,items,label)=>(items||[]).forEach((x,i)=>{const text=textOf(x);if(!text)return;const rawDate=x.date||x.createdAt||x.updatedAt||Date.now(),ts=new Date(rawDate).getTime()||0;out.push({id:x.id||`${kind}-${i}`,kind,label,text,ts,date:x.date||new Date(ts).toISOString().slice(0,10),raw:x})});
  add("entry",d.entries,"Journal");add("joy",d.tinyJoys,"Tiny Joy");add("nightly",d.nightlyReflections,"Wind-Down");add("daily",d.dailyCheckins,"Daily Life");add("moment",d.moments,"Moment");add("thought",d.thoughtBubbles,"Thought");add("random",d.randomThoughts,"Random Thought");
  return out.sort((a,b)=>b.ts-a.ts).slice(0,MAX_DOCS);
}
function tokenize(t){return new Set(norm(t).split(/\s+/).filter(w=>w.length>3))}
function similarity(a,b){const A=tokenize(a),B=tokenize(b);if(!A.size||!B.size)return 0;let n=0;A.forEach(x=>B.has(x)&&n++);return n/Math.sqrt(A.size*B.size)}
function smartFollowUps(){
  const list=docs(),today=Date.now(),recent=list.filter(d=>today-d.ts<10*86400000),out=[];
  for(const source of recent){
    const lower=norm(source.text);
    let m=lower.match(/\b(?:tomorrow|next week|later|soon)\b[^.!?]{0,100}/);
    if(m)out.push({source,prompt:`You wrote “${excerpt(m[0],90)}.” How did that turn out?`});
    m=lower.match(/\b(?:waiting for|hoping for|need to decide|have to decide|interview|appointment|result|results)\b[^.!?]{0,110}/);
    if(m)out.push({source,prompt:`You left this open a few days ago: “${excerpt(m[0],95)}.” What happened next?`});
    if(out.length>=4)break;
  }
  return out;
}
function looseEnds(){
  const prefs=loadPrefs(),dismissed=new Set(prefs.dismissed||[]),list=docs().filter(d=>Date.now()-d.ts<120*86400000),seen=new Set(),out=[];
  for(const d of list){for(const re of OPEN_PATTERNS){re.lastIndex=0;let m;while((m=re.exec(d.text))){const text=excerpt(m[0],150),key=`${d.id}:${norm(text)}`;if(dismissed.has(key)||seen.has(norm(text)))continue;seen.add(norm(text));out.push({key,text,doc:d});if(out.length>=12)return out}}}
  return out;
}
function dismissLoose(key){const p=loadPrefs(),set=new Set(p.dismissed||[]);set.add(key);savePrefs({...p,dismissed:[...set].slice(-120)});renderLifeIntel()}
function chapterSuggestions(){
  const list=docs(),buckets={};
  list.forEach(d=>{for(const[k,terms]of Object.entries(CHAPTER_MARKERS)){if(terms.some(t=>norm(d.text).includes(t))){(buckets[k]??=[]).push(d)}}});
  const existing=(snap().data?.lifeChapters||[]).map(x=>norm(x.title||x.name||""));
  return Object.entries(buckets).filter(([k,v])=>v.length>=3&&!existing.some(x=>x.includes(k))).map(([kind,items])=>({kind,items:items.slice(0,10),start:items[items.length-1],end:items[0]})).slice(0,5);
}
function timeline(){
  const list=docs(),chosen=[];
  for(const d of list){const t=norm(d.text),significant=d.kind==="moment"||/\b(first|started|begin|graduat|wedding|married|birthday|trip|moved|promotion|achievement|finally|decided|goodbye|hello)\b/.test(t);if(!significant)continue;if(chosen.some(x=>Math.abs(x.ts-d.ts)<86400000&&similarity(x.text,d.text)>.5))continue;chosen.push(d);if(chosen.length>=12)break}
  return chosen;
}
function graph(){
  const list=docs(),nodes=new Map(),edges=new Map();
  const touch=(type,name,d)=>{const key=`${type}:${norm(name)}`;if(!norm(name)||norm(name).length<2)return;const n=nodes.get(key)||{key,type,name,docs:[]};if(!n.docs.some(x=>x.id===d.id))n.docs.push(d);nodes.set(key,n);return key};
  list.forEach(d=>{const keys=[];if(d.raw?.place)keys.push(touch("place",d.raw.place,d));for(const m of d.text.matchAll(/\b(?:with|met|called|talked to|saw)\s+([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,1})/g))keys.push(touch("person",m[1],d));for(const[k,terms]of Object.entries(CHAPTER_MARKERS))if(terms.some(t=>norm(d.text).includes(t)))keys.push(touch("theme",k,d));const clean=keys.filter(Boolean);for(let i=0;i<clean.length;i++)for(let j=i+1;j<clean.length;j++){const pair=[clean[i],clean[j]].sort().join("|");edges.set(pair,(edges.get(pair)||0)+1)}});
  return{nodes:[...nodes.values()].filter(n=>n.docs.length>=2).sort((a,b)=>b.docs.length-a.docs.length).slice(0,18),edges:[...edges.entries()].filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]).slice(0,24)};
}
function attention(){
  const follow=smartFollowUps()[0];if(follow)return{kind:"follow",eyebrow:"FUWA REMEMBERED",title:"There’s a follow-up waiting",copy:follow.prompt,doc:follow.source};
  const loose=looseEnds()[0];if(loose)return{kind:"loose",eyebrow:"A LOOSE END",title:"Something you meant to come back to",copy:loose.text,doc:loose.doc};
  const chapter=chapterSuggestions()[0];if(chapter)return{kind:"chapter",eyebrow:"A CHAPTER TAKING SHAPE",title:`${chapter.kind[0].toUpperCase()+chapter.kind.slice(1)} keeps appearing`,copy:`Fuwa found ${chapter.items.length} memories that may belong to the same part of your life.`,doc:chapter.end};
  return null;
}
function cardForDoc(d){return `<button type="button" class="life-intel-memory" data-life-open="${d.kind==="entry"?esc(d.id):""}" ${d.kind!=="entry"?"disabled":""}><small>${esc(d.label)} · ${esc(dateLabel(d.date||d.ts))}</small><strong>${esc(d.raw?.title||excerpt(d.text,70))}</strong><p>${esc(excerpt(d.text,130))}</p></button>`}
function sectionHtml(){
  const follow=smartFollowUps(),loose=looseEnds(),chapters=chapterSuggestions(),tl=timeline(),g=graph(),att=attention();
  return `<section id="fuwaLifeIntelligence" class="life-intel-stack">
    <section class="smart-card life-intel-attention"><small>ONE THING FOR NOW</small><h3>Fuwa Attention</h3>${att?`<div class="life-intel-focus"><span>${esc(att.eyebrow)}</span><strong>${esc(att.title)}</strong><p>${esc(att.copy)}</p>${att.doc?cardForDoc(att.doc):""}</div>`:`<div class="smart-empty">Nothing needs your attention right now. Fuwa will keep this quiet unless something feels genuinely useful.</div>`}</section>
    <section class="smart-card"><small>PICK UP THE THREAD</small><h3>Smart Follow-ups</h3>${follow.length?follow.map(x=>`<article class="life-intel-follow"><p>${esc(x.prompt)}</p>${cardForDoc(x.source)}</article>`).join(""):`<div class="smart-empty">No clear follow-up is waiting right now.</div>`}</section>
    <section class="smart-card"><small>WHAT AM I FORGETTING?</small><h3>Loose Ends</h3>${loose.length?loose.slice(0,8).map(x=>`<article class="life-intel-loose"><div><strong>${esc(x.text)}</strong><small>${esc(dateLabel(x.doc.date||x.doc.ts))}</small></div><button type="button" data-loose-dismiss="${esc(x.key)}">Done / ignore</button></article>`).join(""):`<div class="smart-empty">No obvious unfinished thoughts found in your recent writing.</div>`}</section>
    <section class="smart-card"><small>LIFE CHAPTERS</small><h3>Chapters Fuwa noticed</h3>${chapters.length?chapters.map(c=>`<article class="life-intel-chapter"><div><strong>${esc(c.kind[0].toUpperCase()+c.kind.slice(1))}</strong><p>${c.items.length} connected memories · ${esc(dateLabel(c.start.date||c.start.ts))} → ${esc(dateLabel(c.end.date||c.end.ts))}</p></div><button type="button" data-life-chapter="${esc(c.kind)}">Preview</button></article>`).join(""):`<div class="smart-empty">No strong new chapter boundary yet. Fuwa waits for repeated evidence instead of forcing one.</div>`}<div id="lifeChapterPreview"></div></section>
    <section class="smart-card"><small>YOUR STORY OVER TIME</small><h3>Personal Timeline</h3><div class="life-intel-timeline">${tl.length?tl.map(cardForDoc).join(""):`<div class="smart-empty">Significant moments will collect here as your journal grows.</div>`}</div></section>
    <section class="smart-card"><small>PEOPLE · PLACES · THEMES</small><h3>Personal Knowledge Graph</h3>${g.nodes.length?`<div class="life-graph-nodes">${g.nodes.map(n=>`<button type="button" data-graph-node="${esc(n.key)}"><span>${n.type}</span><strong>${esc(n.name)}</strong><small>${n.docs.length} memories</small></button>`).join("")}</div><p class="smart-note">Connections appear only when the same people, places, or themes recur together.</p><div id="lifeGraphResults"></div>`:`<div class="smart-empty">Fuwa needs a few recurring people, places, or themes before the graph becomes useful.</div>`}</section>
  </section>`;
}
function renderLifeIntel(){const root=document.getElementById("smartView");if(!root)return;const old=document.getElementById("fuwaLifeIntelligence");if(old)old.remove();const shell=root.querySelector(".smart-shell");if(!shell)return;const footer=shell.querySelector(".smart-footer");(footer||shell).insertAdjacentHTML(footer?"beforebegin":"beforeend",sectionHtml())}
function scheduleRender(){if(renderQueued)return;renderQueued=true;requestAnimationFrame(()=>{renderQueued=false;renderLifeIntel()})}
function bind(){document.addEventListener("click",e=>{const d=e.target.closest("[data-loose-dismiss]");if(d)return dismissLoose(d.dataset.looseDismiss);const open=e.target.closest("[data-life-open]");if(open?.dataset.lifeOpen)return api()?.openEntry?.(open.dataset.lifeOpen);const c=e.target.closest("[data-life-chapter]");if(c){const ch=chapterSuggestions().find(x=>x.kind===c.dataset.lifeChapter),box=document.getElementById("lifeChapterPreview");if(box&&ch)box.innerHTML=`<div class="life-intel-preview"><strong>${esc(ch.kind[0].toUpperCase()+ch.kind.slice(1))}</strong><p>Possible chapter preview — nothing is created automatically.</p>${ch.items.map(cardForDoc).join("")}</div>`}const node=e.target.closest("[data-graph-node]");if(node){const g=graph(),n=g.nodes.find(x=>x.key===node.dataset.graphNode),box=document.getElementById("lifeGraphResults");if(box&&n)box.innerHTML=`<div class="life-intel-preview"><strong>${esc(n.name)}</strong><p>${n.docs.length} connected memories</p>${n.docs.slice(0,10).map(cardForDoc).join("")}</div>`}});window.addEventListener("fuwa-local-data-changed",scheduleRender);document.addEventListener("visibilitychange",()=>document.visibilityState==="visible"&&scheduleRender())}
const observer=new MutationObserver(()=>{if(document.querySelector("#smartView .smart-shell")&&!document.getElementById("fuwaLifeIntelligence"))scheduleRender()});
function init(){bind();observer.observe(document.documentElement,{childList:true,subtree:true});scheduleRender()}
window.fuwaLifeIntelligenceDebug={smartFollowUps,looseEnds,chapterSuggestions,timeline,graph,attention,render:renderLifeIntel};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();

// V108 bootstrap: remember auth state synchronously so the dedicated cloud
// safety module cannot miss a fast Firebase auth restore on cached iPhone PWAs.
window.addEventListener("fuwa-auth-ready", event => {
  window.__fuwaCloudSafetyLastAuthDetail = event?.detail || null;
});
import("./features/cloud-backup-safety.js").catch(error => {
  console.error("Fuwa cloud backup safety module could not load.", error);
});

// V111 recovery: inspect actual backup arrays when cloud record-count metadata
// is stale/corrupt, and expose conservative local legacy recovery when cloud is empty.
import("./features/cloud-restore-recovery.js").catch(error => {
  console.error("Fuwa cloud restore recovery module could not load.", error);
});
