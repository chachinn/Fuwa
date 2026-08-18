// FUWA V111 — CLOUD RESTORE RECOVERY
// Recovery-only layer for backups whose saved recordCount metadata disagrees
// with the actual arrays in data, plus a conservative legacy-device fallback.
// This module never repairs or rewrites the cloud document by itself.

const FUWA_RECOVERY_FIREBASE_VERSION = "12.16.0";
const FUWA_RECOVERY_READ_TIMEOUT_MS = 12000;
const FUWA_RECOVERY_STORE_NAMES = [
  "entries", "tinyJoys", "letters", "moodCheckins", "threads", "bookmarks",
  "nightlyReflections", "thenNow", "comfortItems", "unsentLetters",
  "thoughtBubbles", "dreams", "dailyCheckins", "lifeCollections",
  "habitDefinitions", "moments", "randomThoughts"
];
const FUWA_RECOVERY_BASELINE_KEY = "fuwaCloudBaselineV1";
const FUWA_RECOVERY_LEGACY_KEY = "fuwaDataV1";

let fuwaRecoveryUid = "";
let fuwaRecoveryState = null;
let fuwaRecoveryScanPromise = null;
let fuwaRecoveryBypassNextConfirm = false;
let fuwaRecoveryRunning = false;
let fuwaRecoveryObserver = null;

function fuwaRecoveryCount(data) {
  if (!data || typeof data !== "object") return 0;
  return FUWA_RECOVERY_STORE_NAMES.reduce((total, storeName) => {
    return total + (Array.isArray(data?.[storeName]) ? data[storeName].length : 0);
  }, 0);
}

function fuwaRecoveryDeclaredCount(backup) {
  const value = Number(backup?.recordCount);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function fuwaRecoveryWithTimeout(promise, ms = FUWA_RECOVERY_READ_TIMEOUT_MS) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) window.clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error("fuwa-recovery-timeout")), ms);
    })
  ]);
}

async function fuwaRecoveryReadRemote(uid) {
  if (!uid) return null;
  const [appModule, firestoreModule] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FUWA_RECOVERY_FIREBASE_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FUWA_RECOVERY_FIREBASE_VERSION}/firebase-firestore.js`)
  ]);
  const app = appModule.getApp();
  const db = firestoreModule.getFirestore(app);
  const ref = firestoreModule.doc(db, "users", uid, "backups", "current");
  const snapshot = await fuwaRecoveryWithTimeout(
    firestoreModule.getDoc(ref),
    FUWA_RECOVERY_READ_TIMEOUT_MS
  );
  return snapshot.exists() ? snapshot.data() : null;
}

async function fuwaRecoveryLocalSummary() {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (typeof window.fuwaGetLocalCloudSummary === "function") {
      try {
        return await window.fuwaGetLocalCloudSummary();
      } catch (_) {
        return null;
      }
    }
    await new Promise(resolve => window.setTimeout(resolve, 50));
  }
  return null;
}

function fuwaRecoveryReadLegacy() {
  try {
    const raw = localStorage.getItem(FUWA_RECOVERY_LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const data = {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      tinyJoys: Array.isArray(parsed.tinyJoys) ? parsed.tinyJoys : [],
      letters: Array.isArray(parsed.letters) ? parsed.letters : []
    };
    const recordCount = data.entries.length + data.tinyJoys.length + data.letters.length;
    return recordCount > 0 ? { data, recordCount } : null;
  } catch (error) {
    console.warn("Fuwa could not inspect its older local recovery copy.", error);
    return null;
  }
}

function fuwaRecoveryRemoteIsValid(remote, uid) {
  if (!remote || typeof remote !== "object") return false;
  if (remote.app !== "Fuwa" || remote.backupFormat !== "fuwa-cloud-v1" || !remote.data) return false;
  if (uid && remote.ownerUid && remote.ownerUid !== uid) return false;
  return true;
}

function fuwaRecoveryDescribe(remote, local, legacy) {
  const declaredCount = fuwaRecoveryDeclaredCount(remote);
  const actualCount = fuwaRecoveryRemoteIsValid(remote, fuwaRecoveryUid)
    ? fuwaRecoveryCount(remote.data)
    : 0;
  const localCount = Number(local?.recordCount || 0);
  const localEmpty = !local?.hasJournalData || localCount === 0;
  const legacyCount = Number(legacy?.recordCount || 0);

  if (remote && !fuwaRecoveryRemoteIsValid(remote, fuwaRecoveryUid)) {
    return { mode: "invalid-cloud", remote, declaredCount, actualCount: 0, local, localCount, legacy, legacyCount };
  }

  if (remote && actualCount > 0 && declaredCount !== actualCount) {
    return {
      mode: "cloud-metadata-recovery",
      remote,
      declaredCount,
      actualCount,
      local,
      localCount,
      legacy,
      legacyCount
    };
  }

  if (remote && actualCount === 0 && declaredCount !== null && declaredCount > 0) {
    return {
      mode: "cloud-data-missing",
      remote,
      declaredCount,
      actualCount,
      local,
      localCount,
      legacy,
      legacyCount
    };
  }

  if ((!remote || actualCount === 0) && localEmpty && legacyCount > 0) {
    return {
      mode: "legacy-local-recovery",
      remote,
      declaredCount,
      actualCount,
      local,
      localCount,
      legacy,
      legacyCount
    };
  }

  if (remote && actualCount === 0 && localCount > 0) {
    return {
      mode: "local-data-intact",
      remote,
      declaredCount,
      actualCount,
      local,
      localCount,
      legacy,
      legacyCount
    };
  }

  if (remote && actualCount === 0) {
    return {
      mode: "empty-cloud",
      remote,
      declaredCount,
      actualCount,
      local,
      localCount,
      legacy,
      legacyCount
    };
  }

  if (!remote && localEmpty && legacyCount === 0) {
    return {
      mode: "no-cloud-no-legacy",
      remote: null,
      declaredCount: null,
      actualCount: 0,
      local,
      localCount,
      legacy: null,
      legacyCount: 0
    };
  }

  return {
    mode: "normal",
    remote,
    declaredCount,
    actualCount,
    local,
    localCount,
    legacy,
    legacyCount
  };
}

function fuwaRecoveryWriteBaseline(uid, backup) {
  if (!uid || !backup?.backupId) return;
  try {
    const all = JSON.parse(localStorage.getItem(FUWA_RECOVERY_BASELINE_KEY) || "{}");
    all[uid] = {
      backupId: backup.backupId,
      backedUpAtClient: backup.backedUpAtClient || null,
      sourceDeviceId: backup.sourceDeviceId || null,
      savedAt: Date.now(),
      recoveredFromMetadataMismatch: true
    };
    localStorage.setItem(FUWA_RECOVERY_BASELINE_KEY, JSON.stringify(all));
  } catch (error) {
    console.warn("Fuwa restored the backup but could not save its recovery baseline.", error);
  }
}

function fuwaRecoveryBuildLegacyPayload(state) {
  const legacyData = state?.legacy?.data || {};
  const data = Object.fromEntries(FUWA_RECOVERY_STORE_NAMES.map(storeName => [storeName, []]));
  data.entries = Array.isArray(legacyData.entries) ? legacyData.entries : [];
  data.tinyJoys = Array.isArray(legacyData.tinyJoys) ? legacyData.tinyJoys : [];
  data.letters = Array.isArray(legacyData.letters) ? legacyData.letters : [];

  return {
    app: "Fuwa",
    schemaVersion: 1,
    backupFormat: "fuwa-cloud-v1",
    backupId: `legacy-recovery-${Date.now()}`,
    createdAt: new Date().toISOString(),
    recordCount: fuwaRecoveryCount(data),
    data
  };
}

function fuwaRecoveryCorrectCloudPayload(state) {
  return {
    ...state.remote,
    recordCount: state.actualCount,
    recoveryOriginalRecordCount: state.declaredCount,
    recoveryReason: "record-count-metadata-mismatch"
  };
}

function fuwaRecoverySetText(id, text) {
  const node = document.getElementById(id);
  if (node && node.textContent !== text) node.textContent = text;
}

function fuwaRecoveryRender(state = fuwaRecoveryState) {
  if (!state) return;
  const modal = document.getElementById("cloudRestoreModal");
  if (!modal || modal.classList.contains("hidden")) return;

  const button = document.getElementById("cloudRestoreConfirmButton");

  if (state.mode === "cloud-metadata-recovery") {
    fuwaRecoverySetText(
      "cloudRestoreSummary",
      `Fuwa found ${state.actualCount} recoverable record${state.actualCount === 1 ? "" : "s"} inside this cloud backup. Its saved count is wrong, so Recovery Mode will use the actual backup contents.`
    );
    fuwaRecoverySetText("cloudRestoreRecords", `${state.actualCount} recoverable record${state.actualCount === 1 ? "" : "s"}`);
    if (button && !fuwaRecoveryRunning) {
      button.disabled = false;
      button.textContent = "Recover safely";
    }
    return;
  }

  if (state.mode === "legacy-local-recovery") {
    fuwaRecoverySetText(
      "cloudRestoreSummary",
      `The current cloud copy is empty, but Fuwa found ${state.legacyCount} older local record${state.legacyCount === 1 ? "" : "s"} still stored on this device. Recovery Mode can restore those safely.`
    );
    fuwaRecoverySetText("cloudRestoreRecords", `${state.legacyCount} local record${state.legacyCount === 1 ? "" : "s"} found`);
    if (button && !fuwaRecoveryRunning) {
      button.disabled = false;
      button.textContent = "Recover local copy";
    }
    return;
  }

  if (state.mode === "cloud-data-missing") {
    fuwaRecoverySetText(
      "cloudRestoreSummary",
      `This cloud copy says it has ${state.declaredCount} record${state.declaredCount === 1 ? "" : "s"}, but its actual journal arrays are empty. Fuwa will not overwrite this device with a corrupted copy.`
    );
    fuwaRecoverySetText("cloudRestoreRecords", "0 recoverable records");
    if (button && !fuwaRecoveryRunning) {
      button.disabled = false;
      button.textContent = "Check again";
    }
    return;
  }

  if (state.mode === "local-data-intact") {
    fuwaRecoverySetText(
      "cloudRestoreSummary",
      `The cloud copy is empty, but this device still has ${state.localCount} local record${state.localCount === 1 ? "" : "s"}. Fuwa will keep the device copy unchanged.`
    );
    fuwaRecoverySetText("cloudRestoreRecords", "Cloud: 0 recoverable records");
    if (button && !fuwaRecoveryRunning) {
      button.disabled = false;
      button.textContent = "Check again";
    }
    return;
  }

  if (state.mode === "empty-cloud") {
    fuwaRecoverySetText(
      "cloudRestoreSummary",
      "Fuwa checked the actual arrays inside this cloud document. It currently contains 0 recoverable journal records."
    );
    fuwaRecoverySetText("cloudRestoreRecords", "0 recoverable records");
    if (button && !fuwaRecoveryRunning) {
      button.disabled = false;
      button.textContent = "Check again";
    }
  }
}

async function fuwaRecoveryScan(reason = "manual") {
  if (!fuwaRecoveryUid) return null;
  if (fuwaRecoveryScanPromise) return fuwaRecoveryScanPromise;

  fuwaRecoveryScanPromise = (async () => {
    const [local, remoteResult] = await Promise.all([
      fuwaRecoveryLocalSummary(),
      fuwaRecoveryReadRemote(fuwaRecoveryUid)
        .then(remote => ({ remote, error: null }))
        .catch(error => ({ remote: null, error }))
    ]);

    if (remoteResult.error) {
      console.warn(`Fuwa recovery scan deferred (${reason}).`, remoteResult.error?.message || remoteResult.error);
      return fuwaRecoveryState;
    }

    const legacy = fuwaRecoveryReadLegacy();
    fuwaRecoveryState = fuwaRecoveryDescribe(remoteResult.remote, local, legacy);
    fuwaRecoveryRender(fuwaRecoveryState);
    return fuwaRecoveryState;
  })().finally(() => {
    fuwaRecoveryScanPromise = null;
  });

  return fuwaRecoveryScanPromise;
}

async function fuwaRecoveryWaitForEngine() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (
      typeof window.fuwaCreateRestoreSafetyBackup === "function" &&
      typeof window.fuwaRestoreSafetyBackup === "function" &&
      typeof window.fuwaApplyCloudRestorePayload === "function"
    ) return true;
    await new Promise(resolve => window.setTimeout(resolve, 50));
  }
  return false;
}

async function fuwaRecoveryRun(state) {
  if (fuwaRecoveryRunning || !state) return;
  const button = document.getElementById("cloudRestoreConfirmButton");
  const cancel = document.getElementById("cloudRestoreCancelButton");
  let safetyBackup = null;
  let restoreStarted = false;

  fuwaRecoveryRunning = true;
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Preparing recovery…";
  }
  if (cancel) cancel.disabled = true;

  try {
    const ready = await fuwaRecoveryWaitForEngine();
    if (!ready) throw new Error("recovery-engine-not-ready");

    // Re-read immediately before a cloud recovery so we never restore stale data.
    let freshState = state;
    if (state.mode === "cloud-metadata-recovery") {
      const remote = await fuwaRecoveryReadRemote(fuwaRecoveryUid);
      const local = await fuwaRecoveryLocalSummary();
      freshState = fuwaRecoveryDescribe(remote, local, fuwaRecoveryReadLegacy());
      fuwaRecoveryState = freshState;
      if (freshState.mode !== "cloud-metadata-recovery" || freshState.actualCount <= 0) {
        throw new Error("recoverable-cloud-changed");
      }
    }

    if (button) button.textContent = "Protecting this device…";
    safetyBackup = await window.fuwaCreateRestoreSafetyBackup();

    const payload = freshState.mode === "cloud-metadata-recovery"
      ? fuwaRecoveryCorrectCloudPayload(freshState)
      : fuwaRecoveryBuildLegacyPayload(freshState);

    if (button) button.textContent = "Recovering & verifying…";
    restoreStarted = true;
    const result = await window.fuwaApplyCloudRestorePayload(payload);
    if (!result?.ok || Number(result.recordCount || 0) !== Number(payload.recordCount || 0)) {
      throw new Error("recovery-verification-failed");
    }

    if (freshState.mode === "cloud-metadata-recovery") {
      fuwaRecoveryWriteBaseline(fuwaRecoveryUid, freshState.remote);
    }
    try { window.FuwaCloudBackupSafety?.clearGuard?.(); } catch (_) {}

    fuwaRecoveryRunning = false;
    if (button) button.removeAttribute("aria-busy");

    const sourceLabel = freshState.mode === "cloud-metadata-recovery"
      ? "cloud backup"
      : "older local Fuwa copy";
    window.alert(`Fuwa recovered ${result.recordCount} record${result.recordCount === 1 ? "" : "s"} from the ${sourceLabel} successfully. ☁️`);
    window.setTimeout(() => window.location.reload(), 250);
  } catch (error) {
    console.error("Fuwa recovery mode failed.", error?.name || "Error", error?.message || error);

    let rollbackOk = false;
    let safetyDownloadAttempted = false;
    if (restoreStarted && safetyBackup) {
      try {
        const rollback = await window.fuwaRestoreSafetyBackup(safetyBackup);
        rollbackOk = rollback?.ok === true;
      } catch (rollbackError) {
        console.error("Fuwa recovery rollback failed.", rollbackError?.name || "Error", rollbackError?.message || rollbackError);
      }
    }
    if (restoreStarted && safetyBackup && !rollbackOk && typeof window.fuwaDownloadRestoreSafetyBackup === "function") {
      try {
        await window.fuwaDownloadRestoreSafetyBackup(safetyBackup);
        safetyDownloadAttempted = true;
      } catch (downloadError) {
        console.error("Fuwa could not download its recovery safety copy.", downloadError);
      }
    }

    const message = error?.message === "recoverable-cloud-changed"
      ? "The cloud copy changed while Fuwa was checking it, so recovery stopped before replacing anything. Open Restore and check again."
      : rollbackOk
        ? "Fuwa couldn't complete Recovery Mode, so it restored the device safety copy. Your previous device data is unchanged."
        : safetyDownloadAttempted
          ? "Fuwa couldn't complete Recovery Mode or roll back automatically. A safety copy was prepared for download; please keep it and don't clear Fuwa data."
          : "Fuwa couldn't complete Recovery Mode. Nothing was intentionally removed; please don't clear or uninstall Fuwa.";
    window.alert(message);
  } finally {
    fuwaRecoveryRunning = false;
    if (button) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.textContent = "Check again";
    }
    if (cancel) cancel.disabled = false;
    void fuwaRecoveryScan("after-recovery-attempt");
  }
}

async function fuwaRecoveryHandleConfirm(button) {
  const state = await fuwaRecoveryScan("restore-confirm");
  if (!state) {
    fuwaRecoveryBypassNextConfirm = true;
    window.queueMicrotask(() => button.click());
    return;
  }

  if (state.mode === "cloud-metadata-recovery" || state.mode === "legacy-local-recovery") {
    await fuwaRecoveryRun(state);
    return;
  }

  if (["empty-cloud", "cloud-data-missing", "local-data-intact", "no-cloud-no-legacy"].includes(state.mode)) {
    fuwaRecoveryRender(state);
    const message = state.mode === "local-data-intact"
      ? `Fuwa checked the cloud contents: the cloud copy has 0 recoverable records, while this device still has ${state.localCount}. Fuwa kept the device copy unchanged.`
      : state.mode === "cloud-data-missing"
        ? "Fuwa checked the cloud contents: its metadata claims records exist, but the actual journal arrays are empty. Fuwa will not restore that corrupted copy."
        : "Fuwa checked the cloud document itself and found 0 recoverable journal records in its stored arrays.";
    window.alert(message);
    return;
  }

  fuwaRecoveryBypassNextConfirm = true;
  window.queueMicrotask(() => button.click());
}

function fuwaRecoveryWatchModal() {
  const modal = document.getElementById("cloudRestoreModal");
  if (!modal || fuwaRecoveryObserver) return;
  fuwaRecoveryObserver = new MutationObserver(() => {
    if (fuwaRecoveryRunning) return;
    window.queueMicrotask(() => fuwaRecoveryRender());
  });
  fuwaRecoveryObserver.observe(modal, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
}

function fuwaRecoveryHandleAuth(detail = {}) {
  fuwaRecoveryUid = detail?.user?.uid || "";
  fuwaRecoveryState = null;
  if (!fuwaRecoveryUid) return;
  void fuwaRecoveryScan("auth-ready");
}

document.addEventListener("click", event => {
  const openButton = event.target?.closest?.("#cloudRestoreButton");
  if (openButton && fuwaRecoveryUid) {
    window.setTimeout(() => {
      fuwaRecoveryWatchModal();
      void fuwaRecoveryScan("restore-open");
    }, 0);
    return;
  }

  const confirmButton = event.target?.closest?.("#cloudRestoreConfirmButton");
  if (!confirmButton || !fuwaRecoveryUid) return;

  if (fuwaRecoveryBypassNextConfirm) {
    fuwaRecoveryBypassNextConfirm = false;
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  void fuwaRecoveryHandleConfirm(confirmButton);
}, true);

window.addEventListener("fuwa-auth-ready", event => {
  fuwaRecoveryHandleAuth(event?.detail || {});
});

window.addEventListener("fuwa-firestore-ready", event => {
  if (!event?.detail?.connected || !event?.detail?.uid) return;
  fuwaRecoveryUid = event.detail.uid;
  void fuwaRecoveryScan("firestore-ready");
});

window.addEventListener("pageshow", () => {
  if (fuwaRecoveryUid) void fuwaRecoveryScan("pageshow");
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && fuwaRecoveryUid) {
    void fuwaRecoveryScan("resume");
  }
});

if (window.__fuwaCloudSafetyLastAuthDetail) {
  fuwaRecoveryHandleAuth(window.__fuwaCloudSafetyLastAuthDetail);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", fuwaRecoveryWatchModal, { once: true });
} else {
  fuwaRecoveryWatchModal();
}

window.FuwaCloudRestoreRecovery = {
  scan: () => fuwaRecoveryScan("manual-debug"),
  state: () => fuwaRecoveryState,
  countCloudData: fuwaRecoveryCount,
  readLegacy: fuwaRecoveryReadLegacy,
  describe: fuwaRecoveryDescribe,
  correctCloudPayload: fuwaRecoveryCorrectCloudPayload,
  buildLegacyPayload: fuwaRecoveryBuildLegacyPayload
};
