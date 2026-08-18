// FUWA V114 — VERSIONED CLOUD BACKUP HISTORY
// Adds retained, chunked backup history without replacing the existing
// users/{uid}/backups/current document. The current backup remains backward-compatible.

const FUWA_HISTORY_FIREBASE_VERSION = "12.16.0";
const FUWA_HISTORY_STORE_NAMES = [
  "entries", "tinyJoys", "letters", "moodCheckins", "threads", "bookmarks",
  "nightlyReflections", "thenNow", "comfortItems", "unsentLetters",
  "thoughtBubbles", "dreams", "dailyCheckins", "lifeCollections",
  "habitDefinitions", "moments", "randomThoughts"
];
const FUWA_HISTORY_MAX_BACKUPS = 14;
const FUWA_HISTORY_CHUNK_CHAR_LIMIT = 170000;
const FUWA_HISTORY_PREFIX = "history_";
const FUWA_HISTORY_META_KEY = "fuwaCloudHistoryMetaV1";
const FUWA_HISTORY_DAILY_KEY = "fuwaCloudHistoryDailyV1";
const FUWA_HISTORY_CORE_DAILY_KEY = "fuwaDailyCloudBackupV1";
const FUWA_HISTORY_PENDING_KEY = "fuwaCloudPendingV1";
const FUWA_HISTORY_BASELINE_KEY = "fuwaCloudBaselineV1";
const FUWA_HISTORY_DEVICE_ID_KEY = "fuwaCloudDeviceIdV1";
const FUWA_HISTORY_HOUR = 8;
const FUWA_HISTORY_READ_TIMEOUT_MS = 12000;
const FUWA_HISTORY_DESTRUCTIVE_MIN_REMOTE = 12;
const FUWA_HISTORY_DESTRUCTIVE_RATIO = 0.25;
const FUWA_HISTORY_DESTRUCTIVE_MIN_LOSS = 10;

let fuwaHistoryUid = "";
let fuwaHistoryUserEmail = "";
let fuwaHistoryApp = null;
let fuwaHistoryDb = null;
let fuwaHistoryFs = null;
let fuwaHistoryInitPromise = null;
let fuwaHistoryBootstrapPromise = null;
let fuwaHistoryDailyTimer = null;
let fuwaHistoryDailyRetryTimer = null;
let fuwaHistoryBusy = false;
let fuwaHistoryRestoreRunning = false;
let fuwaHistoryLocalChangeRunning = false;
let fuwaHistoryQueuedLocalDetail = null;
let fuwaHistoryManualIntent = false;
let fuwaHistoryManualSafetyBypass = false;
let fuwaHistoryLatestSafeCount = null;
let fuwaHistoryLatestSafeBackupId = "";
let fuwaHistoryStylesReady = false;

function fuwaHistoryReadJson(key, fallback = {}) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value && typeof value === "object" ? value : fallback;
  } catch (_) {
    return fallback;
  }
}

function fuwaHistoryWriteJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (error) { console.warn("Fuwa could not save backup-history state.", error); }
}

function fuwaHistoryReadMeta(uid = fuwaHistoryUid) {
  const all = fuwaHistoryReadJson(FUWA_HISTORY_META_KEY, {});
  return uid ? (all?.[uid] || {}) : {};
}

function fuwaHistoryWriteMeta(uid, patch = {}) {
  if (!uid) return {};
  const all = fuwaHistoryReadJson(FUWA_HISTORY_META_KEY, {});
  all[uid] = { ...(all?.[uid] || {}), ...patch, updatedAt: Date.now() };
  fuwaHistoryWriteJson(FUWA_HISTORY_META_KEY, all);
  return all[uid];
}

function fuwaHistoryDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fuwaHistoryDailyTarget(date = new Date()) {
  const target = new Date(date);
  target.setHours(FUWA_HISTORY_HOUR, 0, 0, 0);
  return target;
}

function fuwaHistoryMsUntilNext8(date = new Date()) {
  const target = fuwaHistoryDailyTarget(date);
  if (date.getTime() >= target.getTime()) target.setDate(target.getDate() + 1);
  return Math.max(1000, target.getTime() - date.getTime());
}

function fuwaHistoryReadDaily(uid = fuwaHistoryUid) {
  const all = fuwaHistoryReadJson(FUWA_HISTORY_DAILY_KEY, {});
  return uid ? (all?.[uid] || null) : null;
}

function fuwaHistoryWriteDaily(uid, value) {
  if (!uid) return;
  const all = fuwaHistoryReadJson(FUWA_HISTORY_DAILY_KEY, {});
  all[uid] = value;
  fuwaHistoryWriteJson(FUWA_HISTORY_DAILY_KEY, all);
}

function fuwaHistoryCountData(data) {
  if (!data || typeof data !== "object") return 0;
  return FUWA_HISTORY_STORE_NAMES.reduce((total, storeName) => {
    return total + (Array.isArray(data?.[storeName]) ? data[storeName].length : 0);
  }, 0);
}

function fuwaHistoryValidPayload(payload, uid = "") {
  if (!payload || typeof payload !== "object") return false;
  if (payload.app !== "Fuwa" || payload.backupFormat !== "fuwa-cloud-v1" || !payload.data) return false;
  if (uid && payload.ownerUid && payload.ownerUid !== uid) return false;
  return true;
}

function fuwaHistoryNormalizePayload(payload, uid = fuwaHistoryUid) {
  if (!fuwaHistoryValidPayload(payload, uid)) throw new Error("fuwa-history-invalid-payload");
  const actualCount = fuwaHistoryCountData(payload.data);
  return {
    ...payload,
    ownerUid: uid || payload.ownerUid || null,
    recordCount: actualCount
  };
}

function fuwaHistoryWithTimeout(promise, ms = FUWA_HISTORY_READ_TIMEOUT_MS, code = "fuwa-history-timeout") {
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

async function fuwaHistoryEnsureFirebase() {
  if (fuwaHistoryDb && fuwaHistoryFs && fuwaHistoryApp) return true;
  if (fuwaHistoryInitPromise) return fuwaHistoryInitPromise;

  fuwaHistoryInitPromise = (async () => {
    const [appModule, firestoreModule] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FUWA_HISTORY_FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FUWA_HISTORY_FIREBASE_VERSION}/firebase-firestore.js`)
    ]);
    fuwaHistoryApp = appModule.getApp();
    fuwaHistoryDb = firestoreModule.getFirestore(fuwaHistoryApp);
    fuwaHistoryFs = firestoreModule;
    return true;
  })().catch(error => {
    console.warn("Fuwa backup history could not initialize Firestore.", error);
    return false;
  }).finally(() => {
    fuwaHistoryInitPromise = null;
  });

  return fuwaHistoryInitPromise;
}

function fuwaHistoryCollection(uid = fuwaHistoryUid) {
  return fuwaHistoryFs.collection(fuwaHistoryDb, "users", uid, "backups");
}

function fuwaHistoryDoc(uid, id) {
  return fuwaHistoryFs.doc(fuwaHistoryDb, "users", uid, "backups", id);
}

function fuwaHistoryCurrentRef(uid = fuwaHistoryUid) {
  return fuwaHistoryDoc(uid, "current");
}

function fuwaHistoryManifestId() {
  return `${FUWA_HISTORY_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function fuwaHistoryChunkId(manifestId, index) {
  return `${manifestId}_chunk_${String(index).padStart(4, "0")}`;
}

function fuwaHistorySplit(json) {
  const chunks = [];
  for (let index = 0; index < json.length; index += FUWA_HISTORY_CHUNK_CHAR_LIMIT) {
    chunks.push(json.slice(index, index + FUWA_HISTORY_CHUNK_CHAR_LIMIT));
  }
  return chunks.length ? chunks : [""];
}

async function fuwaHistorySha256(text) {
  if (!crypto?.subtle || typeof TextEncoder === "undefined") return "";
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

function fuwaHistoryFormatTime(value) {
  if (!value) return "Unknown time";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  } catch (_) {
    return date.toLocaleString();
  }
}

function fuwaHistoryKindLabel(kind) {
  switch (kind) {
    case "daily": return "8 AM";
    case "manual": return "Manual";
    case "migration": return "Protected existing copy";
    case "pre-restore": return "Pre-restore";
    case "pre-restore-cloud": return "Cloud before restore";
    case "restored": return "Restored copy";
    default: return "Safety";
  }
}

function fuwaHistorySetStatus(text) {
  const node = document.getElementById("cloudBackupHistoryStatus");
  if (node) node.textContent = text;
}

function fuwaHistorySetCloudPause(reason, localCount, remoteCount) {
  try { localStorage.removeItem(FUWA_HISTORY_PENDING_KEY); } catch (_) {}
  const auto = document.getElementById("cloudAutoSyncStatus");
  const daily = document.getElementById("cloudDailyBackupStatus");
  if (auto) auto.textContent = reason === "empty"
    ? "Paused · empty device cannot replace history"
    : "Paused · large data drop needs review";
  if (daily) daily.textContent = "Protected · version history kept";
  fuwaHistorySetStatus(
    reason === "empty"
      ? `Safety pause · device has 0, protected cloud had ${remoteCount}`
      : `Safety pause · ${remoteCount} → ${localCount} records`
  );
}

function fuwaHistoryPauseCoreDaily(uid, reason, remoteCount) {
  if (!uid) return;
  const all = fuwaHistoryReadJson(FUWA_HISTORY_CORE_DAILY_KEY, {});
  const today = fuwaHistoryDayKey();
  if (all?.[uid]?.dayKey === today && !all?.[uid]?.historySafetyGuard) return;
  all[uid] = {
    dayKey: today,
    completedAt: new Date().toISOString(),
    backupId: fuwaHistoryLatestSafeBackupId || null,
    sourceDeviceId: null,
    historySafetyGuard: true,
    safetyReason: reason,
    protectedRecordCount: Number(remoteCount || 0)
  };
  fuwaHistoryWriteJson(FUWA_HISTORY_CORE_DAILY_KEY, all);
}

function fuwaHistoryReleaseCoreDailyPause(uid = fuwaHistoryUid) {
  if (!uid) return;
  const all = fuwaHistoryReadJson(FUWA_HISTORY_CORE_DAILY_KEY, {});
  if (!all?.[uid]?.historySafetyGuard) return;
  delete all[uid];
  if (Object.keys(all).length) fuwaHistoryWriteJson(FUWA_HISTORY_CORE_DAILY_KEY, all);
  else {
    try { localStorage.removeItem(FUWA_HISTORY_CORE_DAILY_KEY); } catch (_) {}
  }
}

function fuwaHistoryIsDestructiveDrop(localCount, remoteCount) {
  const local = Number(localCount || 0);
  const remote = Number(remoteCount || 0);
  if (remote <= 0) return false;
  if (local === 0) return true;
  const lost = remote - local;
  return (
    remote >= FUWA_HISTORY_DESTRUCTIVE_MIN_REMOTE &&
    lost >= FUWA_HISTORY_DESTRUCTIVE_MIN_LOSS &&
    local < remote * FUWA_HISTORY_DESTRUCTIVE_RATIO
  );
}

async function fuwaHistoryGetLocalPayload() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (typeof window.fuwaCreateCloudBackupPayload === "function") {
      const payload = await window.fuwaCreateCloudBackupPayload();
      if (payload?.data) return fuwaHistoryNormalizePayload(payload);
    }
    await new Promise(resolve => window.setTimeout(resolve, 50));
  }
  throw new Error("fuwa-history-local-payload-unavailable");
}

async function fuwaHistoryGetLocalSummary() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (typeof window.fuwaGetLocalCloudSummary === "function") {
      try { return await window.fuwaGetLocalCloudSummary(); }
      catch (_) { return null; }
    }
    await new Promise(resolve => window.setTimeout(resolve, 50));
  }
  return null;
}

async function fuwaHistoryReadCurrent(uid = fuwaHistoryUid) {
  if (!uid || !(await fuwaHistoryEnsureFirebase())) return null;
  const snapshot = await fuwaHistoryWithTimeout(
    fuwaHistoryFs.getDoc(fuwaHistoryCurrentRef(uid)),
    FUWA_HISTORY_READ_TIMEOUT_MS,
    "fuwa-history-current-read-timeout"
  );
  return snapshot.exists() ? snapshot.data() : null;
}

async function fuwaHistoryList(uid = fuwaHistoryUid) {
  if (!uid || !(await fuwaHistoryEnsureFirebase())) return [];
  const snapshot = await fuwaHistoryWithTimeout(
    fuwaHistoryFs.getDocs(fuwaHistoryCollection(uid)),
    FUWA_HISTORY_READ_TIMEOUT_MS,
    "fuwa-history-list-timeout"
  );
  return snapshot.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .filter(item => item.docType === "history-manifest" && item.historyVersion === 1)
    .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
}

async function fuwaHistoryDelete(uid, manifest) {
  if (!uid || !manifest?.id) return;
  const batch = fuwaHistoryFs.writeBatch(fuwaHistoryDb);
  const chunkCount = Math.max(0, Number(manifest.chunkCount || 0));
  for (let index = 0; index < chunkCount; index += 1) {
    batch.delete(fuwaHistoryDoc(uid, fuwaHistoryChunkId(manifest.id, index)));
  }
  batch.delete(fuwaHistoryDoc(uid, manifest.id));
  await batch.commit();
}

async function fuwaHistoryPrune(uid = fuwaHistoryUid) {
  const items = await fuwaHistoryList(uid);
  const extras = items.slice(FUWA_HISTORY_MAX_BACKUPS);
  for (const item of extras) {
    try { await fuwaHistoryDelete(uid, item); }
    catch (error) { console.warn("Fuwa could not prune an old backup-history copy.", error); }
  }
}

async function fuwaHistoryArchivePayload(payload, kind = "safety", options = {}) {
  if (!fuwaHistoryUid || fuwaHistoryBusy) return null;
  if (!(await fuwaHistoryEnsureFirebase())) throw new Error("fuwa-history-firestore-unavailable");

  const normalized = fuwaHistoryNormalizePayload(payload);
  const actualCount = Number(normalized.recordCount || 0);
  if (actualCount === 0 && !options.allowEmpty) return null;

  const existing = await fuwaHistoryList(fuwaHistoryUid);
  const sourceBackupId = options.sourceBackupId || normalized.backupId || "";
  if (sourceBackupId && existing.some(item => item.sourceBackupId === sourceBackupId)) {
    return existing.find(item => item.sourceBackupId === sourceBackupId) || null;
  }

  fuwaHistoryBusy = true;
  try {
    const historyPayload = {
      ...normalized,
      recordCount: actualCount,
      historyCapturedAt: new Date().toISOString()
    };
    const json = JSON.stringify(historyPayload);
    const chunks = fuwaHistorySplit(json);
    const hash = await fuwaHistorySha256(json);
    const id = fuwaHistoryManifestId();
    const createdAtMs = Date.now();
    const manifest = {
      docType: "history-manifest",
      historyVersion: 1,
      ownerUid: fuwaHistoryUid,
      kind,
      createdAtMs,
      createdAt: fuwaHistoryFs.serverTimestamp(),
      recordCount: actualCount,
      chunkCount: chunks.length,
      charLength: json.length,
      byteLength: typeof TextEncoder !== "undefined" ? new TextEncoder().encode(json).byteLength : json.length,
      sha256: hash || null,
      sourceBackupId: sourceBackupId || null,
      sourceDeviceId: normalized.sourceDeviceId || null,
      sourceBackedUpAtClient: normalized.backedUpAtClient || normalized.createdAt || null,
      sourceSyncReason: normalized.syncReason || null,
      app: "Fuwa",
      backupFormat: "fuwa-cloud-v1"
    };

    const batch = fuwaHistoryFs.writeBatch(fuwaHistoryDb);
    batch.set(fuwaHistoryDoc(fuwaHistoryUid, id), manifest);
    chunks.forEach((data, index) => {
      batch.set(fuwaHistoryDoc(fuwaHistoryUid, fuwaHistoryChunkId(id, index)), {
        docType: "history-chunk",
        historyVersion: 1,
        ownerUid: fuwaHistoryUid,
        parentId: id,
        index,
        data
      });
    });
    await batch.commit();

    fuwaHistoryLatestSafeCount = actualCount;
    fuwaHistoryLatestSafeBackupId = sourceBackupId || id;
    fuwaHistoryWriteMeta(fuwaHistoryUid, {
      latestSafeCount: actualCount,
      latestSafeBackupId: fuwaHistoryLatestSafeBackupId,
      lastHistoryId: id,
      lastHistoryAt: createdAtMs,
      lastHistoryKind: kind
    });

    if (!options.skipPrune) await fuwaHistoryPrune(fuwaHistoryUid);
    await fuwaHistoryRefreshStatus();
    return { id, ...manifest };
  } finally {
    fuwaHistoryBusy = false;
  }
}

async function fuwaHistoryArchiveCurrent(kind = "migration") {
  const remote = await fuwaHistoryReadCurrent();
  if (!fuwaHistoryValidPayload(remote, fuwaHistoryUid)) return null;
  const normalized = fuwaHistoryNormalizePayload(remote);
  if (normalized.recordCount <= 0) return null;
  return fuwaHistoryArchivePayload(normalized, kind, {
    sourceBackupId: remote.backupId || ""
  });
}

async function fuwaHistoryFetchPayload(manifest) {
  if (!manifest?.id || !fuwaHistoryUid) throw new Error("fuwa-history-backup-not-found");
  if (!(await fuwaHistoryEnsureFirebase())) throw new Error("fuwa-history-firestore-unavailable");

  const chunkCount = Number(manifest.chunkCount || 0);
  if (!Number.isInteger(chunkCount) || chunkCount <= 0 || chunkCount > 20) {
    throw new Error("fuwa-history-invalid-chunk-count");
  }

  const reads = [];
  for (let index = 0; index < chunkCount; index += 1) {
    reads.push(fuwaHistoryFs.getDoc(fuwaHistoryDoc(
      fuwaHistoryUid,
      fuwaHistoryChunkId(manifest.id, index)
    )));
  }
  const snapshots = await fuwaHistoryWithTimeout(
    Promise.all(reads),
    FUWA_HISTORY_READ_TIMEOUT_MS,
    "fuwa-history-chunk-read-timeout"
  );

  const parts = snapshots.map((snapshot, index) => {
    if (!snapshot.exists()) throw new Error(`fuwa-history-missing-chunk-${index}`);
    const data = snapshot.data();
    if (data?.parentId !== manifest.id || Number(data?.index) !== index) {
      throw new Error(`fuwa-history-invalid-chunk-${index}`);
    }
    return String(data?.data || "");
  });

  const json = parts.join("");
  if (Number(manifest.charLength || 0) && json.length !== Number(manifest.charLength)) {
    throw new Error("fuwa-history-length-mismatch");
  }
  if (manifest.sha256) {
    const hash = await fuwaHistorySha256(json);
    if (hash && hash !== manifest.sha256) throw new Error("fuwa-history-hash-mismatch");
  }

  const parsed = JSON.parse(json);
  const normalized = fuwaHistoryNormalizePayload(parsed);
  if (Number(manifest.recordCount || 0) !== Number(normalized.recordCount || 0)) {
    throw new Error("fuwa-history-record-count-mismatch");
  }
  return normalized;
}

function fuwaHistoryDeviceId() {
  try {
    let id = localStorage.getItem(FUWA_HISTORY_DEVICE_ID_KEY);
    if (!id) {
      id = crypto?.randomUUID?.() || `device_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(FUWA_HISTORY_DEVICE_ID_KEY, id);
    }
    return id;
  } catch (_) {
    return "";
  }
}

function fuwaHistoryWriteBaseline(uid, backup) {
  if (!uid || !backup?.backupId) return;
  const all = fuwaHistoryReadJson(FUWA_HISTORY_BASELINE_KEY, {});
  all[uid] = {
    backupId: backup.backupId,
    backedUpAtClient: backup.backedUpAtClient || null,
    sourceDeviceId: backup.sourceDeviceId || null,
    savedAt: Date.now(),
    restoredFromHistory: true
  };
  fuwaHistoryWriteJson(FUWA_HISTORY_BASELINE_KEY, all);
}

async function fuwaHistoryRestore(manifest) {
  if (fuwaHistoryRestoreRunning || !manifest?.id || !fuwaHistoryUid) return;

  const confirmed = window.confirm(
    `Restore the ${fuwaHistoryFormatTime(manifest.createdAtMs)} backup with ${Number(manifest.recordCount || 0)} record${Number(manifest.recordCount || 0) === 1 ? "" : "s"}?\n\n` +
    "Fuwa will create a pre-restore history copy and a local rollback snapshot first."
  );
  if (!confirmed) return;

  fuwaHistoryRestoreRunning = true;
  fuwaHistoryRenderBusy(true, "Preparing safe restore…");
  let localSafety = null;
  let restoreStarted = false;

  try {
    const [payload, localPayload, currentRemote] = await Promise.all([
      fuwaHistoryFetchPayload(manifest),
      fuwaHistoryGetLocalPayload().catch(() => null),
      fuwaHistoryReadCurrent().catch(() => null)
    ]);

    if (localPayload?.recordCount > 0) {
      await fuwaHistoryArchivePayload(localPayload, "pre-restore", {
        sourceBackupId: `local_${Date.now()}`,
        skipPrune: true
      });
    }
    if (fuwaHistoryValidPayload(currentRemote, fuwaHistoryUid) && fuwaHistoryCountData(currentRemote.data) > 0) {
      await fuwaHistoryArchivePayload(
        fuwaHistoryNormalizePayload(currentRemote),
        "pre-restore-cloud",
        { sourceBackupId: currentRemote.backupId || `cloud_${Date.now()}`, skipPrune: true }
      );
    }

    if (
      typeof window.fuwaCreateRestoreSafetyBackup !== "function" ||
      typeof window.fuwaRestoreSafetyBackup !== "function" ||
      typeof window.fuwaApplyCloudRestorePayload !== "function"
    ) {
      throw new Error("fuwa-history-restore-engine-unavailable");
    }

    localSafety = await window.fuwaCreateRestoreSafetyBackup();
    fuwaHistoryRenderBusy(true, "Restoring & verifying…");
    restoreStarted = true;
    const result = await window.fuwaApplyCloudRestorePayload(payload);
    if (!result?.ok || Number(result.recordCount || 0) !== Number(payload.recordCount || 0)) {
      throw new Error("fuwa-history-restore-verification-failed");
    }

    const restoredBackupId = `restore_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const restoredCurrent = {
      ...payload,
      backupId: restoredBackupId,
      ownerUid: fuwaHistoryUid,
      sourceDeviceId: fuwaHistoryDeviceId(),
      backedUpAt: fuwaHistoryFs.serverTimestamp(),
      backedUpAtClient: new Date().toISOString(),
      syncReason: "history-restore"
    };
    const serialized = JSON.stringify({ ...restoredCurrent, backedUpAt: null });
    const approximateBytes = typeof TextEncoder !== "undefined"
      ? new TextEncoder().encode(serialized).byteLength
      : serialized.length;
    if (approximateBytes > 900000) throw new Error("fuwa-history-restored-current-too-large");
    restoredCurrent.approximateBytes = approximateBytes;

    await fuwaHistoryFs.setDoc(fuwaHistoryCurrentRef(), restoredCurrent);
    fuwaHistoryWriteBaseline(fuwaHistoryUid, restoredCurrent);
    try { window.FuwaCloudBackupSafety?.clearGuard?.(); } catch (_) {}
    fuwaHistoryReleaseCoreDailyPause();

    fuwaHistoryLatestSafeCount = Number(payload.recordCount || 0);
    fuwaHistoryLatestSafeBackupId = restoredBackupId;
    fuwaHistoryWriteMeta(fuwaHistoryUid, {
      latestSafeCount: fuwaHistoryLatestSafeCount,
      latestSafeBackupId: restoredBackupId,
      lastRestoreHistoryId: manifest.id,
      lastRestoreAt: Date.now()
    });

    await fuwaHistoryArchivePayload(
      { ...restoredCurrent, backedUpAt: null },
      "restored",
      { sourceBackupId: restoredBackupId }
    );
    await fuwaHistoryPrune();

    window.alert(`Fuwa restored ${result.recordCount} record${result.recordCount === 1 ? "" : "s"} from backup history successfully. ☁️`);
    window.setTimeout(() => window.location.reload(), 250);
  } catch (error) {
    console.error("Fuwa backup-history restore failed.", error?.message || error);
    let rollbackOk = false;
    if (restoreStarted && localSafety) {
      try {
        const rollback = await window.fuwaRestoreSafetyBackup(localSafety);
        rollbackOk = rollback?.ok === true;
      } catch (rollbackError) {
        console.error("Fuwa history restore rollback failed.", rollbackError);
      }
    }
    window.alert(
      rollbackOk
        ? "Fuwa couldn't complete that history restore, so the device was rolled back to its pre-restore state."
        : "Fuwa couldn't complete that history restore. No history backup was deleted."
    );
  } finally {
    fuwaHistoryRestoreRunning = false;
    fuwaHistoryRenderBusy(false);
    await fuwaHistoryRefreshModal().catch(() => {});
  }
}

function fuwaHistoryEnsureStyles() {
  if (fuwaHistoryStylesReady || document.getElementById("fuwaBackupHistoryStyles")) return;
  fuwaHistoryStylesReady = true;
  const style = document.createElement("style");
  style.id = "fuwaBackupHistoryStyles";
  style.textContent = `
    .fuwa-history-status{display:block;margin-top:8px;color:#8b747b;font-size:11px;line-height:1.4}
    .fuwa-history-modal{position:fixed;z-index:2147482100;inset:0;background:rgba(61,47,54,.38);backdrop-filter:blur(7px);display:grid;align-items:end}
    .fuwa-history-modal.hidden{display:none!important}
    .fuwa-history-sheet{width:100%;max-height:88vh;overflow:auto;box-sizing:border-box;background:#fff9fb;border-radius:28px 28px 0 0;padding:18px 16px calc(20px + env(safe-area-inset-bottom,0px));box-shadow:0 -18px 45px rgba(72,51,60,.18)}
    .fuwa-history-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;position:sticky;top:-18px;z-index:2;background:linear-gradient(#fff9fb 84%,rgba(255,249,251,0));padding:18px 0 12px}
    .fuwa-history-head h2{margin:2px 0 0;font-family:Georgia,serif;color:#56434c;font-size:24px}
    .fuwa-history-head button{width:36px;height:36px;border:0;border-radius:50%;background:#f4e7ec;color:#805f6d;font-size:22px}
    .fuwa-history-intro{margin:0 0 12px;color:#7f6972;font-size:12px;line-height:1.5}
    .fuwa-history-list{display:grid;gap:10px}
    .fuwa-history-item{border:1px solid rgba(192,132,151,.24);border-radius:16px;padding:12px;background:rgba(255,255,255,.78);display:grid;gap:8px}
    .fuwa-history-item-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
    .fuwa-history-item strong{color:#654f58}
    .fuwa-history-item small{display:block;color:#907880;margin-top:3px}
    .fuwa-history-kind{font-size:10px;font-weight:800;color:#9b6878;background:#fff0f5;border-radius:999px;padding:4px 8px;white-space:nowrap}
    .fuwa-history-restore{border:1px solid rgba(192,132,151,.32);background:#fff;color:#7a5966;border-radius:11px;padding:9px 12px;font:inherit;font-weight:700;touch-action:manipulation}
    .fuwa-history-restore:disabled{opacity:.55}
    .fuwa-history-empty{padding:18px 12px;text-align:center;color:#8a747c;border:1px dashed rgba(192,132,151,.28);border-radius:14px}
  `;
  document.head.appendChild(style);
}

function fuwaHistoryEnsureUi() {
  fuwaHistoryEnsureStyles();
  const card = document.getElementById("cloudBackupCard");
  if (card && !document.getElementById("cloudBackupHistoryButton")) {
    const restore = document.getElementById("cloudRestoreButton");
    const button = document.createElement("button");
    button.className = "secondary-btn";
    button.id = "cloudBackupHistoryButton";
    button.type = "button";
    button.textContent = "View backup history";
    const status = document.createElement("small");
    status.id = "cloudBackupHistoryStatus";
    status.className = "fuwa-history-status";
    status.textContent = `Versioned history · keeps up to ${FUWA_HISTORY_MAX_BACKUPS} copies`;
    if (restore) {
      restore.insertAdjacentElement("afterend", button);
      button.insertAdjacentElement("afterend", status);
    } else {
      card.append(button, status);
    }
  }

  if (!document.getElementById("fuwaBackupHistoryModal")) {
    const modal = document.createElement("div");
    modal.id = "fuwaBackupHistoryModal";
    modal.className = "fuwa-history-modal hidden";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "fuwaBackupHistoryTitle");
    modal.innerHTML = `
      <div class="fuwa-history-sheet">
        <div class="fuwa-history-head">
          <div><p class="eyebrow">Fuwa Cloud</p><h2 id="fuwaBackupHistoryTitle">Backup history</h2></div>
          <button type="button" id="fuwaBackupHistoryClose" aria-label="Close backup history">×</button>
        </div>
        <p class="fuwa-history-intro">Fuwa keeps dated safety copies instead of relying on one replaceable cloud backup. Restoring a history copy creates another safety snapshot first.</p>
        <div id="fuwaBackupHistoryList" class="fuwa-history-list"><div class="fuwa-history-empty">Loading backup history…</div></div>
      </div>`;
    document.body.appendChild(modal);
  }
}

function fuwaHistoryRenderBusy(busy, message = "") {
  const modal = document.getElementById("fuwaBackupHistoryModal");
  if (!modal) return;
  modal.querySelectorAll(".fuwa-history-restore").forEach(button => {
    button.disabled = busy;
  });
  if (message) {
    const list = document.getElementById("fuwaBackupHistoryList");
    if (list) list.innerHTML = `<div class="fuwa-history-empty">${message}</div>`;
  }
}

async function fuwaHistoryRefreshStatus() {
  if (!fuwaHistoryUid) {
    fuwaHistorySetStatus("Versioned history is available when signed in.");
    return [];
  }
  try {
    const items = await fuwaHistoryList();
    fuwaHistorySetStatus(
      items.length
        ? `${items.length} protected cop${items.length === 1 ? "y" : "ies"} · keeps up to ${FUWA_HISTORY_MAX_BACKUPS}`
        : `Versioned history · keeps up to ${FUWA_HISTORY_MAX_BACKUPS} copies`
    );
    return items;
  } catch (error) {
    console.warn("Fuwa could not refresh backup-history status.", error);
    fuwaHistorySetStatus("Backup history unavailable · current backup unchanged");
    return [];
  }
}

async function fuwaHistoryRefreshModal() {
  fuwaHistoryEnsureUi();
  const list = document.getElementById("fuwaBackupHistoryList");
  if (!list) return;
  if (!fuwaHistoryUid) {
    list.innerHTML = `<div class="fuwa-history-empty">Sign in to view Fuwa Cloud backup history.</div>`;
    return;
  }

  list.innerHTML = `<div class="fuwa-history-empty">Loading backup history…</div>`;
  try {
    const items = await fuwaHistoryList();
    if (!items.length) {
      list.innerHTML = `<div class="fuwa-history-empty">No versioned copies yet. Fuwa will protect the next useful cloud copy automatically.</div>`;
      return;
    }
    list.replaceChildren(...items.slice(0, FUWA_HISTORY_MAX_BACKUPS).map(item => {
      const article = document.createElement("article");
      article.className = "fuwa-history-item";
      const top = document.createElement("div");
      top.className = "fuwa-history-item-top";
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = fuwaHistoryFormatTime(item.createdAtMs || item.sourceBackedUpAtClient);
      const detail = document.createElement("small");
      detail.textContent = `${Number(item.recordCount || 0)} record${Number(item.recordCount || 0) === 1 ? "" : "s"} · protected copy`;
      copy.append(title, detail);
      const kind = document.createElement("span");
      kind.className = "fuwa-history-kind";
      kind.textContent = fuwaHistoryKindLabel(item.kind);
      top.append(copy, kind);

      const restore = document.createElement("button");
      restore.className = "fuwa-history-restore";
      restore.type = "button";
      restore.textContent = "Restore this copy";
      restore.dataset.historyId = item.id;
      article.append(top, restore);
      return article;
    }));
  } catch (error) {
    console.error("Fuwa could not load backup history.", error);
    list.innerHTML = `<div class="fuwa-history-empty">Fuwa couldn't load backup history just now. The current cloud backup was not changed.</div>`;
  }
}

async function fuwaHistoryBootstrap(reason = "auth-ready") {
  if (!fuwaHistoryUid) return null;
  if (fuwaHistoryBootstrapPromise) return fuwaHistoryBootstrapPromise;

  fuwaHistoryBootstrapPromise = (async () => {
    if (!(await fuwaHistoryEnsureFirebase())) return null;

    const [current, histories] = await Promise.all([
      fuwaHistoryReadCurrent().catch(() => null),
      fuwaHistoryList().catch(() => [])
    ]);

    const usefulHistories = histories.filter(item => Number(item.recordCount || 0) > 0);
    if (usefulHistories.length) {
      fuwaHistoryLatestSafeCount = Number(usefulHistories[0].recordCount || 0);
      fuwaHistoryLatestSafeBackupId = usefulHistories[0].sourceBackupId || usefulHistories[0].id;
    }

    if (fuwaHistoryValidPayload(current, fuwaHistoryUid)) {
      const currentActual = fuwaHistoryCountData(current.data);
      if (currentActual > 0) {
        fuwaHistoryLatestSafeCount = Math.max(Number(fuwaHistoryLatestSafeCount || 0), currentActual);
        fuwaHistoryLatestSafeBackupId = current.backupId || fuwaHistoryLatestSafeBackupId;
        const alreadyArchived = current.backupId && histories.some(item => item.sourceBackupId === current.backupId);
        if (!alreadyArchived) {
          await fuwaHistoryArchivePayload(
            fuwaHistoryNormalizePayload(current),
            "migration",
            { sourceBackupId: current.backupId || `migration_${Date.now()}` }
          );
        }
      }
    }

    const meta = fuwaHistoryReadMeta();
    if (fuwaHistoryLatestSafeCount == null && Number(meta.latestSafeCount || 0) > 0) {
      fuwaHistoryLatestSafeCount = Number(meta.latestSafeCount);
      fuwaHistoryLatestSafeBackupId = meta.latestSafeBackupId || "";
    }

    await fuwaHistoryRefreshStatus();
    fuwaHistoryScheduleDaily(`bootstrap:${reason}`);
    return {
      currentCount: fuwaHistoryValidPayload(current, fuwaHistoryUid) ? fuwaHistoryCountData(current.data) : 0,
      historyCount: histories.length,
      latestSafeCount: Number(fuwaHistoryLatestSafeCount || 0)
    };
  })().catch(error => {
    console.warn(`Fuwa backup-history bootstrap deferred (${reason}).`, error?.message || error);
    return null;
  }).finally(() => {
    fuwaHistoryBootstrapPromise = null;
  });

  return fuwaHistoryBootstrapPromise;
}

async function fuwaHistoryCreateDaily(reason = "scheduled") {
  if (!fuwaHistoryUid || fuwaHistoryBusy || fuwaHistoryRestoreRunning) return false;
  const today = fuwaHistoryDayKey();
  if (fuwaHistoryReadDaily()?.dayKey === today && fuwaHistoryReadDaily()?.status === "complete") return false;

  try {
    const payload = await fuwaHistoryGetLocalPayload();
    const localCount = Number(payload.recordCount || 0);
    const safeCount = Number(fuwaHistoryLatestSafeCount || 0);

    if (safeCount > 0 && fuwaHistoryIsDestructiveDrop(localCount, safeCount)) {
      const reasonCode = localCount === 0 ? "empty" : "large-drop";
      fuwaHistoryPauseCoreDaily(fuwaHistoryUid, reasonCode, safeCount);
      fuwaHistorySetCloudPause(reasonCode === "empty" ? "empty" : "large-drop", localCount, safeCount);
      fuwaHistoryWriteDaily(fuwaHistoryUid, {
        dayKey: today,
        status: "blocked",
        reason: reasonCode,
        localCount,
        protectedCount: safeCount,
        checkedAt: new Date().toISOString()
      });
      return false;
    }

    if (localCount <= 0) {
      fuwaHistoryWriteDaily(fuwaHistoryUid, {
        dayKey: today,
        status: "empty-no-history",
        checkedAt: new Date().toISOString()
      });
      fuwaHistorySetStatus("8 AM history skipped · no journal records to protect");
      return false;
    }

    fuwaHistorySetStatus(reason === "scheduled" ? "8 AM · creating protected history…" : "Creating catch-up history…");
    const item = await fuwaHistoryArchivePayload(
      payload,
      "daily",
      { sourceBackupId: `daily_${today}_${payload.backupId || Date.now()}` }
    );
    if (!item) return false;

    fuwaHistoryWriteDaily(fuwaHistoryUid, {
      dayKey: today,
      status: "complete",
      historyId: item.id,
      recordCount: localCount,
      completedAt: new Date().toISOString()
    });
    fuwaHistoryReleaseCoreDailyPause();
    await fuwaHistoryRefreshStatus();
    return true;
  } catch (error) {
    console.warn("Fuwa 8 AM versioned history could not finish.", error);
    fuwaHistorySetStatus("8 AM history will retry when Fuwa is online");
    window.clearTimeout(fuwaHistoryDailyRetryTimer);
    fuwaHistoryDailyRetryTimer = window.setTimeout(
      () => void fuwaHistoryCreateDaily("retry"),
      60000
    );
    return false;
  }
}

function fuwaHistoryScheduleDaily(reason = "schedule") {
  window.clearTimeout(fuwaHistoryDailyTimer);
  fuwaHistoryDailyTimer = null;
  if (!fuwaHistoryUid) return;

  const now = new Date();
  const todayState = fuwaHistoryReadDaily();
  const afterEight = now.getTime() >= fuwaHistoryDailyTarget(now).getTime();

  if (afterEight && todayState?.dayKey !== fuwaHistoryDayKey(now)) {
    fuwaHistoryDailyTimer = window.setTimeout(
      () => void fuwaHistoryCreateDaily(reason === "timer" ? "scheduled" : "catch-up"),
      700
    );
    return;
  }

  if (afterEight && todayState?.dayKey === fuwaHistoryDayKey(now) && todayState?.status === "blocked") {
    return;
  }

  fuwaHistoryDailyTimer = window.setTimeout(
    () => {
      void fuwaHistoryCreateDaily("scheduled").finally(() => fuwaHistoryScheduleDaily("timer"));
    },
    fuwaHistoryMsUntilNext8(now)
  );
}

async function fuwaHistoryCheckLocalChange(detail = {}) {
  if (!fuwaHistoryUid) {
    window.dispatchEvent(new CustomEvent("fuwa-local-data-changed", {
      detail: { ...detail, fuwaHistorySafetyReplay: true }
    }));
    return;
  }

  if (fuwaHistoryLocalChangeRunning) {
    fuwaHistoryQueuedLocalDetail = detail;
    return;
  }
  fuwaHistoryLocalChangeRunning = true;

  try {
    if (fuwaHistoryLatestSafeCount == null) await fuwaHistoryBootstrap("local-change");
    const summary = await fuwaHistoryGetLocalSummary();
    const localCount = Number(summary?.recordCount || 0);
    const safeCount = Number(fuwaHistoryLatestSafeCount || fuwaHistoryReadMeta()?.latestSafeCount || 0);

    if (safeCount > 0 && fuwaHistoryIsDestructiveDrop(localCount, safeCount)) {
      const reason = localCount === 0 ? "empty" : "large-drop";
      fuwaHistoryPauseCoreDaily(fuwaHistoryUid, reason, safeCount);
      fuwaHistorySetCloudPause(reason, localCount, safeCount);
      fuwaHistoryWriteMeta(fuwaHistoryUid, {
        safetyPaused: true,
        safetyReason: reason,
        safetyLocalCount: localCount,
        safetyProtectedCount: safeCount,
        safetyPausedAt: Date.now()
      });
      return;
    }

    const meta = fuwaHistoryReadMeta();
    if (meta.safetyPaused) {
      fuwaHistoryWriteMeta(fuwaHistoryUid, {
        safetyPaused: false,
        safetyReason: null,
        safetyLocalCount: localCount
      });
      fuwaHistoryReleaseCoreDailyPause();
    }

    window.dispatchEvent(new CustomEvent("fuwa-local-data-changed", {
      detail: { ...detail, fuwaHistorySafetyReplay: true }
    }));

    const daily = fuwaHistoryReadDaily();
    const afterEight = Date.now() >= fuwaHistoryDailyTarget().getTime();
    if (
      afterEight &&
      daily?.dayKey === fuwaHistoryDayKey() &&
      ["blocked", "empty-no-history"].includes(daily?.status) &&
      localCount > 0
    ) {
      fuwaHistoryWriteDaily(fuwaHistoryUid, {
        ...daily,
        status: "retry-pending",
        retryAt: new Date().toISOString()
      });
      window.setTimeout(() => void fuwaHistoryCreateDaily("data-recovered"), 900);
    }
  } catch (error) {
    console.warn("Fuwa cloud-history safety check deferred.", error);
    window.dispatchEvent(new CustomEvent("fuwa-local-data-changed", {
      detail: { ...detail, fuwaHistorySafetyReplay: true }
    }));
  } finally {
    fuwaHistoryLocalChangeRunning = false;
    if (fuwaHistoryQueuedLocalDetail) {
      const queued = fuwaHistoryQueuedLocalDetail;
      fuwaHistoryQueuedLocalDetail = null;
      window.queueMicrotask(() => void fuwaHistoryCheckLocalChange(queued));
    }
  }
}

async function fuwaHistoryHandleBackupComplete() {
  if (!fuwaHistoryUid) return;
  try {
    const current = await fuwaHistoryReadCurrent();
    if (!fuwaHistoryValidPayload(current, fuwaHistoryUid)) return;
    const actualCount = fuwaHistoryCountData(current.data);
    if (actualCount <= 0) return;

    let kind = fuwaHistoryManualIntent ? "manual" : "safety";
    if (String(current.syncReason || "").startsWith("daily-8am:")) kind = "daily";

    await fuwaHistoryArchivePayload(
      fuwaHistoryNormalizePayload(current),
      kind,
      { sourceBackupId: current.backupId || `backup_${Date.now()}` }
    );

    fuwaHistoryManualIntent = false;
    fuwaHistoryLatestSafeCount = actualCount;
    fuwaHistoryLatestSafeBackupId = current.backupId || fuwaHistoryLatestSafeBackupId;
    fuwaHistoryWriteMeta(fuwaHistoryUid, {
      latestSafeCount: actualCount,
      latestSafeBackupId: fuwaHistoryLatestSafeBackupId,
      safetyPaused: false
    });
    fuwaHistoryReleaseCoreDailyPause();
  } catch (error) {
    console.warn("Fuwa could not add the completed cloud backup to history.", error);
  }
}

function fuwaHistoryOpenModal() {
  fuwaHistoryEnsureUi();
  const modal = document.getElementById("fuwaBackupHistoryModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  document.body.classList.add("fuwa-history-open");
  void fuwaHistoryRefreshModal();
}

function fuwaHistoryCloseModal() {
  if (fuwaHistoryRestoreRunning) return;
  document.getElementById("fuwaBackupHistoryModal")?.classList.add("hidden");
  document.body.classList.remove("fuwa-history-open");
}

function fuwaHistoryHandleAuth(detail = {}) {
  fuwaHistoryUid = detail?.user?.uid || "";
  fuwaHistoryUserEmail = detail?.user?.email || "";
  fuwaHistoryLatestSafeCount = null;
  fuwaHistoryLatestSafeBackupId = "";
  window.clearTimeout(fuwaHistoryDailyTimer);
  window.clearTimeout(fuwaHistoryDailyRetryTimer);

  fuwaHistoryEnsureUi();
  if (!fuwaHistoryUid) {
    fuwaHistorySetStatus("Versioned history is available when signed in.");
    return;
  }

  const meta = fuwaHistoryReadMeta();
  if (Number(meta.latestSafeCount || 0) > 0) {
    fuwaHistoryLatestSafeCount = Number(meta.latestSafeCount);
    fuwaHistoryLatestSafeBackupId = meta.latestSafeBackupId || "";
  }
  void fuwaHistoryBootstrap("auth-ready");
}

window.addEventListener("fuwa-local-data-changed", event => {
  if (event?.detail?.source !== "local" || event?.detail?.fuwaHistorySafetyReplay) return;
  if (!fuwaHistoryUid) return;

  // Hold the existing bubble-phase auto-sync until the local record count is
  // checked against the last useful cloud/history count. Safe events are replayed.
  event.stopImmediatePropagation();
  void fuwaHistoryCheckLocalChange(event.detail || {});
}, true);

document.addEventListener("click", event => {
  const button = event.target?.closest?.("#cloudBackupNowButton");
  if (!button || !fuwaHistoryUid) return;

  if (fuwaHistoryManualSafetyBypass) {
    fuwaHistoryManualSafetyBypass = false;
    return;
  }

  const meta = fuwaHistoryReadMeta();
  if (!meta?.safetyPaused) return;

  // If the older v109 restore-first guard is active, let that guard own the
  // confirmation so the user is not asked twice for the same dangerous write.
  if (window.FuwaCloudBackupSafety?.guard?.()) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const localCount = Number(meta.safetyLocalCount || 0);
  const protectedCount = Number(meta.safetyProtectedCount || fuwaHistoryLatestSafeCount || 0);
  const confirmed = window.confirm(
    `Fuwa paused automatic backup because this device dropped from about ${protectedCount} protected records to ${localCount}.\n\n` +
    "Back up this much smaller device copy anyway? Your older versioned history will be kept."
  );
  if (!confirmed) {
    fuwaHistorySetCloudPause(meta.safetyReason || "large-drop", localCount, protectedCount);
    return;
  }

  fuwaHistoryWriteMeta(fuwaHistoryUid, {
    safetyPaused: false,
    safetyReason: null,
    manualDestructiveBackupApprovedAt: Date.now()
  });
  fuwaHistoryReleaseCoreDailyPause();
  fuwaHistoryManualSafetyBypass = true;
  window.queueMicrotask(() => button.click());
}, true);

document.addEventListener("pointerdown", event => {
  if (event.target?.closest?.("#cloudBackupNowButton")) {
    fuwaHistoryManualIntent = true;
  }
}, true);

document.addEventListener("click", event => {
  if (event.target?.closest?.("#cloudBackupHistoryButton")) {
    event.preventDefault();
    fuwaHistoryOpenModal();
    return;
  }
  if (event.target?.closest?.("#fuwaBackupHistoryClose")) {
    event.preventDefault();
    fuwaHistoryCloseModal();
    return;
  }
  const restore = event.target?.closest?.(".fuwa-history-restore");
  if (restore?.dataset?.historyId) {
    event.preventDefault();
    const id = restore.dataset.historyId;
    void fuwaHistoryList().then(items => {
      const item = items.find(entry => entry.id === id);
      if (item) return fuwaHistoryRestore(item);
      throw new Error("fuwa-history-backup-not-found");
    }).catch(error => {
      console.error("Fuwa could not start history restore.", error);
      window.alert("Fuwa couldn't open that history copy. Nothing was changed.");
    });
    return;
  }

  const modal = document.getElementById("fuwaBackupHistoryModal");
  if (modal && event.target === modal) fuwaHistoryCloseModal();
});

window.addEventListener("fuwa-auth-ready", event => {
  fuwaHistoryHandleAuth(event?.detail || {});
});

window.addEventListener("fuwa-firestore-ready", event => {
  if (!event?.detail?.connected || !event?.detail?.uid) return;
  fuwaHistoryUid = event.detail.uid;
  void fuwaHistoryBootstrap("firestore-ready");
});

window.addEventListener("fuwa-cloud-backup-complete", () => {
  void fuwaHistoryHandleBackupComplete();
});

window.addEventListener("online", event => {
  if (!fuwaHistoryUid) return;
  const paused = Boolean(fuwaHistoryReadMeta()?.safetyPaused);
  if (paused) {
    event.stopImmediatePropagation();
    const meta = fuwaHistoryReadMeta();
    fuwaHistorySetCloudPause(
      meta.safetyReason || "large-drop",
      Number(meta.safetyLocalCount || 0),
      Number(meta.safetyProtectedCount || fuwaHistoryLatestSafeCount || 0)
    );
  }
  void fuwaHistoryBootstrap("online");
  fuwaHistoryScheduleDaily("online");
}, true);

window.addEventListener("pageshow", event => {
  fuwaHistoryEnsureUi();
  if (!fuwaHistoryUid) return;
  const paused = Boolean(fuwaHistoryReadMeta()?.safetyPaused);
  if (paused) {
    event.stopImmediatePropagation();
    const meta = fuwaHistoryReadMeta();
    fuwaHistorySetCloudPause(
      meta.safetyReason || "large-drop",
      Number(meta.safetyLocalCount || 0),
      Number(meta.safetyProtectedCount || fuwaHistoryLatestSafeCount || 0)
    );
  }
  void fuwaHistoryBootstrap("pageshow");
  fuwaHistoryScheduleDaily("pageshow");
}, true);

document.addEventListener("visibilitychange", event => {
  if (document.visibilityState !== "visible" || !fuwaHistoryUid) return;
  const paused = Boolean(fuwaHistoryReadMeta()?.safetyPaused);
  if (paused) {
    event.stopImmediatePropagation();
    const meta = fuwaHistoryReadMeta();
    fuwaHistorySetCloudPause(
      meta.safetyReason || "large-drop",
      Number(meta.safetyLocalCount || 0),
      Number(meta.safetyProtectedCount || fuwaHistoryLatestSafeCount || 0)
    );
  }
  void fuwaHistoryBootstrap("resume");
  fuwaHistoryScheduleDaily("resume");
}, true);

if (window.__fuwaCloudSafetyLastAuthDetail) {
  fuwaHistoryHandleAuth(window.__fuwaCloudSafetyLastAuthDetail);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", fuwaHistoryEnsureUi, { once: true });
} else {
  fuwaHistoryEnsureUi();
}

window.FuwaCloudBackupHistory = {
  list: () => fuwaHistoryList(),
  refresh: () => fuwaHistoryRefreshStatus(),
  bootstrap: () => fuwaHistoryBootstrap("manual-debug"),
  archiveCurrent: () => fuwaHistoryArchiveCurrent("manual-debug"),
  createDaily: () => fuwaHistoryCreateDaily("manual-debug"),
  isDestructiveDrop: fuwaHistoryIsDestructiveDrop,
  countData: fuwaHistoryCountData,
  meta: () => fuwaHistoryReadMeta(),
  dailyState: () => fuwaHistoryReadDaily()
};
