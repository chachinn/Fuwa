from pathlib import Path
import re

INDEX=Path('index.html')
STYLE=Path('style.css')
APP=Path('app.js')
SW=Path('service-worker.js')

# ---------- index.html ----------
html=INDEX.read_text(encoding='utf-8')
html=html.replace('FUWA_BUILD: v91-hq-recorded-sleep-audio-qa','FUWA_BUILD: v92-writing-focus-sanctuary-qa',1)
html=re.sub(r'What’s new in Fuwa [^<]+', 'What’s new in Fuwa 1.1.7', html, count=1)
html=re.sub(
    r'<p class="fuwa-release-lead">.*?</p>',
    '<p class="fuwa-release-lead">Daily Life is easier to write in, Sleep Corner gets out of the way, and Sanctuary’s Surprise me now brings the memory to you.</p>',
    html,
    count=1,
    flags=re.S,
)
release_marker='<div class="fuwa-release-list">'
release_insert='''<div class="fuwa-release-list">
        <article><span>✎</span><div><strong>More room for your dailies</strong><p>Daily Life now uses a compact writing-first header and one-row section navigation on phones, so the current page appears much sooner.</p></div></article>
        <article><span>☁️</span><div><strong>Sanctuary surprise fixed</strong><p>Surprise me now reveals the remembered moment right beneath Fuwa instead of opening it far below the room.</p></div></article>
        <article><span>🌙</span><div><strong>Smaller Sleep Corner intro</strong><p>The decorative banner is tucked away on phones so Now Playing and your sound choices stay close to the top.</p></div></article>'''
if 'More room for your dailies' not in html and release_marker in html:
    html=html.replace(release_marker,release_insert,1)

# Put the Sanctuary memory reveal directly after the companion card instead of below the room.
lines=html.splitlines()
companion_i=next((i for i,line in enumerate(lines) if 'class="sanctuary-companion-card"' in line),None)
memory_i=next((i for i,line in enumerate(lines) if 'class="sanctuary-memory-card hidden"' in line),None)
if companion_i is None or memory_i is None:
    raise SystemExit('Sanctuary companion/memory card not found')
memory_line=lines.pop(memory_i)
if memory_i < companion_i:
    companion_i-=1
lines.insert(companion_i+1,memory_line)
html='\n'.join(lines)+'\n'
INDEX.write_text(html,encoding='utf-8')

# ---------- app.js ----------
js=APP.read_text(encoding='utf-8')
js=js.replace('const FUWA_RELEASE_KEY = "fuwa-v1.1.6-2026-08-14";','const FUWA_RELEASE_KEY = "fuwa-v1.1.7-2026-08-14";',1)
old='''if($("sanctuarySurpriseMemoryButton"))$("sanctuarySurpriseMemoryButton").onclick=()=>{const types=sanctuaryV3MemoryTypesAvailable();if(!types.length)return toast("Your room is still waiting for its first memory ☁️");showSanctuaryMemory(types[Math.floor(Math.random()*types.length)]);};'''
new='''if($("sanctuarySurpriseMemoryButton"))$("sanctuarySurpriseMemoryButton").onclick=()=>{const types=sanctuaryV3MemoryTypesAvailable();if(!types.length)return toast("Your room is still waiting for its first memory ☁️");const button=$("sanctuarySurpriseMemoryButton");button?.setAttribute("aria-busy","true");showSanctuaryMemory(types[Math.floor(Math.random()*types.length)]);requestAnimationFrame(()=>{const card=$("sanctuaryMemoryCard");if(card&&!card.classList.contains("hidden")){const reduceMotion=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;card.scrollIntoView({behavior:reduceMotion?"auto":"smooth",block:"nearest"});}button?.removeAttribute("aria-busy");});};'''
if old not in js:
    raise SystemExit('Sanctuary Surprise me handler changed unexpectedly')
js=js.replace(old,new,1)
APP.write_text(js,encoding='utf-8')

# ---------- style.css ----------
css=STYLE.read_text(encoding='utf-8')
patch=r'''

/* FUWA V92 — WRITING-FIRST DAILY LIFE + COMPACT SLEEP + SANCTUARY FEEDBACK */
#sanctuaryView #sanctuaryMemoryCard{
  margin:0 0 12px;
  scroll-margin-top:calc(94px + env(safe-area-inset-top,0px));
}
#sanctuarySurpriseMemoryButton[aria-busy="true"]{opacity:.68;pointer-events:none}
.sanctuary-companion-card>button{min-height:40px}

#lifeView>.page-title-row{margin:0 2px 4px;align-items:center}
#lifeView>.page-title-row h2{font-size:clamp(24px,6vw,29px);line-height:1.08}
#lifeView>.feature-intro{margin:3px 2px 10px;font-size:11px;line-height:1.4}
#lifeView .life-tab-bar{margin:8px 0 10px;padding:3px;border-radius:15px}
#lifeView .life-tab-bar button{min-height:38px;padding:0 8px;font-size:10px}
#lifeView .notebook-shell{border-radius:22px}
#lifeView .notebook-topbar{padding-top:10px;padding-bottom:6px}
#lifeView .notebook-progress{padding-bottom:7px}
#lifeView .journal-section-jump{padding-top:5px;padding-bottom:5px}
#lifeView .journal-section-tabs{
  display:flex!important;
  grid-template-columns:none!important;
  gap:6px;
  overflow-x:auto;
  overscroll-behavior-x:contain;
  scrollbar-width:none;
  scroll-snap-type:x proximity;
  padding:1px 0 3px;
}
#lifeView .journal-section-tabs::-webkit-scrollbar{display:none}
#lifeView .journal-section-tabs button{
  flex:0 0 auto;
  width:auto!important;
  min-width:max-content;
  min-height:36px;
  padding:0 12px;
  border-radius:999px;
  font-size:9px;
  scroll-snap-align:start;
}
#lifeView .journal-page-jump-list{margin-top:4px;padding-bottom:4px}
#lifeView .journal-page-jump-list button{min-height:34px;padding:0 10px}
#lifeView .notebook-form{padding-top:4px}
#lifeView .journal-page-stack{min-height:0}
#lifeView .journal-page h3{margin:5px 0 5px;font-size:clamp(24px,6.6vw,28px)}
#lifeView .journal-prompt{margin-bottom:10px}
#lifeView .journal-mood-grid{margin-top:10px;gap:8px}
#lifeView .journal-mood-grid button{min-height:66px}

#sleepView>.thread-back{margin:0 0 4px;padding:5px 2px}
#sleepView .sleep-page-hero{padding-bottom:12px}
#sleepView .sleep-player-card{margin-top:4px}

@media(max-width:600px){
  #lifeView>.page-title-row{margin-bottom:6px}
  #lifeView>.page-title-row .eyebrow,
  #lifeView>.page-title-row .life-pages-header-icon,
  #lifeView>.feature-intro{display:none!important}
  #lifeView>.page-title-row h2{margin:0;font-size:22px}
  #lifeView .life-tab-bar{margin:5px 0 8px}
  #lifeView .notebook-topbar{padding-top:8px}
  #lifeView .journal-page h3{font-size:clamp(23px,6.2vw,27px)}

  #sleepView .sleep-page-art{display:none!important}
  #sleepView .sleep-page-hero{text-align:left;padding:0 3px 10px}
  #sleepView .sleep-page-hero>.eyebrow{font-size:9px}
  #sleepView .sleep-page-hero h2{margin:2px 0 3px;font-size:24px;line-height:1.08}
  #sleepView .sleep-page-hero>.muted{max-width:none;margin:0;font-size:10px;line-height:1.35}
  #sleepView .sleep-player-card{margin-top:0}
}

@media(min-width:768px){
  #lifeView>.feature-intro{max-width:760px}
  #lifeView .journal-section-tabs{gap:8px}
  #lifeView .journal-section-tabs button{min-height:40px;padding:0 15px;font-size:10px}
}
'''
if 'FUWA V92 — WRITING-FIRST DAILY LIFE' not in css:
    css+=patch
STYLE.write_text(css,encoding='utf-8')

# ---------- service-worker.js ----------
sw=SW.read_text(encoding='utf-8')
sw=sw.replace('const CACHE_NAME = "fuwa-shell-v91";','const CACHE_NAME = "fuwa-shell-v92";',1)
sw=sw.replace('const RELEASE_KEY = "fuwa-v1.1.6-2026-08-14";','const RELEASE_KEY = "fuwa-v1.1.7-2026-08-14";',1)
SW.write_text(sw,encoding='utf-8')
