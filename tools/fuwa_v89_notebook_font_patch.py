from pathlib import Path
import re

css = Path('style.css')
text = css.read_text(encoding='utf-8')
marker = '/* FUWA V89 — NOTEBOOK GEOMETRY + ORIGINAL SOFT TYPE */'
if marker not in text:
    text += r'''

/* FUWA V89 — NOTEBOOK GEOMETRY + ORIGINAL SOFT TYPE */
:root{
  --fuwa-font-ui:Inter,ui-rounded,"SF Pro Rounded",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  --fuwa-font-display:Georgia,"Times New Roman",serif;
  --fuwa-notebook-left:clamp(24px,7vw,30px);
  --fuwa-notebook-right:clamp(12px,4vw,16px);
}
body,
body :where(button,input,textarea,select,label,p,small,span,strong,a,li,summary){font-family:var(--fuwa-font-ui)}
body :where(h1,h2,h3,.topbar h1,.hero-card h2,.section-heading h3,.page-title-row h2,.journal-page h3,.journal-closing h3,.journal-customize-head h3,.notebook-date-wrap strong){font-family:var(--fuwa-font-display)}

.journal-section-jump,
.notebook-form{
  box-sizing:border-box;
  width:100%;
  max-width:100%;
  padding-left:var(--fuwa-notebook-left);
  padding-right:var(--fuwa-notebook-right);
}
.journal-section-jump{margin:12px 0 7px;overflow:hidden}
.journal-section-tabs,
.journal-page-jump-list{width:100%;max-width:100%;min-width:0;margin-left:0;margin-right:0}
.journal-section-tabs button,
.journal-page-jump-list button{box-sizing:border-box}

@media (min-width:700px){
  :root{--fuwa-notebook-left:44px;--fuwa-notebook-right:28px}
}
@media (min-width:1000px) and (orientation:landscape){
  :root{--fuwa-notebook-left:52px;--fuwa-notebook-right:34px}
}
'''
css.write_text(text, encoding='utf-8')

idx = Path('index.html')
html = idx.read_text(encoding='utf-8')
assert 'FUWA_BUILD: v88-ipad-responsive' in html
html = html.replace('FUWA_BUILD: v88-ipad-responsive', 'FUWA_BUILD: v89-notebook-geometry-font-restore', 1)
assert 'What’s new in Fuwa 1.1.3' in html
html = html.replace('What’s new in Fuwa 1.1.3', 'What’s new in Fuwa 1.1.4', 1)
html, n = re.subn(r'<p class="fuwa-release-lead">.*?</p>', '<p class="fuwa-release-lead">Daily Life now stays properly inside the notebook on every supported screen size, and Fuwa’s original softer typography is back.</p>', html, count=1, flags=re.S)
assert n == 1
release = '''<div class="fuwa-release-list">
        <article><span>📓</span><div><strong>Notebook edges finally line up</strong><p>Daily Life section tabs, page shortcuts, and writing pages now share the exact same inner margins instead of using mismatched insets.</p></div></article>
        <article><span>☁️</span><div><strong>Fuwa’s softer type is back</strong><p>The v87 system-font replacement has been removed. Fuwa is back to its original rounded interface type with serif reserved for display headings.</p></div></article>
        <article><span>📱</span><div><strong>Phone and iPad together</strong><p>The corrected notebook geometry is applied consistently to small phones, larger iPhones, iPad portrait, and iPad landscape.</p></div></article>
      </div>'''
html, n = re.subn(r'<div class="fuwa-release-list">.*?</div>\s*<button class="fuwa-release-got-it"', release + '\n      <button class="fuwa-release-got-it"', html, count=1, flags=re.S)
assert n == 1
idx.write_text(html, encoding='utf-8')

app = Path('app.js')
a = app.read_text(encoding='utf-8')
assert 'fuwa-v1.1.3-2026-08-14' in a
a = a.replace('fuwa-v1.1.3-2026-08-14', 'fuwa-v1.1.4-2026-08-14', 1)
app.write_text(a, encoding='utf-8')

sw = Path('service-worker.js')
s = sw.read_text(encoding='utf-8')
assert 'fuwa-shell-v88' in s and 'fuwa-v1.1.3-2026-08-14' in s
s = s.replace('fuwa-shell-v88', 'fuwa-shell-v89', 1).replace('fuwa-v1.1.3-2026-08-14', 'fuwa-v1.1.4-2026-08-14', 1)
sw.write_text(s, encoding='utf-8')
