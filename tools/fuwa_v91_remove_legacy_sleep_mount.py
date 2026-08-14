from pathlib import Path
import re

APP = Path("app.js")
js = APP.read_text(encoding="utf-8")

pattern = re.compile(
    r'/\* FUWA V87 — SLEEP PLAYER INTEGRATION \*/\s*'
    r'\(function mountSleepPlayerWithSoundscapeV87\(\) \{.*?\}\)\(\);',
    re.S,
)

js, count = pattern.subn(
    '/* FUWA V91: legacy v87 player re-parenting removed.\n'
    '   Now Playing stays above Soundscape in the Sleep Corner source order. */',
    js,
    count=1,
)

if count != 1:
    raise SystemExit("Legacy v87 Sleep Player mount block was not found exactly once")

if "mountSleepPlayerWithSoundscapeV87" in js or "soundSection.appendChild(player)" in js:
    raise SystemExit("Legacy Sleep Player mounting behavior still remains")

APP.write_text(js, encoding="utf-8")
