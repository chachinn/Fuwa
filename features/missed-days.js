(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const DB_NAME = 'FuwaDB';
  const SKIP_KIND = 'catch-up-skip';
  const SKIP_PREFIX = 'catchup_skip_';
  let cursor = null;
  let mounted = false;
  let rendering = false;
  let skipCacheLoaded = false;
  let skipCache = [];
  let attentionRefreshTimer = null;

  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  function parseLocalDate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  }

  function localIso(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function monthStartFromIso(iso) {
    const date = parseLocalDate(iso) || new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0);
  }

  function monthLabel(date) {
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(date);
  }

  function dateLabel(iso) {
    const date = parseLocalDate(iso);
    return date ? new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(date) : iso;
  }

  function api() {
    return window.fuwaMissedApi || null;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open FuwaDB.'));
    });
  }

  async function readSkipRecords() {
    try {
      const db = await openDb();
      const rows = await new Promise((resolve, reject) => {
        const request = db.transaction('lifeCollections', 'readonly').objectStore('lifeCollections').getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error || new Error('Could not read Catch Up choices.'));
      });
      db.close();
      return rows.filter(item => item && item.kind === SKIP_KIND && /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || '')));
    } catch (error) {
      console.warn('Fuwa could not read intentional Catch Up skips.', error);
      return [];
    }
  }

  async function ensureSkipCache(force = false) {
    if (!skipCacheLoaded || force) {
      skipCache = await readSkipRecords();
      skipCacheLoaded = true;
    }
    return skipCache;
  }

  async function saveSkipChoice(date, scope, skipped) {
    const bridge = api();
    if (!bridge || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || date >= bridge.today()) {
      throw new Error('catch-up-skip-invalid-date');
    }
    if (!['mood', 'life'].includes(scope)) throw new Error('catch-up-skip-invalid-scope');

    const db = await openDb();
    const id = `${SKIP_PREFIX}${date}`;
    const existing = skipCache.find(item => item.id === id) || null;
    const now = Date.now();
    const record = {
      id,
      kind: SKIP_KIND,
      category: SKIP_KIND,
      date,
      skipMood: !!existing?.skipMood,
      skipLife: !!existing?.skipLife,
      title: 'Catch Up choice',
      note: '',
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    if (scope === 'mood') record.skipMood = !!skipped;
    if (scope === 'life') record.skipLife = !!skipped;

    await new Promise((resolve, reject) => {
      const tx = db.transaction('lifeCollections', 'readwrite');
      const store = tx.objectStore('lifeCollections');
      if (!record.skipMood && !record.skipLife) store.delete(id);
      else store.put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Could not save Catch Up choice.'));
      tx.onabort = () => reject(tx.error || new Error('Catch Up choice was not saved.'));
    });
    db.close();

    if (!record.skipMood && !record.skipLife) skipCache = skipCache.filter(item => item.id !== id);
    else skipCache = [...skipCache.filter(item => item.id !== id), record];
    skipCacheLoaded = true;

    window.dispatchEvent(new CustomEvent('fuwa-local-data-changed', {
      detail: { action: 'catch-up-skip', storeName: 'lifeCollections', recordId: id }
    }));
    return record;
  }

  function skipsByDate(records) {
    return new Map((records || []).map(item => [item.date, item]));
  }

  function setStandardPanelsVisible(visible) {
    ['lifeTodayPanel', 'lifeHistoryPanel', 'lifeDashboardPanel', 'lifeMomentsPanel', 'lifeCollectionsPanel'].forEach(id => {
      $(id)?.classList.toggle('active', visible && $(id)?.classList.contains('active'));
      if (!visible) $(id)?.classList.remove('active');
    });
  }

  function closeCatchUpPanel() {
    $('lifeMissedPanel')?.classList.remove('active');
    $('lifeMissedTab')?.classList.remove('active');
  }

  function createHomeCard() {
    if ($('fuwaCatchUpHomeCard')) return;
    const hero = document.querySelector('#homeView .hero-card');
    if (!hero) return;
    const section = document.createElement('section');
    section.id = 'fuwaCatchUpHomeCard';
    section.className = 'section-block fuwa-catchup-home hidden';
    section.innerHTML = `
      <button class="fuwa-catchup-home-card" id="fuwaCatchUpHomeButton" type="button">
        <span class="fuwa-catchup-home-cloud" aria-hidden="true">☁️</span>
        <span class="fuwa-catchup-home-copy">
          <small>Catch up when you want</small>
          <strong>A few days are still open</strong>
          <span id="fuwaCatchUpHomeSummary">Something is waiting gently.</span>
        </span>
        <b aria-hidden="true">›</b>
      </button>`;
    hero.insertAdjacentElement('afterend', section);
    $('fuwaCatchUpHomeButton')?.addEventListener('click', () => {
      window.navigate?.('life');
      window.setTimeout(openCatchUp, 30);
    });
  }

  function createDrawerShortcut() {
    if ($('fuwaCatchUpDrawerButton')) return;
    const startList = document.querySelector('.drawer-start-here .drawer-menu-list');
    const lifeButton = startList?.querySelector('[data-nav="life"]');
    if (!startList || !lifeButton) return;
    const button = document.createElement('button');
    button.className = 'drawer-menu-item fuwa-catchup-drawer-item';
    button.id = 'fuwaCatchUpDrawerButton';
    button.type = 'button';
    button.innerHTML = `
      <span class="drawer-item-icon fuwa-catchup-drawer-icon" aria-hidden="true">↶</span>
      <span><strong>Catch Up</strong><small>Fill a missed Mood Check-In or Daily Life page.</small></span>
      <span class="fuwa-catchup-drawer-end"><em id="fuwaCatchUpDrawerBadge" class="hidden">0</em><b>›</b></span>`;
    lifeButton.insertAdjacentElement('afterend', button);
    button.addEventListener('click', () => {
      $('drawerCloseButton')?.click();
      window.navigate?.('life');
      window.setTimeout(openCatchUp, 30);
    });
  }

  function ensureShell() {
    if (mounted) return true;
    const lifeView = $('lifeView');
    const tabBar = lifeView?.querySelector('.life-tab-bar');
    const dashboard = $('lifeDashboardPanel');
    if (!lifeView || !tabBar || !dashboard) return false;

    const tab = document.createElement('button');
    tab.type = 'button';
    tab.id = 'lifeMissedTab';
    tab.className = 'life-missed-tab';
    tab.innerHTML = '<span>Catch Up</span><b id="lifeMissedBadge" class="hidden">0</b>';
    const historyTab = tabBar.querySelector('[data-life-tab="history"]');
    if (historyTab) historyTab.insertAdjacentElement('beforebegin', tab);
    else tabBar.appendChild(tab);

    const panel = document.createElement('section');
    panel.className = 'life-panel life-missed-panel';
    panel.id = 'lifeMissedPanel';
    panel.innerHTML = `
      <div class="life-missed-head">
        <div>
          <p class="eyebrow">Catch up gently</p>
          <h3>Catch Up</h3>
          <p>Go back to a past day and fill only what is missing. If you are okay leaving one blank, choose Skip this one and Fuwa will stop keeping it in Catch Up.</p>
        </div>
        <span class="life-missed-cloud" aria-hidden="true">☁️</span>
      </div>
      <div class="life-missed-monthbar">
        <button type="button" id="lifeMissedPrevMonth" aria-label="Previous month">‹</button>
        <strong id="lifeMissedMonthLabel"></strong>
        <button type="button" id="lifeMissedNextMonth" aria-label="Next month">›</button>
      </div>
      <div class="life-missed-summary" id="lifeMissedSummary"></div>
      <div class="life-missed-list" id="lifeMissedList"></div>
      <details class="life-catchup-skipped hidden" id="lifeCatchUpSkipped">
        <summary><span>Skipped</span><b id="lifeCatchUpSkippedCount">0</b></summary>
        <div id="lifeCatchUpSkippedList"></div>
      </details>
      <p class="life-missed-note">Only past dates appear here. Today still belongs in your normal Mood Jar and Daily Life journal.</p>
    `;
    dashboard.insertAdjacentElement('afterend', panel);

    createHomeCard();
    createDrawerShortcut();

    tab.addEventListener('click', openCatchUp);
    $('lifeMissedPrevMonth')?.addEventListener('click', () => {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1, 12, 0, 0, 0);
      render();
    });
    $('lifeMissedNextMonth')?.addEventListener('click', () => {
      const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1, 12, 0, 0, 0);
      const current = monthStartFromIso(api()?.today?.());
      if (next <= current) cursor = next;
      render();
    });

    tabBar.querySelectorAll('[data-life-tab]').forEach(button => {
      button.addEventListener('click', closeCatchUpPanel);
    });

    window.addEventListener('fuwa-local-data-changed', event => {
      if (event?.detail?.action !== 'catch-up-skip') skipCacheLoaded = false;
      scheduleAttentionRefresh();
      if ($('lifeMissedPanel')?.classList.contains('active')) render();
    });
    window.addEventListener('fuwa-auth-ready', () => {
      skipCacheLoaded = false;
      scheduleAttentionRefresh();
    });

    mounted = true;
    scheduleAttentionRefresh();
    return true;
  }

  function monthRows(month, snapshot, todayIso, skips) {
    const moodDates = new Set((snapshot.moodCheckins || []).map(item => item.date));
    const lifeDates = new Set((snapshot.dailyCheckins || []).map(item => item.date));
    const skipMap = skipsByDate(skips);
    const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const pending = [];
    const intentional = [];

    for (let day = lastDay; day >= 1; day -= 1) {
      const date = localIso(new Date(month.getFullYear(), month.getMonth(), day, 12, 0, 0, 0));
      if (date >= todayIso) continue;
      const moodSaved = moodDates.has(date);
      const lifeSaved = lifeDates.has(date);
      const skip = skipMap.get(date) || {};
      const moodSkipped = !!skip.skipMood && !moodSaved;
      const lifeSkipped = !!skip.skipLife && !lifeSaved;
      const moodMissing = !moodSaved && !moodSkipped;
      const lifeMissing = !lifeSaved && !lifeSkipped;

      if (moodMissing || lifeMissing) pending.push({ date, moodSaved, lifeSaved, moodSkipped, lifeSkipped, moodMissing, lifeMissing });
      if (moodSkipped || lifeSkipped) intentional.push({ date, moodSkipped, lifeSkipped, moodSaved, lifeSaved });
    }
    return { pending, intentional };
  }

  async function currentMonthState() {
    const bridge = api();
    if (!bridge) return { pending: [], intentional: [] };
    const skips = await ensureSkipCache();
    return monthRows(monthStartFromIso(bridge.today()), bridge.snapshot(), bridge.today(), skips);
  }

  async function refreshAttention() {
    if (!ensureShell()) return;
    const { pending } = await currentMonthState();
    const pendingDates = pending.length;
    const moodCount = pending.filter(row => row.moodMissing).length;
    const lifeCount = pending.filter(row => row.lifeMissing).length;

    for (const badge of [$('lifeMissedBadge'), $('fuwaCatchUpDrawerBadge')]) {
      if (!badge) continue;
      badge.textContent = String(pendingDates);
      badge.classList.toggle('hidden', !pendingDates);
    }

    const home = $('fuwaCatchUpHomeCard');
    home?.classList.toggle('hidden', !pendingDates);
    if ($('fuwaCatchUpHomeSummary')) {
      $('fuwaCatchUpHomeSummary').textContent = `${moodCount} mood check-in${moodCount === 1 ? '' : 's'} · ${lifeCount} Daily Life page${lifeCount === 1 ? '' : 's'}`;
    }
  }

  function scheduleAttentionRefresh() {
    if (attentionRefreshTimer) window.clearTimeout(attentionRefreshTimer);
    attentionRefreshTimer = window.setTimeout(() => {
      attentionRefreshTimer = null;
      refreshAttention().catch(error => console.warn('Could not refresh Catch Up attention.', error));
    }, 40);
  }

  function moodPicker(date, moods) {
    return `
      <div class="life-missed-moods hidden" data-missed-moods="${escapeHtml(date)}">
        <span>How did that day feel?</span>
        <div>${moods.map(mood => `
          <button type="button" data-missed-mood-date="${escapeHtml(date)}" data-missed-mood="${escapeHtml(mood.id)}" aria-label="${escapeHtml(mood.label)}">
            <b aria-hidden="true">${escapeHtml(mood.emoji)}</b><small>${escapeHtml(mood.label)}</small>
          </button>
        `).join('')}</div>
      </div>
    `;
  }

  function intentionalBlankChoice(date, scope, label) {
    return `<label class="life-catchup-intentional"><input type="checkbox" data-catchup-skip="${escapeHtml(date)}" data-catchup-scope="${scope}" aria-label="Skip ${escapeHtml(label)}"><span><b>Skip this one</b><small>${escapeHtml(label)}</small></span></label>`;
  }

  function renderIntentional(intentional) {
    const details = $('lifeCatchUpSkipped');
    const list = $('lifeCatchUpSkippedList');
    const count = $('lifeCatchUpSkippedCount');
    if (!details || !list || !count) return;
    details.classList.toggle('hidden', !intentional.length);
    count.textContent = String(intentional.length);
    list.innerHTML = intentional.map(row => `
      <article class="life-catchup-skipped-row">
        <div><strong>${escapeHtml(dateLabel(row.date))}</strong><small>${row.moodSkipped ? 'Mood Check-In' : ''}${row.moodSkipped && row.lifeSkipped ? ' · ' : ''}${row.lifeSkipped ? 'Daily Life' : ''}</small></div>
        <div>
          ${row.moodSkipped ? `<button type="button" data-catchup-reopen="${escapeHtml(row.date)}" data-catchup-reopen-scope="mood">Add mood after all</button>` : ''}
          ${row.lifeSkipped ? `<button type="button" data-catchup-reopen="${escapeHtml(row.date)}" data-catchup-reopen-scope="life">Add Daily Life after all</button>` : ''}
        </div>
      </article>`).join('');

    list.querySelectorAll('[data-catchup-reopen]').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await saveSkipChoice(button.dataset.catchupReopen, button.dataset.catchupReopenScope, false);
        api()?.toast?.('That day is back in Catch Up ♡');
        await render();
        await refreshAttention();
      } catch (error) {
        console.error('Could not reopen Catch Up item.', error);
        api()?.toast?.("Fuwa couldn't reopen that item. Please try again.");
        button.disabled = false;
      }
    }));
  }

  async function render() {
    if (rendering || !ensureShell()) return;
    const bridge = api();
    if (!bridge) return;
    rendering = true;
    try {
      const today = bridge.today();
      const currentMonth = monthStartFromIso(today);
      if (!cursor) cursor = currentMonth;
      if (cursor > currentMonth) cursor = currentMonth;

      const snapshot = bridge.snapshot();
      const skips = await ensureSkipCache();
      const { pending: rows, intentional } = monthRows(cursor, snapshot, today, skips);
      const moods = bridge.moods();
      const label = $('lifeMissedMonthLabel');
      const list = $('lifeMissedList');
      const summary = $('lifeMissedSummary');
      const next = $('lifeMissedNextMonth');
      if (label) label.textContent = monthLabel(cursor);
      if (next) next.disabled = cursor.getFullYear() === currentMonth.getFullYear() && cursor.getMonth() === currentMonth.getMonth();
      if (summary) {
        const moodCount = rows.filter(row => row.moodMissing).length;
        const lifeCount = rows.filter(row => row.lifeMissing).length;
        summary.innerHTML = `<span><strong>${rows.length}</strong> date${rows.length === 1 ? '' : 's'} waiting</span><span>${moodCount} mood${moodCount === 1 ? '' : 's'} · ${lifeCount} Daily Life page${lifeCount === 1 ? '' : 's'}</span>`;
      }
      if (!list) return;

      if (!rows.length) {
        list.innerHTML = '<div class="life-missed-empty"><span>♡</span><strong>Nothing waiting here.</strong><p>This month is already tucked away, including anything you skipped.</p></div>';
      } else {
        list.innerHTML = rows.map(row => `
          <article class="life-missed-card" data-missed-date="${escapeHtml(row.date)}">
            <div class="life-missed-date"><small>${escapeHtml(row.date.slice(0, 7))}</small><strong>${escapeHtml(dateLabel(row.date))}</strong></div>
            <div class="life-missed-statuses">
              <div class="${row.moodSaved ? 'saved' : row.moodSkipped ? 'skipped' : 'missing'}"><span>Mood Check-In</span><b>${row.moodSaved ? 'Saved ✓' : row.moodSkipped ? 'Skipped' : 'Missing'}</b></div>
              <div class="${row.lifeSaved ? 'saved' : row.lifeSkipped ? 'skipped' : 'missing'}"><span>Daily Life</span><b>${row.lifeSaved ? 'Saved ✓' : row.lifeSkipped ? 'Skipped' : 'Missing'}</b></div>
            </div>
            <div class="life-missed-actions">
              ${row.moodMissing ? `<button type="button" data-missed-open-moods="${escapeHtml(row.date)}">Add mood</button>` : ''}
              ${row.lifeMissing ? `<button type="button" class="primary" data-missed-open-life="${escapeHtml(row.date)}">Fill Daily Life</button>` : ''}
            </div>
            <div class="life-catchup-intentional-list">
              ${row.moodMissing ? intentionalBlankChoice(row.date, 'mood', 'Mood Check-In') : ''}
              ${row.lifeMissing ? intentionalBlankChoice(row.date, 'life', 'Daily Life') : ''}
            </div>
            ${row.moodMissing ? moodPicker(row.date, moods) : ''}
          </article>`).join('');

        list.querySelectorAll('[data-missed-open-moods]').forEach(button => button.addEventListener('click', () => {
          const date = button.dataset.missedOpenMoods;
          const picker = list.querySelector(`[data-missed-moods="${CSS.escape(date)}"]`);
          picker?.classList.toggle('hidden');
        }));

        list.querySelectorAll('[data-missed-mood-date]').forEach(button => button.addEventListener('click', async () => {
          if (button.disabled) return;
          const card = button.closest('.life-missed-card');
          card?.querySelectorAll('[data-missed-mood-date]').forEach(item => { item.disabled = true; });
          try {
            const result = await bridge.saveMood(button.dataset.missedMoodDate, button.dataset.missedMood);
            if (!result?.saved && result?.reason === 'exists') bridge.toast('That day already has a Mood Check-In.');
            else bridge.toast('That mood is tucked into your jar ☁️');
            await render();
            await refreshAttention();
          } catch (error) {
            console.error('Could not save Catch Up mood.', error);
            bridge.toast("Fuwa couldn't save that mood. Please try again.");
            card?.querySelectorAll('[data-missed-mood-date]').forEach(item => { item.disabled = false; });
          }
        }));

        list.querySelectorAll('[data-missed-open-life]').forEach(button => button.addEventListener('click', () => {
          const result = bridge.openDailyLifeDate(button.dataset.missedOpenLife);
          if (!result?.opened && result?.reason === 'exists') {
            bridge.toast('That day already has a Daily Life journal.');
            render();
          }
        }));

        list.querySelectorAll('[data-catchup-skip]').forEach(input => input.addEventListener('change', async () => {
          input.disabled = true;
          try {
            await saveSkipChoice(input.dataset.catchupSkip, input.dataset.catchupScope, input.checked);
            bridge.toast('Skipped — you can add it later anytime ♡');
            await render();
            await refreshAttention();
          } catch (error) {
            console.error('Could not save intentional blank choice.', error);
            bridge.toast("Fuwa couldn't save that choice. Please try again.");
            input.checked = !input.checked;
            input.disabled = false;
          }
        }));
      }

      renderIntentional(intentional);
    } finally {
      rendering = false;
    }
  }

  function openCatchUp() {
    if (!ensureShell()) return;
    const bridge = api();
    if (!bridge) return;
    cursor = monthStartFromIso(bridge.today());
    document.querySelectorAll('#lifeView [data-life-tab]').forEach(button => button.classList.remove('active'));
    setStandardPanelsVisible(false);
    $('lifeMissedTab')?.classList.add('active');
    $('lifeMissedPanel')?.classList.add('active');
    render();
    $('lifeMissedPanel')?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }

  window.fuwaMissedOpen = openCatchUp;
  window.fuwaCatchUpOpen = openCatchUp;
  window.fuwaMissedRender = render;
  window.fuwaCatchUpRefresh = refreshAttention;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureShell, { once: true });
  else ensureShell();
})();
