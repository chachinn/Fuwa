from pathlib import Path
import re

# ---------- index.html ----------
p = Path('index.html')
html = p.read_text(encoding='utf-8')
html = html.replace('FUWA_BUILD: v89-notebook-geometry-font-restore-qa', 'FUWA_BUILD: v90-home-sleep-nav-ui-qa')
html = html.replace('What’s new in Fuwa 1.1.4', 'What’s new in Fuwa 1.1.5')
html = html.replace(
    'Daily Life now stays properly inside the notebook on every supported screen size, and Fuwa’s original softer typography is back.',
    'Home feels softer and more cloud-like, Sleep Corner is calmer and easier to use, and the bottom navigation now sits naturally at the bottom of the app.'
)
release_list = '<div class="fuwa-release-list">'
if release_list in html and 'Circular cloud mood choices' not in html:
    html = html.replace(release_list, release_list + '''
        <article><span>☁️</span><div><strong>Circular cloud mood choices</strong><p>Home mood buttons are now compact circles that fit Fuwa’s cloud language without the tall card look.</p></div></article>
        <article><span>🌙</span><div><strong>A calmer Sleep Corner</strong><p>Now Playing sits directly below the sound choices, while all eight synthesized soundscapes use softer filtering, lower harsh-frequency energy, and gentler movement.</p></div></article>
        <article><span>⌂</span><div><strong>Navigation grounded at the bottom</strong><p>The five main tabs now attach to the bottom edge instead of appearing like a floating card.</p></div></article>''', 1)

player_re = re.compile(r'\n\s*<section class="sleep-player-card" id="sleepPlayerCard">.*?</section>\s*', re.S)
m = player_re.search(html)
if not m:
    raise SystemExit('sleep player card not found')
player = m.group(0).strip()
html = html[:m.start()] + '\n' + html[m.end():]
timer_marker = re.compile(r'(<section class="sleep-section">\s*<div class="sleep-section-heading">\s*<div>\s*<p class="eyebrow">How long\?</p>)', re.S)
tm = timer_marker.search(html)
if not tm:
    raise SystemExit('sleep timer section not found')
html = html[:tm.start()] + player + '\n\n        ' + html[tm.start():]
p.write_text(html, encoding='utf-8')

# ---------- style.css ----------
p = Path('style.css')
css = p.read_text(encoding='utf-8')
marker = '/* FUWA V90 — HOME CLOUD MOODS + GROUNDED NAV + SLEEP PLAYER */'
if marker not in css:
    css += r'''

/* FUWA V90 — HOME CLOUD MOODS + GROUNDED NAV + SLEEP PLAYER */
.hero-card .mood-picker{
  grid-template-columns:repeat(6,minmax(0,1fr))!important;
  gap:clamp(6px,1.8vw,9px)!important;
  align-items:center!important;
  margin:12px 0 18px!important;
}
.hero-card .mood-picker button{
  width:100%!important;
  min-width:0!important;
  min-height:0!important;
  height:auto!important;
  aspect-ratio:1 / 1!important;
  padding:clamp(4px,1vw,7px)!important;
  border-radius:50%!important;
  display:grid!important;
  place-items:center!important;
  overflow:hidden!important;
  transform:none!important;
}
.hero-card .mood-picker button.selected{
  transform:scale(1.04)!important;
  box-shadow:0 7px 18px rgba(219,109,140,.14)!important;
}
.hero-card .mood-picker .fuwa-mood-svg{
  display:block!important;
  width:100%!important;
  max-width:58px!important;
  height:auto!important;
  margin:0 auto!important;
}

.bottom-nav{
  bottom:0!important;
  margin-bottom:0!important;
  border-radius:24px 24px 0 0!important;
  border:1px solid rgba(232,210,219,.92)!important;
  border-bottom:0!important;
  box-shadow:0 -10px 30px rgba(93,66,77,.10)!important;
  padding-bottom:calc(8px + var(--safe-bottom))!important;
}
.app-shell{padding-bottom:calc(82px + var(--safe-bottom))!important}

#sleepView .sleep-player-card{
  margin:14px 0 20px!important;
  padding:16px!important;
  border-radius:22px!important;
  background:rgba(255,255,255,.72)!important;
  box-shadow:0 8px 22px rgba(84,65,91,.065)!important;
}
#sleepView .sleep-player-top{align-items:center!important}
#sleepView .sleep-player-actions{gap:10px!important}
#sleepView .sleep-section + .sleep-player-card{margin-top:12px!important}

@media(max-width:350px){
  .hero-card .mood-picker{gap:5px!important}
  .hero-card .mood-picker button{padding:3px!important}
}
@media(min-width:700px){
  .hero-card .mood-picker{max-width:620px;margin-left:auto!important;margin-right:auto!important}
  #sleepView .sleep-player-card{max-width:720px;margin-left:auto!important;margin-right:auto!important}
}
'''
p.write_text(css, encoding='utf-8')

# ---------- app.js ----------
p = Path('app.js')
js = p.read_text(encoding='utf-8')
js = js.replace('const FUWA_RELEASE_KEY = "fuwa-v1.1.4-2026-08-14";', 'const FUWA_RELEASE_KEY = "fuwa-v1.1.5-2026-08-14";')
js = js.replace('sleepMasterFilter.frequency.value = 6200;', 'sleepMasterFilter.frequency.value = 4300;')
js = js.replace('sleepMasterFilter.Q.value = 0.12;', 'sleepMasterFilter.Q.value = 0.08;')
js = js.replace('sleepCompressor.threshold.value = -28;', 'sleepCompressor.threshold.value = -24;')
js = js.replace('sleepCompressor.knee.value = 24;', 'sleepCompressor.knee.value = 30;')
js = js.replace('sleepCompressor.ratio.value = 2.5;', 'sleepCompressor.ratio.value = 1.8;')
js = js.replace('sleepCompressor.attack.value = 0.08;', 'sleepCompressor.attack.value = 0.12;')
js = js.replace('sleepCompressor.release.value = 0.42;', 'sleepCompressor.release.value = 0.62;')
js = js.replace('let sleepFadeTimeout = null;', 'let sleepFadeTimeout = null;\nlet sleepSoundSwitchToken = 0;')

builders_re = re.compile(r'function buildRainSound\(\) \{.*?function buildSelectedSleepSound\(\) \{', re.S)
builders = r'''function buildRainSound() {
  const rain = createFilteredNoise({ color: "pink", type: "lowpass", frequency: 2800, q: 0.10, gain: 0.074 });
  const windowBed = createFilteredNoise({ color: "brown", type: "bandpass", frequency: 430, q: 0.35, gain: 0.017 });
  createLfo(rain.gain.gain, 0.024, 0.006, 0.070);
  createLfo(windowBed.gain.gain, 0.031, 0.003, 0.016);
}

function buildWaveSound() {
  const tide = createFilteredNoise({ color: "brown", type: "lowpass", frequency: 650, q: 0.12, gain: 0.084 });
  const foam = createFilteredNoise({ color: "pink", type: "bandpass", frequency: 900, q: 0.42, gain: 0.014 });
  createLfo(tide.gain.gain, 0.044, 0.055, 0.066);
  createLfo(foam.gain.gain, 0.045, 0.008, 0.010);
}

function buildFireplaceSound() {
  const warmth = createFilteredNoise({ color: "brown", type: "lowpass", frequency: 360, q: 0.12, gain: 0.062 });
  const ember = createFilteredNoise({ color: "pink", type: "bandpass", frequency: 520, q: 0.38, gain: 0.010 });
  createLfo(warmth.gain.gain, 0.042, 0.004, 0.059);
  createLfo(ember.gain.gain, 0.18, 0.0025, 0.0085);
}

function buildWindSound() {
  const breeze = createFilteredNoise({ color: "pink", type: "lowpass", frequency: 1150, q: 0.12, gain: 0.048 });
  const lowAir = createFilteredNoise({ color: "brown", type: "bandpass", frequency: 260, q: 0.25, gain: 0.013 });
  createLfo(breeze.filter.frequency, 0.020, 140, 960);
  createLfo(breeze.gain.gain, 0.027, 0.010, 0.043);
  createLfo(lowAir.gain.gain, 0.020, 0.0025, 0.012);
}

function buildForestSound() {
  const nightAir = createFilteredNoise({ color: "brown", type: "lowpass", frequency: 760, q: 0.12, gain: 0.043 });
  const leaves = createFilteredNoise({ color: "pink", type: "bandpass", frequency: 1650, q: 0.72, gain: 0.005 });
  createLfo(nightAir.gain.gain, 0.020, 0.005, 0.040);
  createLfo(leaves.gain.gain, 0.11, 0.0015, 0.0042);
}

function buildCafeSound() {
  const room = createFilteredNoise({ color: "brown", type: "lowpass", frequency: 560, q: 0.14, gain: 0.050 });
  const fabric = createFilteredNoise({ color: "pink", type: "bandpass", frequency: 720, q: 0.32, gain: 0.007 });
  createLfo(room.gain.gain, 0.019, 0.004, 0.047);
  createLfo(fabric.gain.gain, 0.032, 0.0015, 0.006);
}

function buildBrownNoise() {
  const hush = createFilteredNoise({ color: "brown", type: "lowpass", frequency: 700, q: 0.08, gain: 0.094 });
  createLfo(hush.gain.gain, 0.012, 0.003, 0.091);
}

function buildWhiteNoise() {
  const air = createFilteredNoise({ color: "pink", type: "lowpass", frequency: 2450, q: 0.08, gain: 0.058 });
  const softness = createFilteredNoise({ color: "brown", type: "lowpass", frequency: 480, q: 0.10, gain: 0.010 });
  createLfo(air.gain.gain, 0.014, 0.0025, 0.056);
  createLfo(softness.gain.gain, 0.018, 0.0015, 0.009);
}

function buildSelectedSleepSound() {'''
js, n = builders_re.subn(builders, js, count=1)
if n != 1:
    raise SystemExit('sleep builder block not replaced')

select_re = re.compile(r'async function selectSleepSound\(sound\) \{.*?\n\}\n\nfunction setSleepTimerPreset', re.S)
new_select = r'''async function selectSleepSound(sound) {
  if (!sleepSoundNames[sound]) return;
  const switchToken = ++sleepSoundSwitchToken;
  state.sleepSound = sound;
  savePreferences();

  if (sleepIsPlaying) {
    const ctx = ensureSleepAudioContext();
    const currentGain = Math.max(0.0001, sleepMasterGain.gain.value);
    sleepMasterGain.gain.cancelScheduledValues(ctx.currentTime);
    sleepMasterGain.gain.setValueAtTime(currentGain, ctx.currentTime);
    sleepMasterGain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.50);

    setTimeout(() => {
      if (!sleepIsPlaying || switchToken !== sleepSoundSwitchToken) return;
      stopSleepNodesOnly();
      buildSelectedSleepSound();
      sleepMasterGain.gain.cancelScheduledValues(ctx.currentTime);
      sleepMasterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      sleepMasterGain.gain.linearRampToValueAtTime(Math.max(0.0001, state.sleepVolume / 100), ctx.currentTime + 1.15);
    }, 420);
  }

  renderSleepControls();
}

function setSleepTimerPreset'''
js, n = select_re.subn(new_select, js, count=1)
if n != 1:
    raise SystemExit('selectSleepSound not replaced')

js = js.replace('async function stopSleepSound(fromTimer = false) {\n  clearInterval(sleepTimerInterval);', 'async function stopSleepSound(fromTimer = false) {\n  sleepSoundSwitchToken += 1;\n  clearInterval(sleepTimerInterval);')
p.write_text(js, encoding='utf-8')

# ---------- service-worker.js ----------
p = Path('service-worker.js')
sw = p.read_text(encoding='utf-8')
sw = sw.replace('const CACHE_NAME = "fuwa-shell-v89";', 'const CACHE_NAME = "fuwa-shell-v90";')
sw = sw.replace('const RELEASE_KEY = "fuwa-v1.1.4-2026-08-14";', 'const RELEASE_KEY = "fuwa-v1.1.5-2026-08-14";')
p.write_text(sw, encoding='utf-8')
