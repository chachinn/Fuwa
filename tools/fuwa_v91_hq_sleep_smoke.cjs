const { chromium } = require(process.cwd() + '/node_modules/playwright');

const BASE_URL = 'http://127.0.0.1:4187/index.html';
const sizes = [
  { name: 'iPhone small', width: 320, height: 568 },
  { name: 'iPhone standard', width: 390, height: 844, audio: true },
  { name: 'iPhone large', width: 430, height: 932 },
  { name: 'iPad portrait', width: 820, height: 1180 },
  { name: 'iPad landscape', width: 1180, height: 820 }
];

(async () => {
  const browser = await chromium.launch({ headless: true });

  for (const spec of sizes) {
    const context = await browser.newContext({
      viewport: { width: spec.width, height: spec.height },
      isMobile: true,
      hasTouch: true
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));

    await page.addInitScript(() => {
      localStorage.setItem('fuwaLocalModeV1', '1');
      localStorage.setItem('fuwaTutorialSeenV1', '1');
    });

    const response = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    if (!response || response.status() !== 200) throw new Error(`${spec.name} HTTP ${response?.status()}`);
    await page.waitForTimeout(1100);

    const structure = await page.evaluate(() => {
      ['fuwaTutorial', 'moodCheckinModal', 'fuwaReleaseNotesModal'].forEach(id => {
        document.getElementById(id)?.classList.add('hidden');
      });
      document.body.style.overflow = '';

      const sleepView = document.getElementById('sleepView');
      const player = document.getElementById('sleepPlayerCard');
      const soundGrid = document.getElementById('sleepSoundGrid');
      const timerOptions = document.getElementById('sleepTimerOptions');
      const playButton = document.getElementById('sleepPlayPauseButton');
      const stopButton = document.getElementById('sleepStopButton');

      if (!sleepView || !player || !soundGrid || !timerOptions || !playButton || !stopButton) {
        return {
          missing: {
            sleepView: !sleepView,
            player: !player,
            soundGrid: !soundGrid,
            timerOptions: !timerOptions,
            playButton: !playButton,
            stopButton: !stopButton
          },
          htmlChars: document.documentElement.outerHTML.length,
          bodyChars: document.body.innerHTML.length,
          title: document.title
        };
      }

      document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
      sleepView.classList.add('active');
      sleepView.style.display = 'block';
      sleepView.style.visibility = 'visible';
      sleepView.style.opacity = '1';

      const soundSection = soundGrid.closest('.sleep-section');
      const timerSection = timerOptions.closest('.sleep-section');
      const children = [...sleepView.children].map(el => ({
        id: el.id || '',
        cls: el.className || '',
        text: (el.textContent || '').trim().slice(0, 32)
      }));

      return {
        missing: null,
        playerParent: player.parentElement?.id || player.parentElement?.className || '',
        soundParent: soundSection?.parentElement?.id || soundSection?.parentElement?.className || '',
        children,
        orderPlayerBeforeSound: !!(player.compareDocumentPosition(soundSection) & Node.DOCUMENT_POSITION_FOLLOWING),
        orderSoundBeforeTimer: !!(soundSection.compareDocumentPosition(timerSection) & Node.DOCUMENT_POSITION_FOLLOWING),
        sounds: document.querySelectorAll('[data-sleep-sound]').length,
        canMp3: document.createElement('audio').canPlayType('audio/mpeg'),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        playerRect: (() => { const r = player.getBoundingClientRect(); return { top:r.top, left:r.left, right:r.right, width:r.width, height:r.height }; })(),
        soundRect: (() => { const r = soundSection.getBoundingClientRect(); return { top:r.top, left:r.left, right:r.right, width:r.width, height:r.height }; })(),
        timerRect: (() => { const r = timerSection.getBoundingClientRect(); return { top:r.top, left:r.left, right:r.right, width:r.width, height:r.height }; })(),
        viewport: window.innerWidth,
        navBottom: (() => {
          const nav = document.querySelector('.bottom-nav')?.getBoundingClientRect();
          return nav ? window.innerHeight - nav.bottom : null;
        })()
      };
    });

    if (structure.missing) throw new Error(`${spec.name} Sleep DOM missing ${JSON.stringify(structure)}`);
    if (!structure.orderPlayerBeforeSound || !structure.orderSoundBeforeTimer) {
      throw new Error(`${spec.name} Sleep Corner DOM order wrong ${JSON.stringify(structure)}`);
    }
    if (!(structure.playerRect.top < structure.soundRect.top && structure.soundRect.top < structure.timerRect.top)) {
      throw new Error(`${spec.name} Sleep Corner visual order wrong ${JSON.stringify(structure)}`);
    }
    if (structure.sounds !== 8) throw new Error(`${spec.name} expected 8 sounds`);
    if (!structure.canMp3) throw new Error(`${spec.name} reports no MP3 support`);
    if (structure.overflow > 2) throw new Error(`${spec.name} overflow ${structure.overflow}`);
    for (const [key, rect] of Object.entries({ player: structure.playerRect, sound: structure.soundRect, timer: structure.timerRect })) {
      if (rect.width <= 0 || rect.left < -2 || rect.right > structure.viewport + 2) {
        throw new Error(`${spec.name} ${key} geometry bad ${JSON.stringify(rect)} viewport=${structure.viewport}`);
      }
    }
    if (structure.navBottom !== null && Math.abs(structure.navBottom) > 2) {
      throw new Error(`${spec.name} nav not bottom attached ${structure.navBottom}`);
    }

    if (spec.audio) {
      const globals = await page.evaluate(() => ({
        selectSleepSound: typeof selectSleepSound,
        toggleSleepPlayback: typeof toggleSleepPlayback,
        stopSleepSound: typeof stopSleepSound
      }));
      if (globals.selectSleepSound !== 'function' || globals.toggleSleepPlayback !== 'function' || globals.stopSleepSound !== 'function') {
        throw new Error(`Sleep audio functions unavailable ${JSON.stringify(globals)}`);
      }

      await page.locator('[data-sleep-sound="rain"]').click({ force: true });
      await page.locator('#sleepPlayPauseButton').click({ force: true });
      await page.waitForTimeout(1200);

      let audioState = await page.evaluate(() => ({
        playing: sleepIsPlaying,
        paused: sleepAudioElement?.paused,
        src: sleepAudioElement?.currentSrc || '',
        label: document.querySelector('#sleepNowPlaying')?.textContent,
        button: document.querySelector('#sleepPlayPauseText')?.textContent,
        readyState: sleepAudioElement?.readyState
      }));
      if (!audioState.playing || audioState.paused || !audioState.src.includes('gentle-rain.mp3') || audioState.label !== 'Gentle Rain' || audioState.button !== 'Pause') {
        throw new Error(`play failed ${JSON.stringify(audioState)}`);
      }

      await page.locator('[data-sleep-sound="waves"]').click({ force: true });
      await page.locator('[data-sleep-sound="forest"]').click({ force: true });
      await page.locator('[data-sleep-sound="cafe"]').click({ force: true });
      await page.waitForTimeout(1400);

      audioState = await page.evaluate(() => ({
        sound: state.sleepSound,
        src: sleepAudioElement?.currentSrc || '',
        label: document.querySelector('#sleepNowPlaying')?.textContent,
        playing: sleepIsPlaying,
        paused: sleepAudioElement?.paused
      }));
      if (audioState.sound !== 'cafe' || !audioState.src.includes('cozy-room.mp3') || audioState.label !== 'Cozy Room' || !audioState.playing || audioState.paused) {
        throw new Error(`rapid switch failed ${JSON.stringify(audioState)}`);
      }

      await page.locator('#sleepPlayPauseButton').click({ force: true });
      await page.waitForTimeout(150);
      audioState = await page.evaluate(() => ({
        playing: sleepIsPlaying,
        paused: sleepIsPaused,
        audioPaused: sleepAudioElement?.paused
      }));
      if (audioState.playing || !audioState.paused || !audioState.audioPaused) {
        throw new Error(`pause failed ${JSON.stringify(audioState)}`);
      }

      await page.locator('#sleepPlayPauseButton').click({ force: true });
      await page.waitForTimeout(400);
      await page.locator('#sleepStopButton').click({ force: true });
      await page.waitForTimeout(100);
      audioState = await page.evaluate(() => ({
        playing: sleepIsPlaying,
        paused: sleepIsPaused,
        audioPaused: sleepAudioElement?.paused,
        remaining: sleepRemainingMs
      }));
      if (audioState.playing || audioState.paused || !audioState.audioPaused || audioState.remaining !== 0) {
        throw new Error(`stop failed ${JSON.stringify(audioState)}`);
      }

      await page.screenshot({ path: '/tmp/fuwa-v91-sleep.png', fullPage: true });
    }

    if (errors.length) throw new Error(`${spec.name} page errors: ${errors.join(' | ')}`);
    await context.close();
  }

  await browser.close();
  console.log('responsive/audio interaction QA passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
