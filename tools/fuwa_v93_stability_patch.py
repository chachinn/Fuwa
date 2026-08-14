from pathlib import Path
import json, re

BUILD = "v93-stability-performance-qa"
RELEASE = "fuwa-v1.1.8-2026-08-14"

# index.html: release/build markers + concise What's New copy.
html_path = Path("index.html")
html = html_path.read_text(encoding="utf-8")
html, n = re.subn(r'<!-- FUWA_BUILD: [^>]+ -->', f'<!-- FUWA_BUILD: {BUILD} -->', html, count=1)
assert n == 1, "build marker not found"
html = html.replace("What’s new in Fuwa 1.1.7", "What’s new in Fuwa 1.1.8")
old_lead = "Daily Life is easier to write in, Sleep Corner gets out of the way, and Sanctuary’s Surprise me now brings the memory to you."
new_lead = "A quieter reliability update: faster app updates, proper iPad rotation, and another full stability pass without changing your journal data."
assert old_lead in html, "release lead not found"
html = html.replace(old_lead, new_lead, 1)
anchor = '<div class="fuwa-release-list">'
assert anchor in html
article = '<article><span>◌</span><div><strong>Lighter updates</strong><p>Sleep Corner’s large ambience files now cache only when you use them, so Fuwa updates do not wait on every sound download.</p></div></article>'
html = html.replace(anchor, anchor + article, 1)
html_path.write_text(html, encoding="utf-8")

# app.js: release handoff marker only. No DB/schema/content changes.
app_path = Path("app.js")
app = app_path.read_text(encoding="utf-8")
app, n = re.subn(r'const FUWA_RELEASE_KEY = "fuwa-v1\.1\.7-2026-08-14";', f'const FUWA_RELEASE_KEY = "{RELEASE}";', app, count=1)
assert n == 1, "app release marker not found"
app_path.write_text(app, encoding="utf-8")

# manifest: installed Fuwa must support both iPad portrait and landscape.
manifest_path = Path("manifest.json")
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
manifest["orientation"] = "any"
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Service worker: keep core shell small. HQ audio is ~22 MB and should cache lazily.
sw_path = Path("service-worker.js")
sw = sw_path.read_text(encoding="utf-8")
sw = sw.replace('const CACHE_NAME = "fuwa-shell-v92";', 'const CACHE_NAME = "fuwa-shell-v93";', 1)
sw = sw.replace('const RELEASE_KEY = "fuwa-v1.1.7-2026-08-14";', f'const RELEASE_KEY = "{RELEASE}";', 1)

sleep_block = '''const SLEEP_AUDIO_ASSETS = [
  "./audio/sleep/gentle-rain.mp3",
  "./audio/sleep/ocean-drift.mp3",
  "./audio/sleep/warm-hearth.mp3",
  "./audio/sleep/evening-breeze.mp3",
  "./audio/sleep/quiet-forest.mp3",
  "./audio/sleep/cozy-room.mp3",
  "./audio/sleep/deep-hush.mp3",
  "./audio/sleep/soft-air.mp3"
];

'''
assert sleep_block in sw, "sleep audio block not found"
sw = sw.replace(sleep_block, "", 1)
sw = sw.replace(
    'await Promise.all([...OPTIONAL_ASSETS, ...SLEEP_AUDIO_ASSETS].map(asset => cache.add(asset).catch(() => null)));',
    'await Promise.all(OPTIONAL_ASSETS.map(asset => cache.add(asset).catch(() => null)));',
    1
)
sw = sw.replace(
    '    url.pathname.endsWith("/data/scrapbook-data.js") ||\n    url.pathname.endsWith("/manifest.json") ||\n    url.pathname.includes("/audio/sleep/")',
    '    url.pathname.endsWith("/data/scrapbook-data.js") ||\n    url.pathname.endsWith("/manifest.json")',
    1
)
needle = 'function isCoreRequest(request) {'
assert needle in sw
helper = '''function isSleepAudioRequest(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin && url.pathname.includes("/audio/sleep/");
}

'''
sw = sw.replace(needle, helper + needle, 1)
fetch_anchor = '''  if (isCoreRequest(event.request)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }
'''
assert fetch_anchor in sw
fetch_replacement = '''  if (isSleepAudioRequest(event.request)) {
    // Large immutable ambience tracks are fetched only when requested, then kept offline.
    event.respondWith(cacheFirst(event.request).catch(() => Response.error()));
    return;
  }

''' + fetch_anchor
sw = sw.replace(fetch_anchor, fetch_replacement, 1)
sw_path.write_text(sw, encoding="utf-8")

print("Fuwa v93 stability/performance patch applied")
