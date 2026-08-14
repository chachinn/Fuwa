from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


# app.js — release handoff marker only. No DB/schema changes.
app_path = Path("app.js")
app = app_path.read_text(encoding="utf-8")
app = replace_once(
    app,
    'const FUWA_RELEASE_KEY = "fuwa-v1.1.9-2026-08-14";',
    'const FUWA_RELEASE_KEY = "fuwa-v1.1.10-2026-08-14";',
    "app release key",
)
app_path.write_text(app, encoding="utf-8")


# firebase-fuwa.js — make cloud restore retryable after slow/transient preview checks.
fb_path = Path("firebase-fuwa.js")
fb = fb_path.read_text(encoding="utf-8")

fb = replace_once(
    fb,
    'let cloudConflictDetected = false;\n',
    'let cloudConflictDetected = false;\nlet cloudRestoreRunning = false;\n',
    "cloud restore running state",
)

old_open = '''async function openCloudRestoreModal() {
  const modal = $auth("cloudRestoreModal");
  if (!modal) return;

  modal.classList.remove("hidden");
  if ($auth("cloudRestoreSummary")) $auth("cloudRestoreSummary").textContent = "Checking your cloud backup…";
  if ($auth("cloudRestoreDate")) $auth("cloudRestoreDate").textContent = "Checking…";
  if ($auth("cloudRestoreRecords")) $auth("cloudRestoreRecords").textContent = "Checking…";
  if ($auth("cloudRestoreConfirmButton")) $auth("cloudRestoreConfirmButton").disabled = true;

  try {
    const backup = await getVerifiedCloudBackup();
    modal.dataset.backupId = backup.backupId || "";
    if ($auth("cloudRestoreSummary")) {
      $auth("cloudRestoreSummary").textContent = "Fuwa found a valid backup for this signed-in account.";
    }
    if ($auth("cloudRestoreDate")) {
      $auth("cloudRestoreDate").textContent = formatCloudBackupTime(backup.backedUpAt || backup.backedUpAtClient);
    }
    if ($auth("cloudRestoreRecords")) {
      const count = Number(backup.recordCount || 0);
      $auth("cloudRestoreRecords").textContent = `${count} record${count === 1 ? "" : "s"}`;
    }
    if ($auth("cloudRestoreConfirmButton")) $auth("cloudRestoreConfirmButton").disabled = false;
  } catch (error) {
    console.error("Fuwa could not prepare cloud restore.", error);
    const noBackup = error?.message === "no-cloud-backup";
    if ($auth("cloudRestoreSummary")) {
      $auth("cloudRestoreSummary").textContent = noBackup
        ? "There isn't a Fuwa cloud backup for this account yet."
        : "Fuwa couldn't verify this cloud backup. Nothing on your device was changed.";
    }
    if ($auth("cloudRestoreDate")) $auth("cloudRestoreDate").textContent = "Unavailable";
    if ($auth("cloudRestoreRecords")) $auth("cloudRestoreRecords").textContent = "—";
  }
}'''

new_open = '''function resetCloudRestoreButtonIfIdle(label = "Restore safely") {
  const button = $auth("cloudRestoreConfirmButton");
  if (!button || cloudRestoreRunning) return;
  button.disabled = false;
  button.textContent = label;
  button.removeAttribute("aria-busy");
}

async function openCloudRestoreModal() {
  const modal = $auth("cloudRestoreModal");
  if (!modal) return;

  modal.classList.remove("hidden");
  if ($auth("cloudRestoreSummary")) $auth("cloudRestoreSummary").textContent = "Checking your cloud backup…";
  if ($auth("cloudRestoreDate")) $auth("cloudRestoreDate").textContent = "Checking…";
  if ($auth("cloudRestoreRecords")) $auth("cloudRestoreRecords").textContent = "Checking…";

  // V95: the preview check is informational, not a permanent gate. A slow or
  // transient Firestore read must never leave Restore safely untappable.
  resetCloudRestoreButtonIfIdle("Restore safely");

  try {
    const backup = await getVerifiedCloudBackup();
    modal.dataset.backupId = backup.backupId || "";
    if ($auth("cloudRestoreSummary")) {
      $auth("cloudRestoreSummary").textContent = "Fuwa found a valid backup for this signed-in account.";
    }
    if ($auth("cloudRestoreDate")) {
      $auth("cloudRestoreDate").textContent = formatCloudBackupTime(backup.backedUpAt || backup.backedUpAtClient);
    }
    if ($auth("cloudRestoreRecords")) {
      const count = Number(backup.recordCount || 0);
      $auth("cloudRestoreRecords").textContent = `${count} record${count === 1 ? "" : "s"}`;
    }
    resetCloudRestoreButtonIfIdle("Restore safely");
  } catch (error) {
    console.error("Fuwa could not prepare cloud restore.", error);
    const noBackup = error?.message === "no-cloud-backup";
    if ($auth("cloudRestoreSummary")) {
      $auth("cloudRestoreSummary").textContent = noBackup
        ? "There isn't a Fuwa cloud backup for this account yet."
        : "Fuwa couldn't verify the preview just now. Tap Restore safely to retry the cloud check. Nothing on this device has changed.";
    }
    if ($auth("cloudRestoreDate")) $auth("cloudRestoreDate").textContent = noBackup ? "No backup" : "Check again";
    if ($auth("cloudRestoreRecords")) $auth("cloudRestoreRecords").textContent = "—";
    resetCloudRestoreButtonIfIdle(noBackup ? "Check again" : "Restore safely");
  }
}'''
fb = replace_once(fb, old_open, new_open, "restore modal preview flow")

fb = replace_once(
    fb,
    '''async function handleCloudRestoreConfirm() {
  const button = $auth("cloudRestoreConfirmButton");
  const cancel = $auth("cloudRestoreCancelButton");
  let safetyBackup = null;
  let restoreStarted = false;
  if (button?.disabled) return;

  if (button) {
    button.disabled = true;
    button.textContent = "Protecting this device…";
  }
  if (cancel) cancel.disabled = true;''',
    '''async function handleCloudRestoreConfirm() {
  const button = $auth("cloudRestoreConfirmButton");
  const cancel = $auth("cloudRestoreCancelButton");
  let safetyBackup = null;
  let restoreStarted = false;
  if (cloudRestoreRunning) return;

  cloudRestoreRunning = true;
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Checking backup…";
  }
  if (cancel) cancel.disabled = true;''',
    "restore confirm busy guard",
)

fb = replace_once(
    fb,
    '''    safetyBackup = await window.fuwaCreateRestoreSafetyBackup();
    suppressAutoSyncUntil = Date.now() + 5000;

    if (button) button.textContent = "Restoring & verifying…";''',
    '''    if (button) button.textContent = "Protecting this device…";
    safetyBackup = await window.fuwaCreateRestoreSafetyBackup();
    suppressAutoSyncUntil = Date.now() + 5000;

    if (button) button.textContent = "Restoring & verifying…";''',
    "restore stage labels",
)

fb = replace_once(
    fb,
    '''    closeCloudRestoreModal();

    // The in-memory safety snapshot already protected this restore attempt.''',
    '''    cloudRestoreRunning = false;
    if (button) button.removeAttribute("aria-busy");
    closeCloudRestoreModal();

    // The in-memory safety snapshot already protected this restore attempt.''',
    "successful restore busy release",
)

fb = replace_once(
    fb,
    '''    window.alert(message);
    if (button) {
      button.disabled = false;
      button.textContent = "Restore safely";
    }
    if (cancel) cancel.disabled = false;
  }
}''',
    '''    window.alert(message);
    cloudRestoreRunning = false;
    if (button) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.textContent = "Restore safely";
    }
    if (cancel) cancel.disabled = false;
  }
}''',
    "failed restore busy release",
)

# iOS standalone PWAs can resume from suspension without rebuilding the DOM.
# If no restore is actually running, never preserve a stale disabled button.
fb = replace_once(
    fb,
    'window.addEventListener("pageshow", () => retryPendingCloudSync("resume"));',
    '''window.addEventListener("pageshow", () => {
  retryPendingCloudSync("resume");
  resetCloudRestoreButtonIfIdle();
});''',
    "pageshow restore control recovery",
)

fb_path.write_text(fb, encoding="utf-8")


# index.html — build marker and compact release note.
index_path = Path("index.html")
index = index_path.read_text(encoding="utf-8")
index = replace_once(index, '<!-- FUWA_BUILD: v94-cloud-restore-safety-qa -->', '<!-- FUWA_BUILD: v95-cloud-restore-button-qa -->', "build marker")
index = replace_once(index, 'What’s new in Fuwa 1.1.9', 'What’s new in Fuwa 1.1.10', "release heading")
index = replace_once(
    index,
    'A cloud-restore safety update: Fuwa now verifies every backed-up record consistently and automatically restores the pre-restore device snapshot if a restore cannot finish safely.',
    'A small cloud-restore reliability update: Restore safely can no longer get stuck disabled after a slow or temporary cloud check, while duplicate taps stay blocked during a real restore.',
    "release lead",
)
index = replace_once(
    index,
    '<div class="fuwa-release-list"><article><span>☁️</span><div><strong>Cloud restore verification fixed</strong>',
    '<div class="fuwa-release-list"><article><span>↻</span><div><strong>Restore button stays retryable</strong><p>A slow or temporary cloud preview check no longer leaves Restore safely disabled. Tapping it performs a fresh verified check before any device data changes.</p></div></article>\n        <article><span>☁️</span><div><strong>Cloud restore verification fixed</strong>',
    "release note prepend",
)
index_path.write_text(index, encoding="utf-8")


# service worker — update handoff only.
sw_path = Path("service-worker.js")
sw = sw_path.read_text(encoding="utf-8")
sw = replace_once(sw, 'const CACHE_NAME = "fuwa-shell-v94";', 'const CACHE_NAME = "fuwa-shell-v95";', "sw cache")
sw = replace_once(sw, 'const RELEASE_KEY = "fuwa-v1.1.9-2026-08-14";', 'const RELEASE_KEY = "fuwa-v1.1.10-2026-08-14";', "sw release key")
sw_path.write_text(sw, encoding="utf-8")

print("Fuwa v95 restore button recovery patch applied.")
