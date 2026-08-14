const { chromium } = require('playwright');

const assert = (value, message) => {
  if (!value) throw new Error(message);
};

const url = 'http://127.0.0.1:4321/index.html';
const STORES = ['entries','tinyJoys','letters','moodCheckins','threads','bookmarks','nightlyReflections','thenNow','comfortItems','unsentLetters','thoughtBubbles','dreams','dailyCheckins','lifeCollections','habitDefinitions','moments','randomThoughts'];

async function addBaseInit(page, { seenMeTutorial = false } = {}) {
  await page.addInitScript(({ seenMeTutorial }) => {
    localStorage.setItem('fuwaLocalModeV1','1');
    localStorage.setItem('fuwaTutorialSeenV1','1');
    if (seenMeTutorial) localStorage.setItem('fuwaFeatureTutorial:v1:me','1');
    window.alert = () => {};
    window.confirm = () => true;
  }, { seenMeTutorial });
}

async function interactionQa(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await addBaseInit(page, { seenMeTutorial: true });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(180);

  await page.locator('.bottom-nav [data-nav="me"]').click();
  await page.waitForTimeout(50);
  await page.locator('#openSettingsButton').click();
  await page.waitForTimeout(450); // long enough for the former automatic mood race

  const moodHidden = await page.locator('#moodCheckinModal').evaluate(el => el.classList.contains('hidden'));
  assert(moodHidden, 'automatic Mood Check-In opened over Settings');

  await page.evaluate(() => document.getElementById('cloudBackupCard')?.classList.remove('local-hidden'));
  const outer = page.locator('#cloudRestoreButton');
  assert(await outer.isVisible(), 'Restore from Fuwa Cloud is not visible');
  assert(await outer.isEnabled(), 'Restore from Fuwa Cloud is disabled');
  await outer.click();
  await page.waitForTimeout(100);

  const modal = page.locator('#cloudRestoreModal');
  assert(!(await modal.evaluate(el => el.classList.contains('hidden'))), 'Cloud Restore modal did not open');
  assert(await page.evaluate(() => document.body.classList.contains('cloud-restore-open')), 'cloud-restore-open mode missing');

  // Deliberately resurrect every known competing overlay after Restore is open.
  await page.evaluate(() => {
    document.getElementById('moodCheckinModal')?.classList.remove('hidden');
    document.getElementById('fuwaReleaseNotesModal')?.classList.remove('hidden');
    const tutorial = document.getElementById('featureTutorial');
    if (tutorial) {
      tutorial.hidden = false;
      tutorial.setAttribute('aria-hidden', 'false');
    }
  });

  const layers = await page.evaluate(() => ({
    settings: getComputedStyle(document.getElementById('settingsSheet')).pointerEvents,
    mood: getComputedStyle(document.getElementById('moodCheckinModal')).pointerEvents,
    release: getComputedStyle(document.getElementById('fuwaReleaseNotesModal')).pointerEvents,
    tutorial: getComputedStyle(document.getElementById('featureTutorial')).pointerEvents,
    restore: getComputedStyle(document.getElementById('cloudRestoreModal')).pointerEvents,
    z: Number(getComputedStyle(document.getElementById('cloudRestoreModal')).zIndex)
  }));
  assert(layers.settings === 'none', `Settings still intercepts: ${JSON.stringify(layers)}`);
  assert(layers.mood === 'none', `Mood modal still intercepts: ${JSON.stringify(layers)}`);
  assert(layers.release === 'none', `Release modal still intercepts: ${JSON.stringify(layers)}`);
  assert(layers.tutorial === 'none', `Feature tutorial still intercepts: ${JSON.stringify(layers)}`);
  assert(layers.restore === 'auto', `Restore pointer events wrong: ${JSON.stringify(layers)}`);
  assert(layers.z > 1000000, `Restore z-index too low: ${JSON.stringify(layers)}`);

  const confirm = page.locator('#cloudRestoreConfirmButton');
  assert(await confirm.isVisible(), 'Restore safely is not visible');
  assert(await confirm.isEnabled(), 'Restore safely starts disabled');
  await confirm.click();
  await page.waitForTimeout(130);
  let state = await confirm.evaluate(el => ({ disabled: el.disabled, text: el.textContent, busy: el.getAttribute('aria-busy') }));
  assert(!state.disabled && state.text.includes('Restore safely') && state.busy === null, `Restore safely did not recover: ${JSON.stringify(state)}`);
  await confirm.click();
  await page.waitForTimeout(130);
  state = await confirm.evaluate(el => ({ disabled: el.disabled, text: el.textContent, busy: el.getAttribute('aria-busy') }));
  assert(!state.disabled, 'second Restore safely retry remained disabled');

  await page.evaluate(() => {
    document.getElementById('moodCheckinModal')?.classList.add('hidden');
    document.getElementById('fuwaReleaseNotesModal')?.classList.add('hidden');
    const tutorial = document.getElementById('featureTutorial');
    if (tutorial) {
      tutorial.hidden = true;
      tutorial.setAttribute('aria-hidden', 'true');
    }
  });
  await page.locator('#cloudRestoreCancelButton').click();
  await page.waitForTimeout(50);
  assert(await modal.evaluate(el => el.classList.contains('hidden')), 'Cancel did not close Cloud Restore');
  assert(!await page.evaluate(() => document.body.classList.contains('cloud-restore-open')), 'cloud-restore-open was not released');
  assert(!errors.length, `interaction runtime errors: ${errors.join(' | ')}`);
  await context.close();
  console.log('restore interaction QA passed');
}

async function dataSafetyQa(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await addBaseInit(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.fuwaCreateCloudBackupPayload === 'function' && typeof window.fuwaApplyCloudRestorePayload === 'function' && typeof window.fuwaRestoreSafetyBackup === 'function');
  const result = await page.evaluate(async stores => {
    const base = await window.fuwaCreateCloudBackupPayload();
    stores.forEach(key => base.data[key] = []);
    base.backupFormat = 'fuwa-cloud-v1';
    base.data.moments = [{ id: 'v96-m', text: 'moment' }];
    base.data.randomThoughts = [{ id: 'v96-r', text: 'thought' }];
    base.recordCount = 2;
    const restored = await window.fuwaApplyCloudRestorePayload(base);
    const after = await window.fuwaCreateCloudBackupPayload();
    const safety = await window.fuwaCreateRestoreSafetyBackup();
    const replacement = await window.fuwaCreateCloudBackupPayload();
    stores.forEach(key => replacement.data[key] = []);
    replacement.data.moments = [{ id: 'v96-x', text: 'replacement' }];
    replacement.recordCount = 1;
    await window.fuwaApplyCloudRestorePayload(replacement);
    const rollback = await window.fuwaRestoreSafetyBackup(safety);
    const rolled = await window.fuwaCreateCloudBackupPayload();
    return {
      restored,
      count: after.recordCount,
      moments: after.data.moments.map(item => item.id),
      thoughts: after.data.randomThoughts.map(item => item.id),
      rollback,
      rolledMoments: rolled.data.moments.map(item => item.id),
      rolledThoughts: rolled.data.randomThoughts.map(item => item.id)
    };
  }, STORES);
  assert(result.restored.ok && result.count === 2, 'cloud restore record-count regression');
  assert(result.moments.includes('v96-m') && result.thoughts.includes('v96-r'), 'cloud-backed stores missing after restore');
  assert(result.rollback.ok && result.rolledMoments.includes('v96-m') && !result.rolledMoments.includes('v96-x') && result.rolledThoughts.includes('v96-r'), 'safety rollback regression');
  assert(!errors.length, `data-safety runtime errors: ${errors.join(' | ')}`);
  await context.close();
  console.log('restore data-safety QA passed');
}

async function responsiveQa(browser) {
  const sizes = [[320,700],[375,812],[390,844],[430,932],[768,1024],[1024,768],[820,1180],[1180,820],[834,1194],[1194,834],[1024,1366],[1366,1024]];
  for (const [width, height] of sizes) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await addBaseInit(page);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(120);
    const geometry = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth,
      nodes: document.getElementsByTagName('*').length,
      navPosition: getComputedStyle(document.querySelector('.bottom-nav')).position,
      navBottom: document.querySelector('.bottom-nav').getBoundingClientRect().bottom,
      innerHeight
    }));
    assert(!errors.length, `${width}x${height} runtime errors: ${errors.join(' | ')}`);
    assert(geometry.scrollWidth <= geometry.innerWidth + 2, `${width}x${height} horizontal overflow`);
    assert(geometry.nodes < 9000, `${width}x${height} runaway DOM`);
    assert(geometry.navPosition === 'fixed' && Math.abs(geometry.navBottom - geometry.innerHeight) < 4, `${width}x${height} bottom-nav regression`);
    await context.close();
  }
  console.log('12-size responsive QA passed');
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await interactionQa(browser);
    await dataSafetyQa(browser);
    await responsiveQa(browser);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
