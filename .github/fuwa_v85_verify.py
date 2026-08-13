from pathlib import Path
from html.parser import HTMLParser
import re

app = Path('app.js').read_text(encoding='utf-8')
html = Path('index.html').read_text(encoding='utf-8')
css = Path('style.css').read_text(encoding='utf-8')
sw = Path('service-worker.js').read_text(encoding='utf-8')

assert '<!-- FUWA_BUILD: v85-sanctuary-expansion-qa -->' in html
assert 'const DATABASE_VERSION = 13;' in app
assert len(re.findall(r'function\s+renderSanctuaryLegacy\s*\(\s*force\s*=\s*false\s*\)\s*\{', app)) == 1
assert len(re.findall(r'function\s+renderSanctuary\s*\(\s*force\s*=\s*false\s*\)\s*\{', app)) == 1
assert 'function sanctuaryV3MomentCount()' in app
assert 'function sanctuaryV3RenderShelf()' in app
assert 'renderMonthlyStory();\n  renderEmotionalWeather();\n  renderSanctuary();\n}' not in app
assert 'const FUWA_RELEASE_KEY = "fuwa-v1.1.0-2026-08-13";' in app
assert 'const CACHE_NAME = "fuwa-shell-v85";' in sw
assert 'const RELEASE_KEY = "fuwa-v1.1.0-2026-08-13";' in sw
for required in [
    'sanctuaryPanelMemories','sanctuaryPanelCustomize','sanctuaryPanelStory',
    'sanctuaryMemoryShelf','sanctuaryAmbienceOptions','sanctuarySeasonOptions',
    'sanctuaryPresetOptions','sanctuaryCompanionName','sanctuaryStageTimeline'
]:
    assert f'id="{required}"' in html, required

funcs = re.findall(r'\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(', app)
duplicates = sorted({name for name in funcs if funcs.count(name) > 1})
assert not duplicates, f'duplicate functions: {duplicates}'

class IdParser(HTMLParser):
    def __init__(self):
        super().__init__(); self.ids=[]
    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key == 'id' and value: self.ids.append(value)
parser = IdParser(); parser.feed(html)
duplicate_ids = sorted({i for i in parser.ids if parser.ids.count(i) > 1})
assert not duplicate_ids, f'duplicate ids: {duplicate_ids}'

view_ids = set(re.findall(r'id="([A-Za-z0-9_-]+)View"', html))
nav_targets = set(re.findall(r'data-nav="([A-Za-z0-9_-]+)"', html))
missing = sorted(target for target in nav_targets if target not in view_ids)
assert not missing, f'missing nav views: {missing}'

assert css.count('{') == css.count('}'), 'CSS brace imbalance'
assert '@media(prefers-reduced-motion:reduce)' in css
assert '.sanctuary-v3-tabs' in css and '.room-dream-mobile' in css
print('Fuwa v85 Sanctuary QA PASS')
