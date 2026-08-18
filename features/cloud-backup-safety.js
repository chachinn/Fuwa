// FUWA V109 — CLOUD RESTORE / EMPTY-DEVICE OVERWRITE SAFETY
// Keeps a fresh or cleared device from replacing an existing useful cloud backup
// before the user has had a chance to restore it.

const FUWA_CLOUD_SAFETY_FIREBASE_VERSION = "12.16.0";
const FUWA_CLOUD_RESTORE_GUARD_KEY = "fuwaCloudRestoreGuardV1";
const FUWA_CLOUD_BASELINE_KEY_SAFETY = "fuwaCloudBaselineV1";
const FUWA_CLOUD_DEVICE_ID_KEY_SAFETY = "fuwaCloudDeviceIdV1";
const FUWA_CLOUD_DAILY_BACKUP_STATE_KEY_SAFETY = "fuwaDailyCloudBackupV1";
const FUWA_CLOUD_PENDING_KEY_SAFETY = "fuwaCloudPendingV1";
const FUWA_CLOUD_SAFETY_READ_TIMEOUT_MS = 10000;

let fuwaCloudSafetyUid = "";
let fuwaCloudSafetyInspection = null;
let fuwaCloudSafetyManualOverwriteOnce = false;

function fuwaCloudSafetyReadJson(key, fallback = {}) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value && typeof value === "object" ? value : fallback;
  } catch (_) {
    return fallback;
  }
}

function fuwaCloudSafetyReadGuard(uid = fuwaCloudSafetyUid) {
  if (!uid) return null;
  const all = fuwaCloudSafetyReadJson(FUWA_CLOUD_RESTORE_GUARD_KEY, {});
  return all?.[uid] || null;
}

function fuwaCloudSafetyWriteGuard(uid, guard) {
  if (!uid) return;
  try {
    const all = fuwaCloudSafetyReadJson(FUWA_CLOUD_RESTORE_GUARD_KEY, {});
    all[uid] = {
      backupId: guard?.backupId || null,
      recordCount: Number(guard?.recordCount || 0),
      backedUpAtClient: guard?.backedUpAtClient || null,
      reason: guard?.reason || "restore-first",
      savedAt: Date.now()
    };
    localStorage.setItem(FUWA_CLOUD_RESTORE_GUARD_KEY, JSON.stringify(all));
  } catch (error) {
    console.warn("Fuwa could not save its cloud restore safety guard.", error);
  }
}

function fuwaCloudSafetyClearGuard(uid = fuwaCloudSafetyUid) {
  if (!uid) return;
  try {
    const all = fuwaCloudSafetyReadJson(FUWA_CLOUD_RESTORE_GUARD_KEY, {});
    if (!Object.prototype.hasOwnProperty.call(all, uid)) return;
    delete all[uid];
    if (Object.keys(all).length) localStorage.setItem(FUWA_CLOUD_RESTORE_GUARD_KEY, JSON.stringify(all));
    else localStorage.removeItem(FUWA_CLOUD_RESTORE_GUARD_KEY);
  } catch (error) {
    console.warn("Fuwa could not clear its cloud restore safety guard.", error);
  }
}

function fuwaCloudSafetyReadBaseline(uid) {
  const all = fuwaCloudSafetyReadJson(FUWA_CLOUD_BASELINE_KEY_SAFETY, {});
  return all?.[uid] || null;
}

function fuwaCloudSafetyDeviceId() {
  try {
    return localStorage.getItem(FUWA_CLOUD_DEVICE_ID_KEY_SAFETY) || "";
  } catch (_) {
    return "";
  }
}

function fuwaCloudSafetyWithTimeout(promise, ms = FUWA_CLOUD_SAFETY_READ_TIMEOUT_MS) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) window.clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error("fuwa-cloud-safety-timeout")), ms);
    })
  ]);
}

function fuwaCloudSafetyLocalDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fuwaCloudSafetyPauseDailyBackup(uid, backup = {}, reason = "restore-guard") {
  if (!uid) return;
  const now = new Date();

  // The existing daily scheduler only marks a day complete at/after 8 AM.
  // Persist a safety-only day marker ourselves as well, so a device opened
  // before 8 AM cannot let an already-scheduled timer overwrite the cloud later.
  try {
    const all = fuwaCloudSafetyReadJson(FUWA_CLOUD_DAILY_BACKUP_STATE_KEY_SAFETY, {});
    all[uid] = {
      dayKey: fuwaCloudSafetyLocalDayKey(now),
      completedAt: now.toISOString(),
      backupId: backup?.backupId || null,
      sourceDeviceId: backup?.sourceDeviceId || null,
      safetyGuard: true,
      safetyReason: reason
    };
    localStorage.setItem(FUWA_CLOUD_DAILY_BACKUP_STATE_KEY_SAFETY, JSON.stringify(all));
  } catch (error) {
    console.warn("Fuwa could not persist its daily cloud safety pause.", error);
  }

  try {
    window.fuwaDailyBackupDebug?.markDailyBackupSatisfied?.(uid, backup, now);
  } catch (error) {
    console.warn("Fuwa could not pause today's empty-device backup safely.", error);
  }
}

function fuwaCloudSafetyReleaseDailyPause(uid = fuwaCloudSafetyUid) {
  if (!uid) return;
  try {
    const all = fuwaCloudSafetyReadJson(FUWA_CLOUD_DAILY_BACKUP_STATE_KEY_SAFETY, {});
    if (!all?.[uid]?.safetyGuard) return;
    delete all[uid];
    if (Object.keys(all).length) localStorage.setItem(FUWA_CLOUD_DAILY_BACKUP_STATE_KEY_SAFETY, JSON.stringify(all));
    else localStorage.removeItem(FUWA_CLOUD_DAILY_BACKUP_STATE_KEY_SAFETY);
  } catch (error) {
    console.warn("Fuwa could not release its temporary daily cloud safety pause.", error);
  }
}

function fuwaCloudSafetyDropMeaninglessPendingSync(local) {
  const empty = !local?.hasJournalData || Number(local?.recordCount || 0) === 0;
  if (!empty) return;
  try {
    // Pending sync is global in the current implementation. On an empty local
    // diary there is nothing useful to upload, so clearing it prevents a stale
    // resume timer from writing before restore-first inspection finishes.
    localStorage.removeItem(FUWA_CLOUD_PENDING_KEY_SAFETY);
  } catch (_) {}
}

function fuwaCloudSafetyRenderPausedStatus(guard = fuwaCloudSafetyReadGuard()) {
  if (!guard) return;
  const auto = document.getElementById("cloudAutoSyncStatus");
  const daily = document.getElementById("cloudDailyBackupStatus");
  if (auto) auto.textContent = "Paused · restore cloud copy first";
  if (daily) daily.textContent = "Protected · cloud copy kept";
}

async function fuwaCloudSafetyGetLocalSummary() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (typeof window.fuwaGetLocalCloudSummary === "function") {
      return window.fuwaGetLocalCloudSummary();
    }
    await new Promise(resolve => window.setTimeout(resolve, 50));
  }
  return null;
}

async function fuwaCloudSafetyReadRemote(uid) {
  const [appModule, firestoreModule] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FUWA_CLOUD_SAFETY_FIREBASE_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FUWA_CLOUD_SAFETY_FIREBASE_VERSION}/firebase-firestore.js`)
  ]);
  const app = appModule.getApp();
  const db = firestoreModule.getFirestore(app);
  const ref = firestoreModule.doc(db, "users", uid, "backups", "current");
  const snapshot = await fuwaCloudSafetyWithTimeout(
    firestoreModule.getDoc(ref),
    FUWA_CLOUD_SAFETY_READ_TIMEOUT_MS
  );
  return snapshot.exists() ? snapshot.data() : null;
}

async function fuwaCloudSafetyInspect(uid = fuwaCloudSafetyUid, reason = "auth-ready") {
  if (!uid) return null;
  if (fuwaCloudSafetyInspection) return fuwaCloudSafetyInspection;

  fuwaCloudSafetyInspection = (async () => {
    const local = await fuwaCloudSafetyGetLocalSummary();
    if (!local) return null;

    // Critical race guard: a fresh/cleared device must never run an automatic
    // empty backup while Fuwa is still discovering whether a cloud copy exists.
    const localEmpty = !local.hasJournalData || Number(local.recordCount || 0) === 0;
    if (localEmpty) {
      fuwaCloudSafetyDropMeaninglessPendingSync(local);
      fuwaCloudSafetyPauseDailyBackup(uid, {}, "inspection-in-progress");
    }

    let remote = null;
    try {
      remote = await fuwaCloudSafetyReadRemote(uid);
    } catch (error) {
      console.warn(`Fuwa cloud safety check deferred (${reason}).`, error?.message || error);
      return null;
    }

    if (!remote) {
      fuwaCloudSafetyClearGuard(uid);
      fuwaCloudSafetyReleaseDailyPause(uid);
      return { local, remote: null, guarded: false };
    }

    const remoteCount = Number(remote.recordCount || 0);
    const baseline = fuwaCloudSafetyReadBaseline(uid);
    const deviceId = fuwaCloudSafetyDeviceId();
    const baselineMatches = Boolean(
      baseline?.backupId && remote.backupId && baseline.backupId === remote.backupId
    );
    const fromAnotherDevice = Boolean(
      remote.sourceDeviceId && (!deviceId || remote.sourceDeviceId !== deviceId)
    );
    const shouldGuard = remoteCount > 0 && (
      localEmpty ||
      (!baselineMatches && fromAnotherDevice)
    );

    if (shouldGuard) {
      fuwaCloudSafetyWriteGuard(uid, {
        backupId: remote.backupId || null,
        recordCount: remoteCount,
        backedUpAtClient: remote.backedUpAtClient || null,
        reason: localEmpty ? "empty-device-restore-first" : "unseen-cloud-copy"
      });
      fuwaCloudSafetyPauseDailyBackup(uid, remote, "protected-cloud-copy");
      fuwaCloudSafetyRenderPausedStatus();
      return { local, remote, guarded: true };
    }

    // A matching baseline means this device has already seen this cloud copy.
    // A zero-record remote is not useful restore data and does not need a guard.
    if (baselineMatches || remoteCount === 0) {
      fuwaCloudSafetyClearGuard(uid);
      fuwaCloudSafetyReleaseDailyPause(uid);
    }
    return { local, remote, guarded: Boolean(fuwaCloudSafetyReadGuard(uid)) };
  })().finally(() => {
    fuwaCloudSafetyInspection = null;
  });

  return fuwaCloudSafetyInspection;
}

function fuwaCloudSafetyHandleAuthReady(detail = {}) {
  const user = detail?.user;
  fuwaCloudSafetyUid = user?.uid || "";
  fuwaCloudSafetyManualOverwriteOnce = false;

  if (!fuwaCloudSafetyUid) return;

  const existingGuard = fuwaCloudSafetyReadGuard(fuwaCloudSafetyUid);
  if (existingGuard) fuwaCloudSafetyRenderPausedStatus(existingGuard);
  void fuwaCloudSafetyInspect(fuwaCloudSafetyUid, "auth-ready");
}

// Block the Firebase module's local-change auto-sync while a useful unseen
// cloud copy is protected. This listener uses capture so it runs before the
// existing bubble listener without changing Fuwa's current sync implementation.
window.addEventListener("fuwa-local-data-changed", event => {
  if (event?.detail?.source !== "local") return;
  const guard = fuwaCloudSafetyReadGuard();
  if (!guard) return;

  event.stopImmediatePropagation();
  fuwaCloudSafetyRenderPausedStatus(guard);
}, true);

// Manual overwrite stays available, but it must be an explicit user choice.
document.addEventListener("click", event => {
  const button = event.target?.closest?.("#cloudBackupNowButton");
  if (!button || !fuwaCloudSafetyUid) return;

  const guard = fuwaCloudSafetyReadGuard(fuwaCloudSafetyUid);
  if (!guard) return;

  if (fuwaCloudSafetyManualOverwriteOnce) {
    fuwaCloudSafetyManualOverwriteOnce = false;
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();

  const count = Number(guard.recordCount || 0);
  const confirmed = window.confirm(
    `Fuwa Cloud already has a protected backup with ${count} record${count === 1 ? "" : "s"}. ` +
    "Backing up this device now can replace that cloud copy. Restore first if you need it.\n\nReplace the protected cloud copy anyway?"
  );

  if (!confirmed) {
    fuwaCloudSafetyRenderPausedStatus(guard);
    return;
  }

  // Keep the guard in place until the real cloud write reports success.
  // This way a failed manual overwrite cannot silently remove restore protection.
  fuwaCloudSafetyManualOverwriteOnce = true;
  window.queueMicrotask(() => button.click());
}, true);

window.addEventListener("fuwa-auth-ready", event => {
  fuwaCloudSafetyHandleAuthReady(event?.detail || {});
});

window.addEventListener("fuwa-firestore-ready", event => {
  if (!event?.detail?.connected || !event?.detail?.uid) return;
  fuwaCloudSafetyUid = event.detail.uid;
  void fuwaCloudSafetyInspect(event.detail.uid, "firestore-ready");
});

window.addEventListener("fuwa-cloud-backup-complete", () => {
  if (!fuwaCloudSafetyUid) return;
  fuwaCloudSafetyClearGuard(fuwaCloudSafetyUid);
  fuwaCloudSafetyReleaseDailyPause(fuwaCloudSafetyUid);
});

function fuwaCloudSafetyHoldResumeEvent(event, reason) {
  if (!fuwaCloudSafetyUid) return false;
  const guard = fuwaCloudSafetyReadGuard(fuwaCloudSafetyUid);
  if (!guard) return false;
  event?.stopImmediatePropagation?.();
  fuwaCloudSafetyRenderPausedStatus(guard);
  void fuwaCloudSafetyInspect(fuwaCloudSafetyUid, reason);
  return true;
}

// Existing Firebase resume handlers can directly call automatic sync without a
// local-change event. Capture these lifecycle events first while restore guard
// is active so those direct paths cannot overwrite the protected cloud copy.
window.addEventListener("online", event => {
  if (fuwaCloudSafetyHoldResumeEvent(event, "online")) return;
  if (fuwaCloudSafetyUid) void fuwaCloudSafetyInspect(fuwaCloudSafetyUid, "online");
}, true);

window.addEventListener("pageshow", event => {
  if (fuwaCloudSafetyHoldResumeEvent(event, "pageshow")) return;
  if (fuwaCloudSafetyUid) void fuwaCloudSafetyInspect(fuwaCloudSafetyUid, "pageshow");
}, true);

document.addEventListener("visibilitychange", event => {
  if (document.visibilityState !== "visible" || !fuwaCloudSafetyUid) return;
  if (fuwaCloudSafetyHoldResumeEvent(event, "resume")) return;
  void fuwaCloudSafetyInspect(fuwaCloudSafetyUid, "resume");
}, true);

// If the tiny synchronous loader saw auth before this module finished loading,
// replay that state now so the guard is still established.
if (window.__fuwaCloudSafetyLastAuthDetail) {
  fuwaCloudSafetyHandleAuthReady(window.__fuwaCloudSafetyLastAuthDetail);
}

window.FuwaCloudBackupSafety = {
  inspect: () => fuwaCloudSafetyInspect(fuwaCloudSafetyUid, "manual-debug"),
  guard: () => fuwaCloudSafetyReadGuard(),
  clearGuard: () => {
    fuwaCloudSafetyClearGuard();
    fuwaCloudSafetyReleaseDailyPause();
  },
  readBaseline: uid => fuwaCloudSafetyReadBaseline(uid || fuwaCloudSafetyUid),
  dailyPause: uid => fuwaCloudSafetyReadJson(FUWA_CLOUD_DAILY_BACKUP_STATE_KEY_SAFETY, {})?.[uid || fuwaCloudSafetyUid] || null
};
