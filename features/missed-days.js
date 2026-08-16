(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  let cursor = null;
  let mounted = false;
  let rendering = false;

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

  function setStandardPanelsVisible(visible) {
    ['lifeTodayPanel', 'lifeHistoryPanel', 'lifeDashboardPanel', 'lifeMomentsPanel', 'lifeCollectionsPanel'].forEach(id => {
      $(id)?.classList.toggle('active', visible && $(id)?.classList.contains('active'));
      if (!visible) $(id)?.classList.remove('active');
    });
  }

  function closeMissedPanel() {
    $('lifeMissedPanel')?.classList.remove('active');
    $('lifeMissedTab')?.classList.remove('active');
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
    tab.innerHTML = '<span>Missed</span><b id="lifeMissedBadge" class="hidden">0</b>';
    tabBar.appendChild(tab);

    const panel = document.createElement('section');
    panel.className = 'life-panel life-missed-panel';
    panel.id = 'lifeMissedPanel';
    panel.innerHTML = `
      <div class="life-missed-head">
        <div>
          <p class="eyebrow">Catch up gently</p>
          <h3>Missed days</h3>
          <p>Go back to a past day and fill only what is missing. Fuwa will not replace a saved check-in from here.</p>
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
      <p class="life-missed-note">Only past dates appear here. Today still belongs in your normal Mood Jar and Daily Life journal.</p>
    `;
    dashboard.insertAdjacentElement('afterend', panel);

    tab.addEventListener('click', openMissed);
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
      button.addEventListener('click', closeMissedPanel);
    });

    window.addEventListener('fuwa-local-data-changed', () => {
      updateBadge();
      if ($('lifeMissedPanel')?.classList.contains('active')) render();
    });
    window.addEventListener('fuwa-auth-ready', updateBadge);

    mounted = true;
    updateBadge();
    return true;
  }

  function currentMonthMissingCount() {
    const bridge = api();
    if (!bridge) return 0;
    const snapshot = bridge.snapshot();
    const today = bridge.today();
    const month = monthStartFromIso(today);
    return missingDaysForMonth(month, snapshot, today).length;
  }

  function updateBadge() {
    if (!ensureShell()) return;
    const count = currentMonthMissingCount();
    const badge = $('lifeMissedBadge');
    if (!badge) return;
    badge.textContent = String(count);
    badge.classList.toggle('hidden', !count);
  }

  function missingDaysForMonth(month, snapshot, todayIso) {
    const moodDates = new Set((snapshot.moodCheckins || []).map(item => item.date));
    const lifeDates = new Set((snapshot.dailyCheckins || []).map(item => item.date));
    const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const rows = [];
    for (let day = lastDay; day >= 1; day -= 1) {
      const date = localIso(new Date(month.getFullYear(), month.getMonth(), day, 12, 0, 0, 0));
      if (date >= todayIso) continue;
      const moodSaved = moodDates.has(date);
      const lifeSaved = lifeDates.has(date);
      if (moodSaved && lifeSaved) continue;
      rows.push({ date, moodSaved, lifeSaved });
    }
    return rows;
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
      const rows = missingDaysForMonth(cursor, snapshot, today);
      const moods = bridge.moods();
      const label = $('lifeMissedMonthLabel');
      const list = $('lifeMissedList');
      const summary = $('lifeMissedSummary');
      const next = $('lifeMissedNextMonth');
      if (label) label.textContent = monthLabel(cursor);
      if (next) next.disabled = cursor.getFullYear() === currentMonth.getFullYear() && cursor.getMonth() === currentMonth.getMonth();
      if (summary) {
        const moodCount = rows.filter(row => !row.moodSaved).length;
        const lifeCount = rows.filter(row => !row.lifeSaved).length;
        summary.innerHTML = `<span><strong>${rows.length}</strong> date${rows.length === 1 ? '' : 's'} need something</span><span>${moodCount} mood${moodCount === 1 ? '' : 's'} · ${lifeCount} Daily Life journal${lifeCount === 1 ? '' : 's'}</span>`;
      }
      if (!list) return;

      if (!rows.length) {
        list.innerHTML = '<div class="life-missed-empty"><span>♡</span><strong>Nothing missing here.</strong><p>This month is already tucked away.</p></div>';
        return;
      }

      list.innerHTML = rows.map(row => `
        <article class="life-missed-card" data-missed-date="${escapeHtml(row.date)}">
          <div class="life-missed-date">
            <small>${escapeHtml(row.date.slice(0, 7))}</small>
            <strong>${escapeHtml(dateLabel(row.date))}</strong>
          </div>
          <div class="life-missed-statuses">
            <div class="${row.moodSaved ? 'saved' : 'missing'}"><span>Mood Check-In</span><b>${row.moodSaved ? 'Saved ✓' : 'Missing'}</b></div>
            <div class="${row.lifeSaved ? 'saved' : 'missing'}"><span>Daily Life</span><b>${row.lifeSaved ? 'Saved ✓' : 'Missing'}</b></div>
          </div>
          <div class="life-missed-actions">
            ${row.moodSaved ? '' : `<button type="button" data-missed-open-moods="${escapeHtml(row.date)}">Add mood</button>`}
            ${row.lifeSaved ? '' : `<button type="button" class="primary" data-missed-open-life="${escapeHtml(row.date)}">Fill Daily Life</button>`}
          </div>
          ${row.moodSaved ? '' : moodPicker(row.date, moods)}
        </article>
      `).join('');

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
          else bridge.toast('That missed mood is tucked into your jar ☁️');
          await render();
          updateBadge();
        } catch (error) {
          console.error('Could not save missed mood.', error);
          bridge.toast("Fuwa couldn't save that missed mood. Please try again.");
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
    } finally {
      rendering = false;
    }
  }

  function openMissed() {
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

  window.fuwaMissedOpen = openMissed;
  window.fuwaMissedRender = render;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureShell, { once: true });
  else ensureShell();
})();
