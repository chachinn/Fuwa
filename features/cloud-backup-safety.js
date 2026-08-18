// FUWA V108 — CLOUD RESTORE / EMPTY-DEVICE OVERWRITE SAFETY
// Keeps a fresh or cleared device from replacing an existing useful cloud backup
// before the user has had a chance to restore it.

const FUWA_CLOUD_SAFETY_FIREBASE_VERSION = "12.16.0";
const FUWA_CLOUD_RESTORE_GUARD_KEY = "fuwaCloudRestoreGuardV1";
const FUWA_CLOUD_BASELINE_KEY_SAFETY = "fuwaCloudBaselineV1";
const FUWA_CLOUD_DEVICE_ID_KEY_SAFETY = "fuwaCloudDeviceIdV1";
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

function fuwaCloudSafetyPauseDailyBackup(uid, backup = {}) {
  try {
    window.fuwaDailyBackupDebug?.markDailyBackupSatisfied?.(uid, backup, new Date());
  } catch (error) {
    console.warn("Fuwa could not pause today's empty-device backup safely.", error);
  }
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

    // Critical race guard: a fresh/cleared device after 8 AM must never run an
    // automatic empty backup while Fuwa is still discovering the cloud copy.
    if (!local.hasJournalData || Number(local.recordCount || 0) === 0) {
      fuwaCloudSafetyPauseDailyBackup(uid);
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
    const localEmpty = !local.hasJournalData || Number(local.recordCount || 0) === 0;

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
      fuwaCloudSafetyPauseDailyBackup(uid, remote);
      fuwaCloudSafetyRenderPausedStatus();
      return { local, remote, guarded: true };
    }

    // A matching baseline means this device has already seen this cloud copy.
    // A zero-record remote is not useful restore data and does not need a guard.
    if (baselineMatches || remoteCount === 0) fuwaCloudSafetyClearGuard(uid);
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

  fuwaCloudSafetyClearGuard(fuwaCloudSafetyUid);
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
});

window.addEventListener("online", () => {
  if (fuwaCloudSafetyUid) void fuwaCloudSafetyInspect(fuwaCloudSafetyUid, "online");
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && fuwaCloudSafetyUid) {
    void fuwaCloudSafetyInspect(fuwaCloudSafetyUid, "resume");
  }
});

// If the tiny synchronous loader saw auth before this module finished loading,
// replay that state now so the guard is still established.
if (window.__fuwaCloudSafetyLastAuthDetail) {
  fuwaCloudSafetyHandleAuthReady(window.__fuwaCloudSafetyLastAuthDetail);
}

window.FuwaCloudBackupSafety = {
  inspect: () => fuwaCloudSafetyInspect(fuwaCloudSafetyUid, "manual-debug"),
  guard: () => fuwaCloudSafetyReadGuard(),
  clearGuard: () => fuwaCloudSafetyClearGuard(),
  readBaseline: uid => fuwaCloudSafetyReadBaseline(uid || fuwaCloudSafetyUid)
};
