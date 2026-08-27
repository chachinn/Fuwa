// FUWA V116 — DAILY LIFE BOTTOM TAB
// Convert the existing bottom Letters shortcut into Fuwa's native Daily Life route.
// Letters remains available from the Fuwa drawer and all Letters data is unchanged.

(() => {
  "use strict";

  function getBottomDailyLifeTab() {
    return (
      document.querySelector('.bottom-nav .nav-item[data-fuwa-bottom-shortcut="daily-life"]') ||
      document.querySelector('.bottom-nav .nav-item[data-nav="letters"]') ||
      document.querySelector('.bottom-nav .nav-item[data-nav="life"]')
    );
  }

  function patchBottomTab() {
    const tab = getBottomDailyLifeTab();
    if (!tab) return false;

    const icon = tab.querySelector('span');
    const label = tab.querySelector('small');

    // Use Fuwa's real route. app.js reads button.dataset.nav at tap time,
    // so this works whether app.js bound the button before or after this patch.
    if (tab.dataset.nav !== 'life') tab.dataset.nav = 'life';
    if (tab.dataset.fuwaBottomShortcut !== 'daily-life') {
      tab.dataset.fuwaBottomShortcut = 'daily-life';
    }
    if (icon && icon.textContent !== '✦') icon.textContent = '✦';
    if (label && label.textContent !== 'Daily Life') label.textContent = 'Daily Life';
    if (tab.getAttribute('aria-label') !== 'Open Daily Life Pages') {
      tab.setAttribute('aria-label', 'Open Daily Life Pages');
    }

    return true;
  }

  function init() {
    patchBottomTab();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.FuwaDailyLifeBottomTab = {
    patch: patchBottomTab,
    open() {
      const tab = getBottomDailyLifeTab();
      if (!tab) return false;
      patchBottomTab();
      tab.click();
      return true;
    }
  };
})();
