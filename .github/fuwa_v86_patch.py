from pathlib import Path
import re

app_path = Path('app.js')
html_path = Path('index.html')
css_path = Path('style.css')
sw_path = Path('service-worker.js')

app = app_path.read_text(encoding='utf-8')
html = html_path.read_text(encoding='utf-8')
css = css_path.read_text(encoding='utf-8')
sw = sw_path.read_text(encoding='utf-8')

assert '<!-- FUWA_BUILD: v85-sanctuary-expansion-qa -->' in html
assert 'const FUWA_RELEASE_KEY = "fuwa-v1.1.0-2026-08-13";' in app
assert 'const CACHE_NAME = "fuwa-shell-v85";' in sw
assert 'const RELEASE_KEY = "fuwa-v1.1.0-2026-08-13";' in sw

html = html.replace('<!-- FUWA_BUILD: v85-sanctuary-expansion-qa -->', '<!-- FUWA_BUILD: v86-writing-ui-stability-qa -->', 1)

# -----------------------------------------------------------------------------
# Daily Life list editor: replace tiny native iOS prompts with a roomy sheet.
# -----------------------------------------------------------------------------
modal = r'''
  <div class="life-list-editor-modal hidden" id="lifeListEditorModal" role="dialog" aria-modal="true" aria-labelledby="lifeListEditorTitle">
    <div class="life-list-editor-sheet">
      <div class="life-list-editor-head">
        <div><p class="eyebrow">Make it yours</p><h2 id="lifeListEditorTitle">Edit your list</h2></div>
        <button type="button" id="lifeListEditorClose" aria-label="Close list editor">×</button>
      </div>
      <p class="life-list-editor-help" id="lifeListEditorHelp">Write one item per line, or separate items with commas.</p>
      <textarea id="lifeListEditorInput" rows="7" maxlength="720" autocomplete="off" autocapitalize="sentences" placeholder="Morning stretch&#10;Drink vitamins&#10;Read"></textarea>
      <div class="life-list-editor-meta"><span id="lifeListEditorCount">0 items</span><small>Changes are saved only when you tap Save.</small></div>
      <div class="life-list-editor-preview" id="lifeListEditorPreview" aria-live="polite"></div>
      <div class="life-list-editor-actions">
        <button class="secondary-btn" type="button" id="lifeListEditorCancel">Cancel</button>
        <button class="primary-btn compact" type="button" id="lifeListEditorSave">Save</button>
      </div>
    </div>
  </div>
'''
release_anchor = '  <div class="fuwa-release-modal hidden" id="fuwaReleaseNotesModal"'
assert release_anchor in html
html = html.replace(release_anchor, modal + '\n' + release_anchor, 1)

# Release notes for v86.
html = html.replace('What’s new in Fuwa 1.1</h2>', 'What’s new in Fuwa 1.1.1</h2>', 1)
html = html.replace('<p class="fuwa-release-date">August 13, 2026</p>', '<p class="fuwa-release-date">August 14, 2026</p>', 1)
old_release = '''      <p class="fuwa-release-lead">Sanctuary grew from a cute room into a little place that actually reflects the Fuwa you have been building.</p>
      <div class="fuwa-release-list">
        <article><span>🏡</span><div><strong>A living Sanctuary</strong><p>Your room now changes with time of day, seasonal atmosphere, your mood, and the things you have saved across Fuwa.</p></div></article>
        <article><span>📚</span><div><strong>Memories on the shelf</strong><p>Journal pages, tiny joys, dreams, comfort keepsakes, quiet nights and more can rest inside the room and drift back to you.</p></div></article>
        <article><span>🎀</span><div><strong>Much more room personality</strong><p>Choose presets, light, seasons, room colors, decor pieces, and even give your little cloud companion a name.</p></div></article>
        <article><span>☁️</span><div><strong>Still gentle, still light</strong><p>No coins or streak pressure. Sanctuary now renders only when you open it, and its motion stays CSS-lightweight and respects reduced-motion settings.</p></div></article>
      </div>'''
new_release = '''      <p class="fuwa-release-lead">Daily Life is easier to edit on iPhone, with a focused stability pass underneath.</p>
      <div class="fuwa-release-list">
        <article><span>✍️</span><div><strong>Roomier list editing</strong><p>Personal habits, Adulting, and movement choices now open in a proper Fuwa editor instead of a cramped iPhone prompt.</p></div></article>
        <article><span>↵</span><div><strong>Write naturally</strong><p>Put one item on each line or use commas. A live preview shows exactly what Fuwa will save before you commit it.</p></div></article>
        <article><span>🌱</span><div><strong>Blank really means blank</strong><p>New installs no longer auto-fill sample habit lists. Existing lists are left exactly as they are.</p></div></article>
        <article><span>⚡</span><div><strong>Smoother Sanctuary memories</strong><p>Sanctuary now finds recent memories without repeatedly sorting entire histories, helping large journals open more smoothly.</p></div></article>
      </div>'''
assert old_release in html
html = html.replace(old_release, new_release, 1)

# -----------------------------------------------------------------------------
# Replace movement native prompt with the shared editor.
# -----------------------------------------------------------------------------
movement_pattern = re.compile(r'function editMovementLabels\(\)\{.*?\n\}', re.S)
movement_match = movement_pattern.search(app)
assert movement_match, 'editMovementLabels not found'
app = app[:movement_match.start()] + 'function editMovementLabels(){ openLifeListEditor("movement"); }' + app[movement_match.end():]

# Remove sample habit seeding for new installs. Existing definitions are preserved.
ensure_pattern = re.compile(r'function ensureLifeHabits\(\)\{[^\n]*\}')
ensure_match = ensure_pattern.search(app)
assert ensure_match, 'ensureLifeHabits not found'
ensure_replacement = '''function ensureLifeHabits(){
  const legacy=state.habitDefinitions.filter(h=>!h.kind);
  if(!legacy.length)return;
  const now=Date.now();
  const changed=[];
  state.habitDefinitions=state.habitDefinitions.map(h=>{
    if(h.kind)return h;
    const normalized={...h,kind:"adulting",updatedAt:now};
    changed.push(normalized);
    return normalized;
  });
  Promise.all(changed.map(record=>diaryRepository.save("habitDefinitions",record))).catch(error=>console.warn("Could not normalize older Fuwa habits.",error));
}'''
app = app[:ensure_match.start()] + ensure_replacement + app[ensure_match.end():]

# Replace habit rendering/editor block with a readable, keyboard-friendly editor.
habit_pattern = re.compile(r'function renderLifeHabits\(\).*?function renderJournalSectionNavigation', re.S)
habit_match = habit_pattern.search(app)
assert habit_match, 'habit editor block not found'
habit_replacement = r'''function renderLifeHabits(){
  const renderGroup=(host,items,draftKey,dataAttr,emptyCopy)=>{
    if(!host)return;
    if(!items.length){host.innerHTML=`<p class="life-habit-empty">${escapeHtml(emptyCopy)}</p>`;return;}
    host.innerHTML=items.map(item=>`<button type="button" class="${lifeDraft[draftKey]?.[item.id]?"done":""}" ${dataAttr}="${escapeHtml(item.id)}"><span>${lifeDraft[draftKey]?.[item.id]?"✓":"○"}</span><strong>${escapeHtml(item.name)}</strong></button>`).join("");
    host.querySelectorAll(`[${dataAttr}]`).forEach(button=>button.addEventListener("click",()=>{
      const id=button.getAttribute(dataAttr);
      lifeDraft[draftKey]=lifeDraft[draftKey]||{};
      lifeDraft[draftKey][id]=!lifeDraft[draftKey][id];
      renderLifeHabits();
    }));
  };
  const adultItems=state.habitDefinitions.filter(item=>(item.kind||"adulting")==="adulting"&&item.active!==false);
  const personalItems=state.habitDefinitions.filter(item=>item.kind==="habit"&&item.active!==false);
  renderGroup($("lifeHabitGrid"),adultItems,"habits","data-adult-habit","Nothing here yet. Add the everyday things you actually want to track.");
  renderGroup($("lifeCustomHabitGrid"),personalItems,"customHabits","data-custom-habit","No personal habits yet. Add only the ones that matter to you.");
}

let lifeListEditorMode="";
let lifeListEditorPreviousOverflow="";

function parseLifeListEditor(value,limit=12){
  const names=[];
  const seen=new Set();
  String(value||"").split(/[\n,]+/).forEach(raw=>{
    const name=raw.replace(/\s+/g," ").trim().slice(0,48);
    const key=name.toLowerCase();
    if(!name||seen.has(key)||names.length>=limit)return;
    seen.add(key);
    names.push(name);
  });
  return names;
}

function lifeListEditorConfig(mode){
  if(mode==="movement"){
    const order=["none","walk","cardio","strength","yoga"];
    return {mode,title:"Movement choices",help:"Keep exactly five choices. Put one on each line, or separate them with commas.",max:5,exact:5,items:order.map(key=>lifeMovementLabels[key]),order};
  }
  const label=mode==="adulting"?"Adulting list":"Personal habits";
  const items=state.habitDefinitions.filter(item=>(item.kind||"adulting")===mode&&item.active!==false).map(item=>item.name);
  return {mode,title:label,help:"Write one item per line, or separate items with commas. You can also leave this list empty.",max:12,items};
}

function renderLifeListEditorPreview(){
  const config=lifeListEditorConfig(lifeListEditorMode);
  const input=$("lifeListEditorInput"),preview=$("lifeListEditorPreview"),count=$("lifeListEditorCount"),save=$("lifeListEditorSave");
  if(!input||!preview||!count||!save)return;
  const names=parseLifeListEditor(input.value,config.max);
  preview.innerHTML=names.length?names.map(name=>`<span>${escapeHtml(name)}</span>`).join(""):'<em>No items yet — that is okay.</em>';
  count.textContent=config.exact?`${names.length}/${config.exact} choices`:`${names.length}/${config.max} items`;
  save.disabled=!!config.exact&&names.length!==config.exact;
}

function closeLifeListEditor(){
  const modal=$("lifeListEditorModal");
  if(modal)modal.classList.add("hidden");
  document.body.classList.remove("life-list-editor-open");
  document.body.style.overflow=lifeListEditorPreviousOverflow;
  lifeListEditorMode="";
}

function openLifeListEditor(mode){
  const config=lifeListEditorConfig(mode);
  const modal=$("lifeListEditorModal"),input=$("lifeListEditorInput");
  if(!modal||!input)return;
  lifeListEditorMode=mode;
  lifeListEditorPreviousOverflow=document.body.style.overflow;
  $("lifeListEditorTitle").textContent=config.title;
  $("lifeListEditorHelp").textContent=config.help;
  input.value=config.items.join("\n");
  input.oninput=renderLifeListEditorPreview;
  $("lifeListEditorClose").onclick=closeLifeListEditor;
  $("lifeListEditorCancel").onclick=closeLifeListEditor;
  $("lifeListEditorSave").onclick=saveLifeListEditor;
  modal.onclick=event=>{if(event.target===modal)closeLifeListEditor();};
  modal.classList.remove("hidden");
  document.body.classList.add("life-list-editor-open");
  document.body.style.overflow="hidden";
  renderLifeListEditorPreview();
  window.setTimeout(()=>{try{input.focus({preventScroll:true});input.setSelectionRange(input.value.length,input.value.length);}catch(_){input.focus();}},120);
}

async function saveLifeListEditor(){
  const config=lifeListEditorConfig(lifeListEditorMode);
  const input=$("lifeListEditorInput");
  if(!input)return;
  const names=parseLifeListEditor(input.value,config.max);
  if(config.exact&&names.length!==config.exact)return toast(`Please keep exactly ${config.exact} movement choices.`);
  const saveButton=$("lifeListEditorSave");
  if(saveButton)saveButton.disabled=true;
  try{
    if(config.mode==="movement"){
      lifeMovementLabels=Object.fromEntries(config.order.map((key,index)=>[key,names[index].slice(0,24)]));
      try{localStorage.setItem(LIFE_MOVEMENT_LABELS_KEY,JSON.stringify(lifeMovementLabels));}catch(error){console.warn("Could not save movement labels.",error);}
      applyMovementLabels();
      lifeSetChoice("movement",lifeDraft.movement||"");
      closeLifeListEditor();
      toast("Movement choices updated ♡");
      return;
    }
    const kind=config.mode;
    const existing=state.habitDefinitions.filter(item=>(item.kind||"adulting")===kind);
    const byName=new Map(existing.map(item=>[String(item.name||"").toLowerCase(),item]));
    const now=Date.now();
    const next=names.map((name,index)=>{
      const found=byName.get(name.toLowerCase());
      return found?{...found,name,kind,active:true,updatedAt:now}:{id:uid(kind),name,kind,active:true,createdAt:now+index,updatedAt:now};
    });
    const keep=new Set(next.map(item=>item.id));
    const removed=existing.filter(item=>!keep.has(item.id)).map(item=>({...item,active:false,updatedAt:now}));
    state.habitDefinitions=state.habitDefinitions.filter(item=>(item.kind||"adulting")!==kind).concat(next,removed);
    await Promise.all([...next,...removed].map(record=>diaryRepository.save("habitDefinitions",record)));
    renderLifeHabits();
    closeLifeListEditor();
    toast(names.length?`${config.title} updated ♡`:`${config.title} cleared ♡`);
  }catch(error){
    console.error("Could not save Daily Life list.",error);
    toast("Fuwa couldn't save that list. Please try again.");
    renderLifeListEditorPreview();
  }finally{
    if(saveButton&&!lifeListEditorMode)saveButton.disabled=false;
    else renderLifeListEditorPreview();
  }
}

function editHabitKind(kind){openLifeListEditor(kind);}
function manageLifeHabits(){return editHabitKind("adulting");}
function manageCustomLifeHabits(){return editHabitKind("habit");}

function renderJournalSectionNavigation'''
app = app[:habit_match.start()] + habit_replacement + app[habit_match.end():]

# -----------------------------------------------------------------------------
# Sanctuary: avoid sorting whole collections just to find the newest record.
# -----------------------------------------------------------------------------
latest_pattern = re.compile(r'function sanctuaryV3Latest\(items\)\{.*?\}\n\nfunction sanctuaryV3ShelfMemories', re.S)
latest_match = latest_pattern.search(app)
assert latest_match, 'sanctuaryV3Latest not found'
latest_replacement = r'''function sanctuaryV3Latest(items){
  if(!Array.isArray(items)||!items.length)return null;
  const score=item=>{
    const numeric=Number(item?.updatedAt||item?.createdAt||0);
    if(Number.isFinite(numeric)&&numeric>0)return numeric;
    if(item?.date){const parsed=new Date(`${item.date}T12:00:00`).getTime();if(Number.isFinite(parsed))return parsed;}
    return 0;
  };
  let latest=null,latestScore=-1;
  for(const item of items){const itemScore=score(item);if(latest===null||itemScore>=latestScore){latest=item;latestScore=itemScore;}}
  return latest;
}

function sanctuaryV3ShelfMemories'''
app = app[:latest_match.start()] + latest_replacement + app[latest_match.end():]

# Release handoff.
app = app.replace('const FUWA_RELEASE_KEY = "fuwa-v1.1.0-2026-08-13";', 'const FUWA_RELEASE_KEY = "fuwa-v1.1.1-2026-08-14";', 1)
sw = sw.replace('const CACHE_NAME = "fuwa-shell-v85";', 'const CACHE_NAME = "fuwa-shell-v86";', 1)
sw = sw.replace('const RELEASE_KEY = "fuwa-v1.1.0-2026-08-13";', 'const RELEASE_KEY = "fuwa-v1.1.1-2026-08-14";', 1)

# Keyboard-safe mobile sheet and clearer blank habit states.
css += r'''

/* FUWA V86 — Daily Life list editor: roomy, keyboard-safe, and native-feeling. */
.life-list-editor-modal{position:fixed;z-index:260;inset:0;display:flex;align-items:flex-end;justify-content:center;padding:12px max(12px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));background:rgba(53,42,48,.40);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px)}
.life-list-editor-sheet{width:min(100%,520px);max-height:min(86dvh,720px);overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:20px;border:1px solid rgba(236,205,216,.9);border-radius:28px;background:linear-gradient(180deg,#fffafd,#fff8fa);box-shadow:0 24px 70px rgba(74,49,60,.22)}
.life-list-editor-head{display:grid;grid-template-columns:1fr auto;align-items:start;gap:12px}.life-list-editor-head h2{margin:4px 0 0;font-family:Georgia,"Times New Roman",serif;font-size:24px}.life-list-editor-head>button{width:38px;height:38px;border:1px solid var(--line);border-radius:50%;background:#fff;color:#806b74;font-size:22px}.life-list-editor-help{margin:13px 0 12px;color:var(--muted);font-size:13px;line-height:1.5}
#lifeListEditorInput{display:block;width:100%;min-height:176px;resize:vertical;padding:15px 16px;border:1px solid #ead7df;border-radius:19px;outline:none;background:rgba(255,255,255,.92);color:var(--ink);font-size:16px;line-height:1.55;box-shadow:inset 0 1px 0 rgba(255,255,255,.8)}#lifeListEditorInput:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(239,145,170,.13)}
.life-list-editor-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:9px 2px}.life-list-editor-meta>span{color:var(--accent-dark);font-size:11px;font-weight:800}.life-list-editor-meta>small{color:var(--muted);font-size:9px;text-align:right}.life-list-editor-preview{display:flex;flex-wrap:wrap;gap:7px;min-height:34px;padding:4px 0 12px}.life-list-editor-preview span{padding:7px 10px;border:1px solid #efdce3;border-radius:999px;background:#fff;color:#725e67;font-size:11px}.life-list-editor-preview em{color:var(--muted);font-size:11px;font-style:normal;padding:7px 2px}.life-list-editor-actions{position:sticky;bottom:-20px;display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:4px -4px -4px;padding:12px 4px 4px;background:linear-gradient(180deg,rgba(255,250,253,0),#fffafd 28%)}.life-list-editor-actions button{min-height:48px}.life-list-editor-actions .primary-btn.compact{width:100%}.life-list-editor-actions button:disabled{opacity:.45;box-shadow:none}
.life-habit-empty{grid-column:1/-1;margin:0;padding:14px 15px;border:1px dashed #ead7df;border-radius:16px;background:rgba(255,255,255,.48);color:var(--muted);font-size:11px;line-height:1.45;text-align:left}
@media(max-height:620px){.life-list-editor-sheet{max-height:94dvh;padding-top:16px}#lifeListEditorInput{min-height:122px}.life-list-editor-preview{padding-bottom:6px}}
@media(prefers-reduced-motion:reduce){.life-list-editor-modal,.life-list-editor-sheet{scroll-behavior:auto!important}}
'''

app_path.write_text(app, encoding='utf-8')
html_path.write_text(html, encoding='utf-8')
css_path.write_text(css, encoding='utf-8')
sw_path.write_text(sw, encoding='utf-8')
print('Fuwa v86 writing UI/stability patch applied')
