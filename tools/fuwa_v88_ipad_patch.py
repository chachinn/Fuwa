from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"missing expected text in {path}: {old[:80]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once("index.html", "FUWA_BUILD: v87-ui-responsive-stability-qa", "FUWA_BUILD: v88-ipad-responsive-qa")
replace_once("index.html", "What’s new in Fuwa 1.1.2", "What’s new in Fuwa 1.1.3")
replace_once(
    "index.html",
    "Fuwa now fits different iPhone sizes more consistently, with cleaner type, roomier writing controls, and several scrapbook and reflection fixes.",
    "Fuwa now adapts to iPad in both portrait and landscape while keeping the same soft, focused phone experience on iPhone."
)
replace_once(
    "index.html",
    '<article><span>📱</span><div><strong>More consistent on iPhone</strong><p>Responsive spacing, safe widths, and text sizing are normalized so smaller and larger phones behave much more alike.</p></div></article>',
    '<article><span>📱</span><div><strong>Made for iPad too</strong><p>Fuwa now has dedicated tablet widths for portrait and landscape, with wider content, roomier grids, and controls that stay comfortably contained.</p></div></article>'
)

replace_once("service-worker.js", 'const CACHE_NAME = "fuwa-shell-v87";', 'const CACHE_NAME = "fuwa-shell-v88";')
replace_once("service-worker.js", 'const RELEASE_KEY = "fuwa-v1.1.2-2026-08-14";', 'const RELEASE_KEY = "fuwa-v1.1.3-2026-08-14";')
replace_once("app.js", 'const FUWA_RELEASE_KEY = "fuwa-v1.1.2-2026-08-14";', 'const FUWA_RELEASE_KEY = "fuwa-v1.1.3-2026-08-14";')

css_path = Path("style.css")
css = css_path.read_text(encoding="utf-8")
marker = "FUWA V88 — IPAD PORTRAIT + LANDSCAPE RESPONSIVE TIER"
if marker in css:
    raise SystemExit("v88 tablet CSS already exists")

css += r'''

/* =========================================================
   FUWA V88 — IPAD PORTRAIT + LANDSCAPE RESPONSIVE TIER
   Tablet layouts use the extra room without turning Fuwa into
   a stretched phone screen. iPhone behavior remains unchanged.
   ========================================================= */

@media (min-width:700px){
  :root{--fuwa-app-gutter:clamp(24px,4vw,40px)}

  .app-shell{
    max-width:900px;
    margin-inline:auto;
  }
  .topbar{
    padding-left:clamp(26px,4vw,40px);
    padding-right:clamp(26px,4vw,40px);
  }
  main{
    width:100%;
    max-width:900px;
    margin-inline:auto;
  }
  .bottom-nav{
    width:min(calc(100% - 48px),760px);
    max-width:calc(100vw - 48px);
  }

  /* Daily Life gets a true tablet control layout instead of a scaled phone row. */
  .journal-section-jump{padding-inline:16px}
  .journal-section-tabs{
    grid-template-columns:repeat(4,minmax(0,1fr));
    gap:10px;
  }
  .journal-section-tabs button{
    min-height:44px;
    padding:10px 12px;
    font-size:11px;
  }
  .notebook-form{
    padding-left:44px;
    padding-right:28px;
  }
  .journal-page h3{font-size:clamp(30px,4vw,36px)}
  .journal-page>textarea{min-height:190px}
  .life-collection-form{padding:18px;gap:12px}
  .life-collection-extra{
    grid-template-columns:minmax(0,.8fr) minmax(190px,1.1fr);
    gap:16px;
  }

  /* Use tablet width where it genuinely improves scanning and tapping. */
  .weather-legend{
    grid-template-columns:repeat(6,minmax(0,1fr));
    gap:10px;
  }
  .weather-legend span{min-height:54px}
  .journal-photo-source-grid{
    grid-template-columns:repeat(auto-fill,minmax(92px,1fr));
    gap:12px;
  }
  .scrapbook-library-grid{
    grid-template-columns:repeat(3,minmax(0,1fr));
    gap:14px;
  }
  .life-dashboard-stats{
    grid-template-columns:repeat(4,minmax(0,1fr));
  }
  .life-dashboard-extra-grid{
    grid-template-columns:repeat(3,minmax(0,1fr));
  }

  /* Sheets/modals stay readable instead of becoming excessively wide. */
  :where(.settings-sheet,.journal-customize-sheet,.fuwa-release-sheet,.confirm-sheet){
    max-width:720px;
    margin-inline:auto;
  }
}

@media (min-width:1000px) and (orientation:landscape){
  :root{--fuwa-app-gutter:clamp(32px,4vw,52px)}

  .app-shell{max-width:1120px}
  main{max-width:1120px}
  .topbar{
    padding-left:clamp(34px,4vw,52px);
    padding-right:clamp(34px,4vw,52px);
  }
  .bottom-nav{
    width:min(calc(100% - 72px),840px);
    max-width:calc(100vw - 72px);
  }

  .journal-section-jump{padding-inline:20px}
  .notebook-form{
    padding-left:52px;
    padding-right:34px;
  }
  .journal-page>textarea{min-height:220px}
  .scrapbook-library-grid{
    grid-template-columns:repeat(4,minmax(0,1fr));
    gap:16px;
  }
  .journal-photo-source-grid{
    grid-template-columns:repeat(auto-fill,minmax(108px,1fr));
  }
  .life-dashboard-extra-grid{
    grid-template-columns:repeat(4,minmax(0,1fr));
  }
}
'''
css_path.write_text(css, encoding="utf-8")

print("Fuwa v88 iPad responsive patch applied")
