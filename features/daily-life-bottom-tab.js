// FUWA V115 — DAILY LIFE BOTTOM TAB
// Reprioritizes the bottom Letters shortcut to Daily Life Pages without deleting
// or changing the Letters feature. Letters remains available from the Fuwa drawer.

(() => {
  "use strict";

  let initialized = false;
  let redirecting = false;

  function getBottomLettersTab() {
    return document.querySelector('.bottom-nav .nav-item[data-nav="letters"]');
  }

  function getLifeTab() {
    return document.querySelector('.bottom-nav .nav-item[data-nav="life"]');
  }

  function relabelBottomTab() {
    const tab = getBottomLettersTab();
    if (!tab) return false;

    const icon = tab.querySelector('.nav-icon');
    const labels = tab.querySelectorAll('span');
    const label = labels.length ? labels[labels.length - 1] : null;

    if (icon && icon.textContent !== '☀') icon.textContent = '☀';
    if (label && label.textContent !== 'Daily Life') label.textContent = 'Daily Life';
    tab.setAttribute('aria-label', 'Open Daily Life Pages');
    tab.dataset.fuwaBottomShortcut = 'daily-life';
    return true;
  }

  function markDailyLifeShortcutActive() {
    const dailyTab = getBottomLettersTab();
    const lifeTab = getLifeTab();
    if (!dailyTab || !lifeTab) return;

    // The native Life navigation owns the actual view state. After it opens,
    // mirror the active indicator onto the shortcut the user actually tapped.
    lifeTab.classList.remove('active');
    dailyTab.classList.add('active');
  }

  function openDailyLifeFromShortcut() {
    if (redirecting) return;
    const lifeTab = getLifeTab();
    if (!lifeTab) return;

    redirecting = true;
    try {
      lifeTab.click();
      window.requestAnimationFrame(() => {
        markDailyLifeShortcutActive();
        const view = document.getElementById('lifeView');
        if (view && typeof view.scrollTo === 'function') view.scrollTo({ top: 0, behavior: 'auto' });
        else window.scrollTo?.({ top: 0, behavior: 'auto' });
      });
    } finally {
      window.setTimeout(() => { redirecting = false; }, 0);
    }
  }

  function handleBottomTabClick(event) {
    const tab = event.target?.closest?.('.bottom-nav .nav-item[data-nav="letters"]');
    if (!tab) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    openDailyLifeFromShortcut();
  }

  function init() {
    if (initialized) return;
    initialized = true;
    relabelBottomTab();

    // Capture runs before Fuwa's existing Letters click handler, but only for
    // the one bottom-nav shortcut. Drawer Letters buttons are deliberately left alone.
    document.addEventListener('click', handleBottomTabClick, true);

    // Keep the label correct if iOS restores/repaints the cached shell.
    const nav = document.querySelector('.bottom-nav');
    if (nav && typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => relabelBottomTab());
      observer.observe(nav, { childList: true, subtree: true, characterData: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.FuwaDailyLifeBottomTab = {
    relabel: relabelBottomTab,
    open: openDailyLifeFromShortcut
  };
})();
