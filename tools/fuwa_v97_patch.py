from pathlib import Path
import re


def once(text, old, new, label):
    c=text.count(old)
    if c!=1: raise SystemExit(f"{label}: expected 1, found {c}")
    return text.replace(old,new,1)

def subonce(text, pattern, repl, label, flags=0):
    out,c=re.subn(pattern,repl,text,count=1,flags=flags)
    if c!=1: raise SystemExit(f"{label}: expected 1, found {c}")
    return out

# ---------- app.js ----------
p=Path('app.js'); app=p.read_text(encoding='utf-8')
app=once(app,'const FUWA_RELEASE_KEY = "fuwa-v1.1.10-2026-08-14";','const FUWA_RELEASE_KEY = "fuwa-v1.2.0-2026-08-15";','release key')

old='''function openMoodCheckin(force = false) {
  const today = getTodayMoodCheckin();'''
new='''function fuwaMoodCheckinBlockedByActiveModal() {
  const settings = $("settingsSheet");
  const release = $("fuwaReleaseNotesModal");
  const feature = $("featureTutorial");
  const mainTutorial = $("fuwaTutorial");
  const privacyPin = $("privacyPinModal");
  const privacyLock = $("privacyLockScreen");
  return document.body.classList.contains("cloud-restore-open")
    || (settings && !settings.classList.contains("hidden"))
    || (release && !release.classList.contains("hidden"))
    || (feature && feature.hidden === false)
    || (mainTutorial && !mainTutorial.classList.contains("hidden"))
    || (privacyPin && !privacyPin.classList.contains("hidden"))
    || (privacyLock && !privacyLock.classList.contains("hidden"));
}

function openMoodCheckin(force = false) {
  if (!force && currentView !== "home") return;
  if (!force && fuwaMoodCheckinBlockedByActiveModal()) return;
  const today = getTodayMoodCheckin();'''
app=once(app,old,new,'mood open guard')
old='''function maybeShowDailyMoodCheckin() {
  if (getTodayMoodCheckin() || homeMoodSyncRunning || pendingHomeMoodSync) return;
  setTimeout(() => {
    if (getTodayMoodCheckin() || homeMoodSyncRunning || pendingHomeMoodSync) return;
    openMoodCheckin();
  }, 350);
}'''
new='''function maybeShowDailyMoodCheckin() {
  if (currentView !== "home" || fuwaMoodCheckinBlockedByActiveModal()) return;
  if (getTodayMoodCheckin() || homeMoodSyncRunning || pendingHomeMoodSync) return;
  setTimeout(() => {
    if (currentView !== "home" || fuwaMoodCheckinBlockedByActiveModal()) return;
    if (getTodayMoodCheckin() || homeMoodSyncRunning || pendingHomeMoodSync) return;
    openMoodCheckin();
  }, 350);
}'''
app=once(app,old,new,'mood delayed guard')

app=once(app,'function renderViewOnDemand(view = currentView) {','''function renderViewOnDemand(view = currentView) {
  if (view === "smart") {
    window.fuwaSmartRender?.();
    return;
  }''','smart render hook')

# Expose a narrow, local-only bridge. Smart code cannot touch Firebase or local-only blobs.
api_block='''

// FUWA V97 — narrow on-device intelligence bridge.
window.fuwaSmartApi = {
  snapshot() {
    return structuredClone({
      data: {
        entries: state.entries,
        tinyJoys: state.tinyJoys,
        letters: state.letters,
        moodCheckins: state.moodCheckins,
        threads: state.threads,
        bookmarks: state.bookmarks,
        nightlyReflections: state.nightlyReflections,
        thenNow: state.thenNow,
        comfortItems: state.comfortItems,
        unsentLetters: state.unsentLetters,
        thoughtBubbles: state.thoughtBubbles,
        dreams: state.dreams,
        dailyCheckins: state.dailyCheckins,
        lifeCollections: state.lifeCollections,
        habitDefinitions: state.habitDefinitions,
        moments: state.moments,
        randomThoughts: state.randomThoughts
      },
      selectedMood: state.selectedMood,
      profileName: state.profileName
    });
  },
  openEntry(id = null) { openEditor(id); },
  navigate(view) { navigate(view); },
  toast(message) { toast(message); },
  async createThread({ title, description = "", emoji = "☁️", entryIds = [] } = {}) {
    const cleanTitle = String(title || "").trim().slice(0, 60);
    if (!cleanTitle) throw new Error("smart-thread-title-required");
    const wanted = new Set((entryIds || []).filter(Boolean));
    const existingEntries = state.entries.filter(entry => wanted.has(entry.id));
    if (!existingEntries.length) throw new Error("smart-thread-no-entries");
    const id = crypto.randomUUID();
    const now = Date.now();
    const record = { id, title: cleanTitle, description: String(description || "").trim().slice(0, 240), emoji: safeThreadIcon(emoji), createdAt: now, updatedAt: now };
    const transaction = diaryRepository.db.transaction(["threads", "entries"], "readwrite");
    transaction.objectStore("threads").put(record);
    const entryStore = transaction.objectStore("entries");
    const nextEntries = existingEntries.map(entry => ({
      ...entry,
      threadIds: [...new Set([...(Array.isArray(entry.threadIds) ? entry.threadIds : []), id])],
      updatedAt: now
    }));
    nextEntries.forEach(entry => entryStore.put(entry));
    await transactionDone(transaction);
    state.threads.push(record);
    const byId = new Map(nextEntries.map(entry => [entry.id, entry]));
    state.entries = state.entries.map(entry => byId.get(entry.id) || entry);
    announceLocalDataChange({ action: "smart-create-thread", storeName: "threads", recordId: id });
    renderAll();
    return structuredClone(record);
  }
};
'''
anchor='''async function openEditor(entryId = null, dateOverride = null) {'''
app=once(app,anchor,api_block+'\n'+anchor,'smart api bridge')
p.write_text(app,encoding='utf-8')

# ---------- firebase-fuwa.js: v96 restore hardening ----------
p=Path('firebase-fuwa.js'); fb=p.read_text(encoding='utf-8')
pattern=r'''function closeCloudRestoreModal\(\) \{.*?\n\}\n\nasync function getVerifiedCloudBackup\(user = auth\?\.currentUser\) \{.*?\n\}\n\nfunction resetCloudRestoreButtonIfIdle\(label = "Restore safely"\) \{.*?\n\}'''
block='''const CLOUD_RESTORE_READ_TIMEOUT_MS = 12000;
function withCloudRestoreTimeout(promise, ms = CLOUD_RESTORE_READ_TIMEOUT_MS, code = "cloud-restore-timeout") {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => { if (timer) window.clearTimeout(timer); }),
    new Promise((_, reject) => { timer = window.setTimeout(() => reject(new Error(code)), ms); })
  ]);
}
function setCloudRestoreInteractionLayer(active) {
  document.body.classList.toggle("cloud-restore-open", Boolean(active));
  if (active) {
    document.getElementById("moodCheckinModal")?.classList.add("hidden");
    const feature = document.getElementById("featureTutorial");
    if (feature) { feature.hidden = true; feature.setAttribute("aria-hidden", "true"); }
    document.getElementById("fuwaReleaseNotesModal")?.classList.add("hidden");
    document.body.style.overflow = "hidden";
    return;
  }
  const settingsOpen = !$auth("settingsSheet")?.classList.contains("hidden");
  document.body.style.overflow = settingsOpen ? "hidden" : "";
}
function closeCloudRestoreModal() {
  if (cloudRestoreRunning) return;
  $auth("cloudRestoreModal")?.classList.add("hidden");
  setCloudRestoreInteractionLayer(false);
}
async function getVerifiedCloudBackup(user = auth?.currentUser) {
  if (!user?.uid) throw new Error("cloud-not-ready");
  if (!firestore || !firestoreApi) {
    const ready = await withCloudRestoreTimeout(ensureFirestoreReady(), CLOUD_RESTORE_READ_TIMEOUT_MS, "cloud-not-ready-timeout");
    if (!ready) throw new Error("cloud-not-ready");
  }
  const backupRef = firestoreApi.doc(firestore, "users", user.uid, "backups", "current");
  const snapshot = await withCloudRestoreTimeout(firestoreApi.getDoc(backupRef), CLOUD_RESTORE_READ_TIMEOUT_MS, "cloud-read-timeout");
  if (!snapshot.exists()) throw new Error("no-cloud-backup");
  const backup = snapshot.data();
  if (backup?.ownerUid !== user.uid || backup?.app !== "Fuwa" || backup?.backupFormat !== "fuwa-cloud-v1" || !backup?.data) throw new Error("invalid-cloud-backup");
  return backup;
}
function resetCloudRestoreButtonIfIdle(label = "Restore safely") {
  const button = $auth("cloudRestoreConfirmButton");
  if (!button || cloudRestoreRunning) return;
  button.disabled = false;
  button.textContent = label;
  button.removeAttribute("aria-busy");
}'''
fb=subonce(fb,pattern,block,'restore helper block',re.S)
fb=once(fb,'''async function openCloudRestoreModal() {
  const modal = $auth("cloudRestoreModal");
  if (!modal) return;

  modal.classList.remove("hidden");''','''async function openCloudRestoreModal() {
  const modal = $auth("cloudRestoreModal");
  if (!modal) return;

  setCloudRestoreInteractionLayer(true);
  modal.classList.remove("hidden");''','restore layer activation')
old='''    const noBackup = error?.message === "no-cloud-backup";
    if ($auth("cloudRestoreSummary")) {
      $auth("cloudRestoreSummary").textContent = noBackup
        ? "There isn't a Fuwa cloud backup for this account yet."
        : "Fuwa couldn't verify the preview just now. Tap Restore safely to retry the cloud check. Nothing on this device has changed.";
    }
    if ($auth("cloudRestoreDate")) $auth("cloudRestoreDate").textContent = noBackup ? "No backup" : "Check again";'''
new='''    const noBackup = error?.message === "no-cloud-backup";
    const timedOut = String(error?.message || "").includes("timeout");
    if ($auth("cloudRestoreSummary")) {
      $auth("cloudRestoreSummary").textContent = noBackup
        ? "There isn't a Fuwa cloud backup for this account yet."
        : timedOut
          ? "The cloud check took too long. Tap Restore safely to retry. Nothing on this device has changed."
          : "Fuwa couldn't verify the preview just now. Tap Restore safely to retry the cloud check. Nothing on this device has changed.";
    }
    if ($auth("cloudRestoreDate")) $auth("cloudRestoreDate").textContent = noBackup ? "No backup" : timedOut ? "Timed out" : "Check again";'''
fb=once(fb,old,new,'restore timeout copy')
p.write_text(fb,encoding='utf-8')

# ---------- style.css restore interaction layer ----------
p=Path('style.css'); style=p.read_text(encoding='utf-8')
style += '''\n\n/* FUWA V97 — recovery interaction isolation (carried forward from tested v96) */
#cloudRestoreButton,#cloudRestoreConfirmButton,#cloudRestoreCancelButton{touch-action:manipulation!important;-webkit-tap-highlight-color:transparent;pointer-events:auto!important}
#cloudRestoreButton{position:relative;z-index:6}.cloud-restore-modal:not(.hidden){z-index:2147482000!important;isolation:isolate;pointer-events:auto!important;visibility:visible!important;opacity:1!important}
body.cloud-restore-open .settings-sheet,body.cloud-restore-open .mood-checkin-modal,body.cloud-restore-open .fuwa-release-modal,body.cloud-restore-open .feature-tutorial,body.cloud-restore-open .fuwa-drawer,body.cloud-restore-open .fuwa-drawer-backdrop,body.cloud-restore-open .bottom-nav,body.cloud-restore-open .topbar{pointer-events:none!important}
body.cloud-restore-open .cloud-restore-modal,body.cloud-restore-open .cloud-restore-modal *{pointer-events:auto!important}
body.cloud-restore-open .privacy-pin-modal:not(.hidden),body.cloud-restore-open .privacy-lock-screen:not(.hidden){z-index:2147482500!important;pointer-events:auto!important}
'''
p.write_text(style,encoding='utf-8')

# ---------- index.html ----------
p=Path('index.html'); html=p.read_text(encoding='utf-8')
html=once(html,'<!-- FUWA_BUILD: v95-cloud-restore-button-qa-r1 -->','<!-- FUWA_BUILD: v97-fuwa-intelligence-qa -->','build marker')
html=once(html,'  <link rel="stylesheet" href="style.css" />','  <link rel="stylesheet" href="style.css" />\n  <link rel="stylesheet" href="smart-fuwa.css" />','smart css')
html=once(html,'<h2 id="fuwaReleaseNotesTitle">What’s new in Fuwa 1.1.10</h2>','<h2 id="fuwaReleaseNotesTitle">What’s new in Fuwa 1.2.0</h2>','release title')
html=once(html,'<p class="fuwa-release-date">August 14, 2026</p>','<p class="fuwa-release-date">August 15, 2026</p>','release date')
html=once(html,'<p class="fuwa-release-lead">A small cloud-restore reliability update: Restore safely stays retryable after temporary cloud checks, and the restore sheet now stays above regular check-in sheets so nothing invisible can block your tap.</p>','<p class="fuwa-release-lead">Fuwa can now connect the garden you’ve already grown: ask your journal, search by meaning, notice recurring threads, reflect without repetition, and look back through people, places, weeks, and older memories — all on this device.</p>','release lead')
html=once(html,'<div class="fuwa-release-list"><article><span>↻</span><div><strong>Restore button stays retryable</strong>','''<div class="fuwa-release-list"><article><span>✦</span><div><strong>Fuwa Insights</strong><p>Ask Fuwa, Smart Search, weekly stories, mood-pattern insights, recurring themes, people and places, and smarter Then & Now are gathered in one private on-device space.</p></div></article>
        <article><span>✎</span><div><strong>Writing help that waits for you</strong><p>Optional editor tools can help unpack a thought, offer a gentler perspective, reflect what you seem to be saying, or suggest a way to continue. Nothing is added unless you choose it.</p></div></article>
        <article><span>☁️</span><div><strong>Restore controls hardened</strong><p>The v96 recovery protections are included: automatic check-ins stay out of Settings and Cloud Restore owns its interaction layer while recovery is open.</p></div></article>
        <article><span>↻</span><div><strong>Restore button stays retryable</strong>''','release items')
html=once(html,'  <script src="app.js"></script>\n  <script type="module" src="firebase-fuwa.js"></script>','  <script src="app.js"></script>\n  <script src="smart-fuwa.js"></script>\n  <script type="module" src="firebase-fuwa.js"></script>','smart js')
p.write_text(html,encoding='utf-8')

# ---------- service-worker.js ----------
p=Path('service-worker.js'); sw=p.read_text(encoding='utf-8')
sw=once(sw,'const CACHE_NAME = "fuwa-shell-v95";','const CACHE_NAME = "fuwa-shell-v97";','sw cache')
sw=once(sw,'const RELEASE_KEY = "fuwa-v1.1.10-2026-08-14";','const RELEASE_KEY = "fuwa-v1.2.0-2026-08-15";','sw release')
sw=once(sw,'  "./style.css",\n  "./app.js",','  "./style.css",\n  "./smart-fuwa.css",\n  "./app.js",\n  "./smart-fuwa.js",','sw assets')
sw=once(sw,'    url.pathname.endsWith("/style.css") ||\n    url.pathname.endsWith("/app.js") ||','    url.pathname.endsWith("/style.css") ||\n    url.pathname.endsWith("/smart-fuwa.css") ||\n    url.pathname.endsWith("/app.js") ||\n    url.pathname.endsWith("/smart-fuwa.js") ||','sw core matcher')
p.write_text(sw,encoding='utf-8')

print('Fuwa v97 integration patch applied')