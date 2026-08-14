from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def write(path, text):
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path, old, new):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path!r}, found {count}: {old[:90]!r}")
    write(path, text.replace(old, new, 1))


# Release/build markers.
replace_once(
    "index.html",
    "<!-- FUWA_BUILD: v86-writing-ui-stability-qa -->",
    "<!-- FUWA_BUILD: v87-ui-responsive-stability-qa -->",
)
replace_once(
    "app.js",
    'const FUWA_RELEASE_KEY = "fuwa-v1.1.1-2026-08-14";',
    'const FUWA_RELEASE_KEY = "fuwa-v1.1.2-2026-08-14";',
)
replace_once(
    "service-worker.js",
    'const CACHE_NAME = "fuwa-shell-v86";',
    'const CACHE_NAME = "fuwa-shell-v87";',
)
replace_once(
    "service-worker.js",
    'const RELEASE_KEY = "fuwa-v1.1.1-2026-08-14";',
    'const RELEASE_KEY = "fuwa-v1.1.2-2026-08-14";',
)

# What’s New for this user-visible release.
replace_once(
    "index.html",
    '<h2 id="fuwaReleaseNotesTitle">What’s new in Fuwa 1.1.1</h2>',
    '<h2 id="fuwaReleaseNotesTitle">What’s new in Fuwa 1.1.2</h2>',
)
old_release = '''      <p class="fuwa-release-lead">Daily Life is easier to edit on iPhone, with a focused stability pass underneath.</p>
      <div class="fuwa-release-list">
        <article><span>✍️</span><div><strong>Roomier list editing</strong><p>Personal habits, Adulting, and movement choices now open in a proper Fuwa editor instead of a cramped iPhone prompt.</p></div></article>
        <article><span>↵</span><div><strong>Write naturally</strong><p>Put one item on each line or use commas. A live preview shows exactly what Fuwa will save before you commit it.</p></div></article>
        <article><span>🌱</span><div><strong>Blank really means blank</strong><p>New installs no longer auto-fill sample habit lists. Existing lists are left exactly as they are.</p></div></article>
        <article><span>⚡</span><div><strong>Smoother Sanctuary memories</strong><p>Sanctuary now finds recent memories without repeatedly sorting entire histories, helping large journals open more smoothly.</p></div></article>
      </div>'''
new_release = '''      <p class="fuwa-release-lead">Fuwa now fits different iPhone sizes more consistently, with cleaner type, roomier writing controls, and several scrapbook and reflection fixes.</p>
      <div class="fuwa-release-list">
        <article><span>📱</span><div><strong>More consistent on iPhone</strong><p>Responsive spacing, safe widths, and text sizing are normalized so smaller and larger phones behave much more alike.</p></div></article>
        <article><span>✍️</span><div><strong>Less crowded writing</strong><p>Daily Life navigation, rating controls, dream writing space, and Fuwa’s typography have been cleaned up for easier reading and tapping.</p></div></article>
        <article><span>🎀</span><div><strong>Scrapbook fixes</strong><p>Photo and sticker empty states now use the full palette width, and imported scrapbook photos show as proper usable thumbnails.</p></div></article>
        <article><span>☁️</span><div><strong>Clearer little details</strong><p>Emotional Weather mood counts are easier to see, and Sleep Corner’s Now Playing controls now live with the soundscape choices.</p></div></article>
      </div>'''
replace_once("index.html", old_release, new_release)

# Integrate Sleep Corner's existing player with the soundscape section without
# creating a second audio engine or duplicating event listeners.
app_path = Path("app.js")
app = app_path.read_text(encoding="utf-8")
js_marker = "/* FUWA V87 — SLEEP PLAYER INTEGRATION */"
if js_marker in app:
    raise SystemExit("Fuwa v87 JS marker already present; refusing to double-apply patch")
app += r'''

/* FUWA V87 — SLEEP PLAYER INTEGRATION */
(function mountSleepPlayerWithSoundscapeV87() {
  function mount() {
    const soundGrid = document.getElementById("sleepSoundGrid");
    const player = document.getElementById("sleepPlayerCard");
    const soundSection = soundGrid?.closest(".sleep-section");
    if (!soundGrid || !player || !soundSection) return;

    if (player.parentElement !== soundSection) {
      soundSection.appendChild(player);
    }
    player.classList.add("sleep-player-inline");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
'''
app_path.write_text(app, encoding="utf-8")

# A final cascade layer fixes the photographed issues while avoiding destructive
# rewrites of older feature CSS. It also normalizes WebKit text sizing, which is
# important because iOS text auto-inflation can otherwise change layout between
# phone widths when very small legacy font sizes are present.
css_path = Path("style.css")
css = css_path.read_text(encoding="utf-8")
css_marker = "/* FUWA V87 — RESPONSIVE UI + TYPOGRAPHY STABILITY */"
if css_marker in css:
    raise SystemExit("Fuwa v87 CSS marker already present; refusing to double-apply patch")
css += r'''

/* FUWA V87 — RESPONSIVE UI + TYPOGRAPHY STABILITY */
:root{
  --fuwa-font-ui:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Segoe UI",sans-serif;
  --fuwa-font-display:Georgia,"Times New Roman",serif;
  --fuwa-app-gutter:clamp(12px,4vw,20px);
}

html{
  width:100%;
  max-width:100%;
  overflow-x:hidden;
  -webkit-text-size-adjust:100%;
  text-size-adjust:100%;
}
body{
  width:100%;
  max-width:100%;
  min-height:100dvh;
  overflow-x:hidden;
  font-family:var(--fuwa-font-ui);
}
body :where(button,input,textarea,select,label,p,small,span,strong,a,li,summary){font-family:var(--fuwa-font-ui)}
body :where(h1,h2,h3,.topbar h1,.hero-card h2,.section-heading h3,.page-title-row h2,.journal-page h3,.journal-closing h3,.journal-customize-head h3,.notebook-date-wrap strong){font-family:var(--fuwa-font-display)}

.app-shell{
  width:100%;
  max-width:520px;
  min-width:0;
  min-height:100dvh;
}
.topbar{
  width:100%;
  max-width:100%;
  min-width:0;
  padding-left:clamp(14px,4vw,20px);
  padding-right:clamp(14px,4vw,20px);
}
main{
  width:100%;
  max-width:100%;
  min-width:0;
  padding-left:var(--fuwa-app-gutter);
  padding-right:var(--fuwa-app-gutter);
}
.view,.view>*{min-width:0;max-width:100%}
.bottom-nav{width:min(100%,520px);max-width:100vw}
img,video,canvas,svg{max-width:100%}
:where(.section-heading,.page-title-row,.editor-top,.entry-meta-row,.composer-actions,.journal-palette-heading,.sleep-section-heading,.notebook-topbar,.life-collection-extra)>*{min-width:0}

/* Daily Life: prevent the section controls from clipping or sitting over the page. */
.notebook-shell{max-width:100%;min-width:0;overflow:hidden}
.notebook-topbar{grid-template-columns:auto minmax(0,1fr) auto}
.journal-section-jump{
  width:100%;
  min-width:0;
  margin:12px 0 7px;
  padding-inline:12px;
  overflow:hidden;
}
.journal-section-tabs{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:8px;
  overflow:visible;
  scroll-snap-type:none;
}
.journal-section-tabs button{
  width:100%;
  min-width:0;
  min-height:38px;
  padding:8px 9px;
  white-space:normal;
  line-height:1.2;
  font-size:10px;
}
.journal-page-jump-list{
  width:100%;
  min-width:0;
  padding:2px 3px 8px;
  scroll-padding-inline:8px;
  overscroll-behavior-x:contain;
}
.journal-page-jump-list button{flex:0 0 auto;max-width:80vw}
.notebook-form{
  min-width:0;
  padding-left:clamp(24px,7vw,30px);
  padding-right:clamp(12px,4vw,16px);
}
.journal-page h3{font-size:clamp(24px,7vw,30px)}
.journal-page>textarea{min-height:160px}
.journal-page .journal-chip-row+textarea{margin-top:16px}

/* Daily Life collections: give the rating field and Add button proper breathing room. */
.life-collection-form{gap:10px;padding:14px}
.life-collection-extra{
  display:grid;
  grid-template-columns:minmax(0,1fr) minmax(120px,1.25fr);
  align-items:end;
  justify-content:stretch;
  gap:12px;
}
.life-collection-extra label{
  display:grid;
  gap:6px;
  min-width:0;
  font-size:10px;
}
.life-collection-extra select{
  width:100%;
  min-width:0;
  min-height:46px;
  margin:0;
  padding:0 34px 0 12px;
  border-radius:12px;
  color:var(--ink);
  font-size:14px;
}
.life-collection-extra .primary-btn{
  width:100%;
  min-width:0;
  min-height:46px;
  padding:10px 14px;
  font-size:12px;
}

/* Scrapbook: empty copy and uploaded-photo grids must span the whole palette. */
.my-sticker-palette,.journal-photo-palette{align-items:start;min-width:0}
.journal-palette-empty,
.journal-palette-note,
.journal-photo-source-label,
.journal-photo-source-grid{
  grid-column:1/-1;
  width:100%;
  min-width:0;
}
.journal-palette-empty{
  padding:12px 14px;
  border:1px dashed rgba(226,194,207,.9);
  border-radius:14px;
  background:rgba(255,250,252,.7);
  font-size:11px;
  line-height:1.5;
}
.journal-photo-source-label{font-size:10px;line-height:1.35}
.journal-photo-source-grid{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(66px,1fr));
  gap:10px;
}
.journal-photo-source-grid .journal-photo-palette-wrap{min-width:0;width:100%}
.journal-photo-source-grid .journal-photo-chip{
  display:block;
  width:100%;
  min-width:66px;
  min-height:66px;
  aspect-ratio:1;
  padding:3px;
}
.journal-photo-source-grid .journal-photo-chip img{display:block;width:100%;height:100%;object-fit:cover}

/* Emotional Weather: the existing counts were present but too easy to miss. */
.weather-legend{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.weather-legend span{
  min-width:0;
  min-height:48px;
  gap:8px;
  overflow:visible;
  color:#68545d;
  font-size:13px;
  font-weight:800;
  line-height:1;
}
.weather-legend .fuwa-mood-icon.mini{
  flex:0 0 auto;
  transform:scale(.56);
  transform-origin:center;
  margin:-7px -5px;
}

/* Sleep Corner: Now Playing belongs to the selected soundscape, not a detached card. */
.sleep-section #sleepPlayerCard.sleep-player-inline{
  margin:14px 0 0;
  padding:14px;
  border-radius:20px;
  background:rgba(255,255,255,.58);
  box-shadow:none;
}
.sleep-player-inline .sleep-player-top{min-width:0;gap:10px}
.sleep-player-inline .sleep-now-art{flex:0 0 auto;transform:scale(.84);transform-origin:left center;margin-right:-3px}
.sleep-player-inline .sleep-progress{margin:10px 0}
.sleep-player-inline .sleep-player-actions{grid-template-columns:minmax(0,1fr) auto;gap:8px}

/* Keep horizontal controls deliberate instead of letting them leak out of cards. */
:where(.collection-category-row,.journal-page-jump-list,.notebook-progress){
  max-width:100%;
  overscroll-behavior-x:contain;
  -webkit-overflow-scrolling:touch;
}

@media(max-width:390px){
  :root{--fuwa-app-gutter:12px}
  .topbar{padding-left:14px;padding-right:14px}
  .journal-section-jump{padding-inline:8px}
  .notebook-topbar{gap:6px;padding-left:25px;padding-right:12px}
  .notebook-small-btn{padding:7px 8px}
  .journal-photo-source-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
  .weather-legend span{font-size:12px}
}
@media(max-width:340px){
  .journal-section-tabs button{font-size:9.5px;padding-inline:7px}
  .life-collection-extra{grid-template-columns:1fr}
  .journal-photo-source-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(min-width:430px){
  :root{--fuwa-app-gutter:18px}
}
@media(prefers-reduced-motion:reduce){
  .view,.journal-page{animation:none!important}
}
'''
css_path.write_text(css, encoding="utf-8")

print("Fuwa v87 patch applied successfully")
