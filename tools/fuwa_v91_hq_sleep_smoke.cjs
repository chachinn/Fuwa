const { chromium } = require(process.cwd() + '/node_modules/playwright');

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

    await page.goto('http://127.0.0.1:4173/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      ['fuwaTutorial', 'moodCheckinModal', 'fuwaReleaseNotesModal'].forEach(id => {
        document.getElementById(id)?.classList.add('hidden');
      });
      document.body.style.overflow = '';
      navigate('sleep');
    });
    await page.waitForTimeout(250);

    const layout = await page.evaluate(() => {
      const player = document.querySelector('#sleepPlayerCard');
      const soundscape = [...document.querySelectorAll('#sleepView .sleep-section')]
        .find(section => section.textContent.includes('Soundscape'));
      const timer = [...document.querySelectorAll('#sleepView .sleep-section')]
        .find(section => section.textContent.includes('Sleep timer'));
      const nav = document.querySelector('.bottom-nav')?.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        playerTop: player?.getBoundingClientRect().top,
        soundTop: soundscape?.getBoundingClientRect().top,
        timerTop: timer?.getBoundingClientRect().top,
        navBottom: nav ? window.innerHeight - nav.bottom : 999,
        sounds: document.querySelectorAll('[data-sleep-sound]').length,
        canMp3: document.createElement('audio').canPlayType('audio/mpeg')
      };
    });

    if (layout.overflow > 2) throw new Error(`${spec.name} overflow ${layout.overflow}`);
    if (!(layout.playerTop < layout.soundTop && layout.soundTop < layout.timerTop)) {
      throw new Error(`${spec.name} Sleep Corner order wrong ${JSON.stringify(layout)}`);
    }
    if (Math.abs(layout.navBottom) > 2) throw new Error(`${spec.name} nav not bottom attached ${layout.navBottom}`);
    if (layout.sounds !== 8) throw new Error(`${spec.name} expected 8 sounds`);
    if (!layout.canMp3) throw new Error(`${spec.name} reports no MP3 support`);

    if (spec.audio) {
      await page.locator('[data-sleep-sound="rain"]').click({ force: true });
      await page.locator('#sleepPlayPauseButton').click({ force: true });
      await page.waitForTimeout(1000);

      let audioState = await page.evaluate(() => ({
        playing: sleepIsPlaying,
        paused: sleepAudioElement?.paused,
        src: sleepAudioElement?.currentSrc || '',
        label: document.querySelector('#sleepNowPlaying')?.textContent,
        button: document.querySelector('#sleepPlayPauseText')?.textContent
      }));
      if (!audioState.playing || audioState.paused || !audioState.src.includes('gentle-rain.mp3') || audioState.label !== 'Gentle Rain' || audioState.button !== 'Pause') {
        throw new Error(`play failed ${JSON.stringify(audioState)}`);
      }

      await page.locator('[data-sleep-sound="waves"]').click({ force: true });
      await page.locator('[data-sleep-sound="forest"]').click({ force: true });
      await page.locator('[data-sleep-sound="cafe"]').click({ force: true });
      await page.waitForTimeout(1000);

      audioState = await page.evaluate(() => ({
        sound: state.sleepSound,
        src: sleepAudioElement?.currentSrc || '',
        label: document.querySelector('#sleepNowPlaying')?.textContent,
        playing: sleepIsPlaying
      }));
      if (audioState.sound !== 'cafe' || !audioState.src.includes('cozy-room.mp3') || audioState.label !== 'Cozy Room' || !audioState.playing) {
        throw new Error(`rapid switch failed ${JSON.stringify(audioState)}`);
      }

      await page.locator('#sleepPlayPauseButton').click({ force: true });
      await page.waitForTimeout(100);
      audioState = await page.evaluate(() => ({ playing: sleepIsPlaying, paused: sleepIsPaused, audioPaused: sleepAudioElement?.paused }));
      if (audioState.playing || !audioState.paused || !audioState.audioPaused) throw new Error(`pause failed ${JSON.stringify(audioState)}`);

      await page.locator('#sleepPlayPauseButton').click({ force: true });
      await page.waitForTimeout(350);
      await page.locator('#sleepStopButton').click({ force: true });
      audioState = await page.evaluate(() => ({ playing: sleepIsPlaying, paused: sleepIsPaused, audioPaused: sleepAudioElement?.paused, remaining: sleepRemainingMs }));
      if (audioState.playing || audioState.paused || !audioState.audioPaused || audioState.remaining !== 0) throw new Error(`stop failed ${JSON.stringify(audioState)}`);

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
