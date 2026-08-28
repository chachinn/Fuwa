// FUWA V117 — DAILY LIFE BOTTOM TAB
// Keep Daily Life as Fuwa's fourth primary tab and recover safely from stale
// v115 iPhone PWA click interception without touching Letters data or routes.

(() => {
  "use strict";

  let lastDirectOpenAt = 0;

  function getBottomDailyLifeTab() {
    return (
      document.querySelector('.bottom-nav .nav-item[data-fuwa-bottom-shortcut="daily-life"]') ||
      document.querySelector('.bottom-nav .nav-item[data-nav="letters"]') ||
      document.querySelector('.bottom-nav .nav-item[data-nav="life"]') ||
      document.querySelector('.bottom-nav .nav-item:nth-child(4)')
    );
  }

  function patchBottomTab() {
    const tab = getBottomDailyLifeTab();
    if (!tab) return null;

    const icon = tab.querySelector('span');
    const label = tab.querySelector('small');

    tab.dataset.nav = 'life';
    tab.dataset.fuwaBottomShortcut = 'daily-life';
    tab.setAttribute('aria-label', 'Open Daily Life Pages');
    tab.style.pointerEvents = 'auto';
    tab.style.touchAction = 'manipulation';

    if (icon && icon.textContent !== '✦') icon.textContent = '✦';
    if (label && label.textContent !== 'Daily Life') label.textContent = 'Daily Life';

    return tab;
  }

  function fallbackOpenLife() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('view', 'life');
      window.location.assign(url.toString());
    } catch (_) {
      window.location.href = './?view=life';
    }
  }

  function openLifeDirect() {
    const now = Date.now();
    if (now - lastDirectOpenAt < 350) return true;
    lastDirectOpenAt = now;

    patchBottomTab();

    // app.js is a classic script, so navigate() is normally available on window.
    // If a stale/partial PWA shell does not expose it, the query-string fallback
    // is already supported by Fuwa startup and opens Daily Life after reload.
    if (typeof window.navigate === 'function') {
      window.navigate('life');
      return true;
    }

    fallbackOpenLife();
    return true;
  }

  function bindRecoveryTap(tab) {
    if (!tab || tab.dataset.fuwaLifeTapGuard === '1') return;
    tab.dataset.fuwaLifeTapGuard = '1';

    // v115 only swallowed click events in document capture. iPhone touchend is
    // deliberately handled too, so an already-running stale v115 listener cannot
    // make this tab inert. No preventDefault/stopPropagation is used here.
    tab.addEventListener('touchend', openLifeDirect, { passive: true });
    tab.addEventListener('click', openLifeDirect);
  }

  function init() {
    const tab = patchBottomTab();
    bindRecoveryTap(tab);

    // Re-apply after iOS restores a cached shell or another feature repaints nav.
    const nav = document.querySelector('.bottom-nav');
    if (nav && typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => {
        const current = patchBottomTab();
        bindRecoveryTap(current);
      });
      observer.observe(nav, { childList: true, subtree: true, characterData: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.FuwaDailyLifeBottomTab = {
    patch: patchBottomTab,
    open: openLifeDirect
  };
})();
