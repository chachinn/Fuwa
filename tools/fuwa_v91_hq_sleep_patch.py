from pathlib import Path
import re

INDEX = Path("index.html")
APP = Path("app.js")
SW = Path("service-worker.js")

# ---------- index.html ----------
html = INDEX.read_text(encoding="utf-8")
html, build_count = re.subn(
    r'<!--\s*FUWA_BUILD:\s*[^>]+-->',
    '<!-- FUWA_BUILD: v91-hq-recorded-sleep-audio-qa -->',
    html,
    count=1,
)
if build_count != 1:
    raise SystemExit("FUWA_BUILD comment marker missing or changed unexpectedly")

html = re.sub(
    r'<h2 id="fuwaReleaseNotesTitle">What’s new in Fuwa [^<]+</h2>',
    '<h2 id="fuwaReleaseNotesTitle">What’s new in Fuwa 1.1.6</h2>',
    html,
    count=1,
)
html = re.sub(
    r'<p class="fuwa-release-lead">.*?</p>',
    '<p class="fuwa-release-lead">Sleep Corner now uses local recorded ambience instead of live synthetic noise, and Now Playing sits where it belongs—above the sound choices.</p>',
    html,
    count=1,
    flags=re.S,
)

release_marker = '<div class="fuwa-release-list">'
release_insert = '''<div class="fuwa-release-list">
        <article><span>🎧</span><div><strong>Recorded sleep soundscapes</strong><p>Natural Sleep Corner sounds now use local recorded ambience prepared for gentle looping, with softer mastering and no live noise synthesis.</p></div></article>
        <article><span>☁️</span><div><strong>Now Playing moved to the top</strong><p>The player now appears before Soundscape so the active sound and timer controls stay visible before you browse other sounds.</p></div></article>'''
if "Recorded sleep soundscapes" not in html:
    if release_marker not in html:
        raise SystemExit("release list marker missing")
    html = html.replace(release_marker, release_insert, 1)

player_re = re.compile(r'\n\s*<section class="sleep-player-card" id="sleepPlayerCard">.*?</section>\s*', re.S)
match = player_re.search(html)
if not match:
    raise SystemExit("sleep player card missing")
player = match.group(0).strip()
html = html[:match.start()] + "\n" + html[match.end():]

soundscape_marker = '''        <section class="sleep-section">
          <div class="sleep-section-heading">
            <div>
              <p class="eyebrow">Choose your sound</p>'''
if soundscape_marker not in html:
    raise SystemExit("soundscape section marker missing")
html = html.replace(soundscape_marker, player + "\n\n" + soundscape_marker, 1)

# Guard against an unterminated build comment ever blanking the document again.
if '<!-- FUWA_BUILD: v91-hq-recorded-sleep-audio-qa -->' not in html:
    raise SystemExit("valid FUWA_BUILD comment not present after patch")

INDEX.write_text(html, encoding="utf-8")

# ---------- app.js ----------
js = APP.read_text(encoding="utf-8")
js = re.sub(
    r'const FUWA_RELEASE_KEY = "fuwa-v[^"]+";',
    'const FUWA_RELEASE_KEY = "fuwa-v1.1.6-2026-08-14";',
    js,
    count=1,
)

sound_names_block = '''const sleepSoundNames = {
  rain: "Gentle Rain",
  waves: "Ocean Drift",
  fireplace: "Warm Hearth",
  wind: "Evening Breeze",
  forest: "Quiet Forest",
  cafe: "Cozy Room",
  brown: "Deep Hush",
  white: "Soft Air"
};'''
if sound_names_block not in js:
    raise SystemExit("sleepSoundNames block changed unexpectedly")

audio_files_block = sound_names_block + r'''

const sleepAudioFiles = {
  rain: "./audio/sleep/gentle-rain.mp3",
  waves: "./audio/sleep/ocean-drift.mp3",
  fireplace: "./audio/sleep/warm-hearth.mp3",
  wind: "./audio/sleep/evening-breeze.mp3",
  forest: "./audio/sleep/quiet-forest.mp3",
  cafe: "./audio/sleep/cozy-room.mp3",
  brown: "./audio/sleep/deep-hush.mp3",
  white: "./audio/sleep/soft-air.mp3"
};

function sleepBaseVolume() {
  return Math.max(0, Math.min(1, Number(state.sleepVolume || 0) / 100));
}

function cancelSleepAudioTransition() {
  sleepAudioTransitionToken += 1;
  if (sleepAudioTransitionFrame !== null) {
    cancelAnimationFrame(sleepAudioTransitionFrame);
    sleepAudioTransitionFrame = null;
  }
}

function ensureSleepAudioElement() {
  if (!sleepAudioElement) {
    sleepAudioElement = new Audio();
    sleepAudioElement.loop = true;
    sleepAudioElement.preload = "metadata";
    sleepAudioElement.playsInline = true;
    sleepAudioElement.setAttribute("playsinline", "");
    sleepAudioElement.setAttribute("webkit-playsinline", "");
    sleepAudioElement.addEventListener("error", () => {
      const now = Date.now();
      if (sleepIsPlaying && now - sleepAudioErrorToastAt > 5000) {
        sleepAudioErrorToastAt = now;
        toast("Fuwa couldn't load this sound.");
      }
    });
  }
  return sleepAudioElement;
}

function loadSleepAudio(sound = state.sleepSound, { reset = true } = {}) {
  const path = sleepAudioFiles[sound] || sleepAudioFiles.rain;
  const audio = ensureSleepAudioElement();
  if (audio.dataset.sleepSound !== sound) {
    audio.pause();
    audio.src = path;
    audio.dataset.sleepSound = sound;
    audio.load();
    if (reset) {
      try { audio.currentTime = 0; } catch (_) {}
    }
  }
  return audio;
}

function setSleepAudioVolume(volume) {
  const audio = ensureSleepAudioElement();
  audio.volume = Math.max(0, Math.min(1, volume));
}

function rampSleepAudioVolume(target, duration = 450) {
  const audio = ensureSleepAudioElement();
  cancelSleepAudioTransition();
  const token = sleepAudioTransitionToken;
  const from = Number(audio.volume || 0);
  const to = Math.max(0, Math.min(1, target));
  const start = performance.now();

  return new Promise(resolve => {
    const tick = now => {
      if (token !== sleepAudioTransitionToken) {
        resolve(false);
        return;
      }
      const progress = Math.min(1, Math.max(0, (now - start) / Math.max(1, duration)));
      audio.volume = from + (to - from) * progress;
      if (progress < 1) {
        sleepAudioTransitionFrame = requestAnimationFrame(tick);
      } else {
        sleepAudioTransitionFrame = null;
        resolve(true);
      }
    };
    sleepAudioTransitionFrame = requestAnimationFrame(tick);
  });
}

async function playSelectedSleepAudio({ fadeIn = true } = {}) {
  const audio = loadSleepAudio(state.sleepSound);
  const target = sleepBaseVolume();
  cancelSleepAudioTransition();
  audio.volume = fadeIn ? 0 : target;
  await audio.play();
  if (fadeIn) await rampSleepAudioVolume(target, 900);
  return audio;
}
'''
js = js.replace(sound_names_block, audio_files_block, 1)

engine_re = re.compile(
    r'function ensureSleepAudioContext\(\) \{.*?\nfunction selectedSleepMinutes\(\) \{',
    re.S,
)
engine_replacement = r'''function selectedSleepMinutes() {'''
js, n = engine_re.subn(engine_replacement, js, count=1)
if n != 1:
    raise SystemExit("synthetic sleep engine block replacement failed")

start_re = re.compile(
    r'async function startSleepSound\(\) \{.*?\n\}\n\nasync function pauseSleepSound',
    re.S,
)
new_start = r'''async function startSleepSound() {
  try {
    if (sleepFadeTimeout) {
      clearTimeout(sleepFadeTimeout);
      sleepFadeTimeout = null;
    }

    const minutes = selectedSleepMinutes();
    state.sleepMinutes = minutes;
    savePreferences();

    await playSelectedSleepAudio({ fadeIn: true });
    sleepIsPlaying = true;
    sleepIsPaused = false;
    startSleepTimer(minutes);
    renderSleepControls();
  } catch (error) {
    console.error("Could not start Fuwa sleep sound.", error);
    sleepIsPlaying = false;
    sleepIsPaused = false;
    renderSleepControls();
    toast("Fuwa couldn't start audio on this device.");
  }
}

async function pauseSleepSound'''
js, n = start_re.subn(new_start, js, count=1)
if n != 1:
    raise SystemExit("startSleepSound replacement failed")

pause_re = re.compile(
    r'async function pauseSleepSound\(\) \{.*?\n\}\n\nasync function resumeSleepSound',
    re.S,
)
new_pause = r'''async function pauseSleepSound() {
  if (!sleepAudioElement || !sleepIsPlaying) return;

  sleepRemainingMs = Math.max(0, sleepTimerEndAt - Date.now());
  sleepIsPlaying = false;
  sleepIsPaused = true;
  clearInterval(sleepTimerInterval);
  sleepTimerInterval = null;
  cancelSleepAudioTransition();
  sleepAudioElement.pause();
  renderSleepControls();
}

async function resumeSleepSound'''
js, n = pause_re.subn(new_pause, js, count=1)
if n != 1:
    raise SystemExit("pauseSleepSound replacement failed")

resume_re = re.compile(
    r'async function resumeSleepSound\(\) \{.*?\n\}\n\nasync function stopSleepSound',
    re.S,
)
new_resume = r'''async function resumeSleepSound() {
  if (!sleepAudioElement || !sleepIsPaused) {
    await startSleepSound();
    return;
  }

  try {
    cancelSleepAudioTransition();
    sleepAudioElement.volume = sleepBaseVolume();
    await sleepAudioElement.play();
  } catch (error) {
    console.error("Could not resume Fuwa sleep sound.", error);
    toast("Fuwa couldn't resume this sound.");
    return;
  }

  sleepIsPaused = false;
  sleepIsPlaying = true;
  sleepTimerEndAt = Date.now() + sleepRemainingMs;
  clearInterval(sleepTimerInterval);
  sleepTimerInterval = setInterval(updateSleepCountdown, 1000);
  renderSleepControls();
}

async function stopSleepSound'''
js, n = resume_re.subn(new_resume, js, count=1)
if n != 1:
    raise SystemExit("resumeSleepSound replacement failed")

stop_re = re.compile(
    r'async function stopSleepSound\(fromTimer = false\) \{.*?\n\}\n\nasync function toggleSleepPlayback',
    re.S,
)
new_stop = r'''async function stopSleepSound(fromTimer = false) {
  sleepSoundSwitchToken += 1;
  clearInterval(sleepTimerInterval);
  sleepTimerInterval = null;
  cancelSleepAudioTransition();

  if (sleepAudioElement) {
    sleepAudioElement.pause();
    try { sleepAudioElement.currentTime = 0; } catch (_) {}
    sleepAudioElement.volume = sleepBaseVolume();
  }

  sleepIsPlaying = false;
  sleepIsPaused = false;
  sleepRemainingMs = 0;
  sleepTimerDurationMs = 0;
  sleepTimerEndAt = 0;
  renderSleepControls();

  if (fromTimer) toast("Sleep timer finished. Good night ☁️");
}

async function toggleSleepPlayback'''
js, n = stop_re.subn(new_stop, js, count=1)
if n != 1:
    raise SystemExit("stopSleepSound replacement failed")

select_re = re.compile(
    r'async function selectSleepSound\(sound\) \{.*?\n\}\n\nfunction setSleepTimerPreset',
    re.S,
)
new_select = r'''async function selectSleepSound(sound) {
  if (!sleepSoundNames[sound]) return;
  const switchToken = ++sleepSoundSwitchToken;
  state.sleepSound = sound;
  savePreferences();

  if (sleepIsPlaying) {
    const audio = ensureSleepAudioElement();
    await rampSleepAudioVolume(0, 320);
    if (!sleepIsPlaying || switchToken !== sleepSoundSwitchToken) return;

    audio.pause();
    loadSleepAudio(sound);
    audio.volume = 0;
    try {
      await audio.play();
      if (!sleepIsPlaying || switchToken !== sleepSoundSwitchToken) {
        audio.pause();
        return;
      }
      await rampSleepAudioVolume(sleepBaseVolume(), 650);
    } catch (error) {
      console.error("Could not switch Fuwa sleep sound.", error);
      sleepIsPlaying = false;
      sleepIsPaused = false;
      toast("Fuwa couldn't switch to this sound.");
    }
  }

  renderSleepControls();
}

function setSleepTimerPreset'''
js, n = select_re.subn(new_select, js, count=1)
if n != 1:
    raise SystemExit("selectSleepSound replacement failed")

volume_re = re.compile(
    r'function setSleepVolume\(value\) \{.*?\n\}\n\nfunction openSleepCorner',
    re.S,
)
new_volume = r'''function setSleepVolume(value) {
  state.sleepVolume = Math.max(0, Math.min(100, Number(value) || 0));
  savePreferences();

  if (sleepAudioElement) {
    const baseVolume = sleepBaseVolume();
    if (sleepIsPlaying && sleepRemainingMs > 0 && sleepRemainingMs <= 20000) {
      sleepAudioElement.volume = baseVolume * (sleepRemainingMs / 20000);
    } else if (sleepAudioTransitionFrame === null) {
      sleepAudioElement.volume = baseVolume;
    }
  }

  renderSleepControls();
}

function openSleepCorner'''
js, n = volume_re.subn(new_volume, js, count=1)
if n != 1:
    raise SystemExit("setSleepVolume replacement failed")

vars_re = re.compile(
    r'// Sleep audio is generated locally with Web Audio.*?let sleepSoundSwitchToken = 0;',
    re.S,
)
new_vars = r'''// Sleep Corner uses local recorded audio files. Nothing is generated at app startup;
// the audio element is created lazily only after the user opens/plays Sleep Corner.
let sleepAudioElement = null;
let sleepAudioTransitionFrame = null;
let sleepAudioTransitionToken = 0;
let sleepAudioErrorToastAt = 0;
let sleepTimerInterval = null;
let sleepTimerEndAt = 0;
let sleepTimerStartedAt = 0;
let sleepTimerDurationMs = 0;
let sleepIsPlaying = false;
let sleepIsPaused = false;
let sleepRemainingMs = 0;
let sleepFadeTimeout = null;
let sleepSoundSwitchToken = 0;'''
js, n = vars_re.subn(new_vars, js, count=1)
if n != 1:
    raise SystemExit("sleep variable block replacement failed")

update_countdown_re = re.compile(
    r'function updateSleepCountdown\(\) \{.*?\n\}\n\nfunction startSleepTimer',
    re.S,
)
new_update_countdown = r'''function updateSleepCountdown() {
  if (!sleepIsPlaying) return;
  sleepRemainingMs = Math.max(0, sleepTimerEndAt - Date.now());

  if (sleepAudioElement && sleepRemainingMs <= 20000 && sleepRemainingMs > 0) {
    sleepAudioElement.volume = sleepBaseVolume() * Math.max(0, sleepRemainingMs / 20000);
  }

  if (sleepRemainingMs <= 0) {
    stopSleepSound(true);
    return;
  }

  renderSleepControls();
}

function startSleepTimer'''
js, n = update_countdown_re.subn(new_update_countdown, js, count=1)
if n != 1:
    raise SystemExit("updateSleepCountdown replacement failed")

for forbidden in (
    "sleepAudioContext",
    "sleepMasterGain",
    "sleepMasterFilter",
    "sleepCompressor",
    "sleepNoiseBuffers",
    "buildRainSound",
    "ensureSleepAudioContext",
    "stopSleepNodesOnly",
):
    if forbidden in js:
        raise SystemExit(f"old synthetic audio reference remains: {forbidden}")

APP.write_text(js, encoding="utf-8")

# ---------- service-worker.js ----------
sw = SW.read_text(encoding="utf-8")
sw = re.sub(r'const CACHE_NAME = "fuwa-shell-v\d+";', 'const CACHE_NAME = "fuwa-shell-v91";', sw, count=1)
sw = re.sub(r'const RELEASE_KEY = "fuwa-v[^"]+";', 'const RELEASE_KEY = "fuwa-v1.1.6-2026-08-14";', sw, count=1)

audio_assets = '''const SLEEP_AUDIO_ASSETS = [
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
if "const SLEEP_AUDIO_ASSETS" not in sw:
    sw = sw.replace('const OPTIONAL_ASSETS = [', audio_assets + 'const OPTIONAL_ASSETS = [', 1)

sw = sw.replace(
    'await Promise.all(OPTIONAL_ASSETS.map(asset => cache.add(asset).catch(() => null)));',
    'await Promise.all([...OPTIONAL_ASSETS, ...SLEEP_AUDIO_ASSETS].map(asset => cache.add(asset).catch(() => null)));',
    1,
)

if 'url.pathname.includes("/audio/sleep/")' not in sw:
    sw = sw.replace(
        'url.pathname.endsWith("/manifest.json")',
        'url.pathname.endsWith("/manifest.json") ||\n    url.pathname.includes("/audio/sleep/")',
        1,
    )

SW.write_text(sw, encoding="utf-8")
