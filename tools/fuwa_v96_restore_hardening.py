from pathlib import Path
import re


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def sub_once(text, pattern, repl, label, flags=0):
    out, count = re.subn(pattern, repl, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return out

# app.js: release marker + suppress automatic mood sheets while cloud restore is open.
app_path = Path('app.js')
app = app_path.read_text(encoding='utf-8')
app = replace_once(app,
    'const FUWA_RELEASE_KEY = "fuwa-v1.1.10-2026-08-14";',
    'const FUWA_RELEASE_KEY = "fuwa-v1.1.11-2026-08-14";',
    'app release key')
app = sub_once(app,
    r'function openMoodCheckin\(force = false\) \{\n',
    'function openMoodCheckin(force = false) {\n  if (document.body.classList.contains("cloud-restore-open")) return;\n',
    'openMoodCheckin restore guard')
app = sub_once(app,
    r'function maybeShowDailyMoodCheckin\(\) \{\n',
    'function maybeShowDailyMoodCheckin() {\n  if (document.body.classList.contains("cloud-restore-open")) return;\n',
    'daily mood restore guard')
app_path.write_text(app, encoding='utf-8')

# firebase-fuwa.js: harden modal layering and bound the pre-write cloud read.
fb_path = Path('firebase-fuwa.js')
fb = fb_path.read_text(encoding='utf-8')

old_block_pattern = r'''function closeCloudRestoreModal\(\) \{.*?\n\}\n\nasync function getVerifiedCloudBackup\(user = auth\?\.currentUser\) \{.*?\n\}\n\nfunction resetCloudRestoreButtonIfIdle\(label = "Restore safely"\) \{.*?\n\}'''
new_block = '''const CLOUD_RESTORE_READ_TIMEOUT_MS = 12000;

function withCloudRestoreTimeout(promise, ms = CLOUD_RESTORE_READ_TIMEOUT_MS, code = "cloud-restore-timeout") {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) window.clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(code)), ms);
    })
  ]);
}

function setCloudRestoreInteractionLayer(active) {
  document.body.classList.toggle("cloud-restore-open", Boolean(active));

  if (active) {
    // Automatic/optional sheets must never steal a restore tap.
    document.getElementById("moodCheckinModal")?.classList.add("hidden");
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
  const snapshot = await withCloudRestoreTimeout(
    firestoreApi.getDoc(backupRef),
    CLOUD_RESTORE_READ_TIMEOUT_MS,
    "cloud-read-timeout"
  );
  if (!snapshot.exists()) throw new Error("no-cloud-backup");

  const backup = snapshot.data();
  if (
    backup?.ownerUid !== user.uid
    || backup?.app !== "Fuwa"
    || backup?.backupFormat !== "fuwa-cloud-v1"
    || !backup?.data
  ) {
    throw new Error("invalid-cloud-backup");
  }

  return backup;
}

function resetCloudRestoreButtonIfIdle(label = "Restore safely") {
  const button = $auth("cloudRestoreConfirmButton");
  if (!button || cloudRestoreRunning) return;
  button.disabled = false;
  button.textContent = label;
  button.removeAttribute("aria-busy");
}'''
fb = sub_once(fb, old_block_pattern, new_block, 'restore helper block', flags=re.S)

fb = replace_once(fb,
    '''async function openCloudRestoreModal() {
  const modal = $auth("cloudRestoreModal");
  if (!modal) return;

  modal.classList.remove("hidden");''',
    '''async function openCloudRestoreModal() {
  const modal = $auth("cloudRestoreModal");
  if (!modal) return;

  setCloudRestoreInteractionLayer(true);
  modal.classList.remove("hidden");''',
    'restore open interaction layer')

fb = replace_once(fb,
    '''    const noBackup = error?.message === "no-cloud-backup";
    if ($auth("cloudRestoreSummary")) {
      $auth("cloudRestoreSummary").textContent = noBackup
        ? "There isn't a Fuwa cloud backup for this account yet."
        : "Fuwa couldn't verify the preview just now. Tap Restore safely to retry the cloud check. Nothing on this device has changed.";
    }
    if ($auth("cloudRestoreDate")) $auth("cloudRestoreDate").textContent = noBackup ? "No backup" : "Check again";''',
    '''    const noBackup = error?.message === "no-cloud-backup";
    const timedOut = String(error?.message || "").includes("timeout");
    if ($auth("cloudRestoreSummary")) {
      $auth("cloudRestoreSummary").textContent = noBackup
        ? "There isn't a Fuwa cloud backup for this account yet."
        : timedOut
          ? "The cloud check took too long. Tap Restore safely to retry. Nothing on this device has changed."
          : "Fuwa couldn't verify the preview just now. Tap Restore safely to retry the cloud check. Nothing on this device has changed.";
    }
    if ($auth("cloudRestoreDate")) $auth("cloudRestoreDate").textContent = noBackup ? "No backup" : timedOut ? "Timed out" : "Check again";''',
    'restore preview timeout copy')

fb = replace_once(fb,
    '''    cloudRestoreRunning = false;
    if (button) button.removeAttribute("aria-busy");
    closeCloudRestoreModal();''',
    '''    cloudRestoreRunning = false;
    if (button) button.removeAttribute("aria-busy");
    closeCloudRestoreModal();''',
    'success cleanup anchor')

# Keep the restore layer active through failures so the user can immediately retry.
fb_path.write_text(fb, encoding='utf-8')

# style.css: append a top-level interaction layer that wins over Settings, drawer,
# automatic mood sheets, release notes, and tutorials, while still allowing privacy lock.
style_path = Path('style.css')
style = style_path.read_text(encoding='utf-8')
style += '''\n\n/* =========================================================
   FUWA V96 — CLOUD RESTORE INTERACTION HARDENING
   ========================================================= */
#cloudRestoreButton,
#cloudRestoreConfirmButton,
#cloudRestoreCancelButton {
  touch-action: manipulation !important;
  -webkit-tap-highlight-color: transparent;
  pointer-events: auto !important;
}
#cloudRestoreButton {
  position: relative;
  z-index: 6;
}
.cloud-restore-modal:not(.hidden) {
  z-index: 2147482000 !important;
  isolation: isolate;
  pointer-events: auto !important;
  visibility: visible !important;
  opacity: 1 !important;
}
.cloud-restore-modal:not(.hidden) .cloud-restore-sheet,
.cloud-restore-modal:not(.hidden) .cloud-restore-actions,
.cloud-restore-modal:not(.hidden) .cloud-restore-actions button {
  position: relative;
  pointer-events: auto !important;
}
body.cloud-restore-open .settings-sheet,
body.cloud-restore-open .mood-checkin-modal,
body.cloud-restore-open .fuwa-release-modal,
body.cloud-restore-open .feature-tutorial,
body.cloud-restore-open .fuwa-drawer,
body.cloud-restore-open .fuwa-drawer-backdrop,
body.cloud-restore-open .bottom-nav,
body.cloud-restore-open .topbar {
  pointer-events: none !important;
}
body.cloud-restore-open .cloud-restore-modal,
body.cloud-restore-open .cloud-restore-modal * {
  pointer-events: auto !important;
}
/* Privacy controls remain above data-recovery UI. */
body.cloud-restore-open .privacy-pin-modal:not(.hidden),
body.cloud-restore-open .privacy-lock-screen:not(.hidden) {
  z-index: 2147482500 !important;
  pointer-events: auto !important;
}
'''
style_path.write_text(style, encoding='utf-8')

# index.html: release marker + concise note.
index_path = Path('index.html')
index = index_path.read_text(encoding='utf-8')
index = replace_once(index,
    '<!-- FUWA_BUILD: v95-cloud-restore-button-qa-r1 -->',
    '<!-- FUWA_BUILD: v96-cloud-restore-hardening-qa -->',
    'build marker')
index = replace_once(index,
    'What’s new in Fuwa 1.1.10',
    'What’s new in Fuwa 1.1.11',
    'release heading')
index = replace_once(index,
    'A small cloud-restore reliability update: Restore safely stays retryable after temporary cloud checks, and the restore sheet now stays above regular check-in sheets so nothing invisible can block your tap.',
    'A focused cloud-restore hardening update: Restore now owns the top interaction layer while it is open, and slow cloud reads time out safely instead of leaving the action stuck.',
    'release lead')
index = replace_once(index,
    '<div class="fuwa-release-list"><article><span>↻</span><div><strong>Restore button stays retryable</strong>',
    '<div class="fuwa-release-list"><article><span>☁️</span><div><strong>Restore interaction hardened</strong><p>Settings, automatic check-ins, tutorials, and other non-critical sheets can no longer sit on top of Cloud Restore or steal its taps.</p></div></article>\n        <article><span>⏱</span><div><strong>Cloud checks cannot hang forever</strong><p>The pre-restore Firebase read now has a bounded timeout and returns Restore safely to a retryable state without changing device data.</p></div></article>\n        <article><span>↻</span><div><strong>Restore button stays retryable</strong>',
    'release notes prepend')
index_path.write_text(index, encoding='utf-8')

# service worker release handoff.
sw_path = Path('service-worker.js')
sw = sw_path.read_text(encoding='utf-8')
sw = replace_once(sw, 'const CACHE_NAME = "fuwa-shell-v95";', 'const CACHE_NAME = "fuwa-shell-v96";', 'sw cache')
sw = replace_once(sw, 'const RELEASE_KEY = "fuwa-v1.1.10-2026-08-14";', 'const RELEASE_KEY = "fuwa-v1.1.11-2026-08-14";', 'sw release key')
sw_path.write_text(sw, encoding='utf-8')

print('Fuwa v96 cloud restore hardening patch applied.')
