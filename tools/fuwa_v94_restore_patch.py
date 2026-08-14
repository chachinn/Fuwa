from pathlib import Path
import re


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def sub_once(text, pattern, replacement, label, flags=re.S):
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one regex match, found {count}")
    return updated


app_path = Path("app.js")
app = app_path.read_text(encoding="utf-8")

app = replace_once(
    app,
    'const FUWA_RELEASE_KEY = "fuwa-v1.1.8-2026-08-14";',
    'const FUWA_RELEASE_KEY = "fuwa-v1.1.9-2026-08-14";',
    "app release key",
)

# Restore verification must count the exact same cloud-backed stores as backup creation.
app = sub_once(
    app,
    r'function restoredRecordCount\(data\) \{\s*return \[[\s\S]*?\]\.reduce\(\(total, key\) => total \+ \(Array\.isArray\(data\?\.\[key\]\) \? data\[key\]\.length : 0\), 0\);\s*\}',
    '''function restoredRecordCount(data) {\n  return cloudBackupRecordCount(data);\n}''',
    "restored record counter",
)

cloud_store_list = '''const storeNames = [\n    "entries",\n    "tinyJoys",\n    "letters",\n    "moodCheckins",\n    "threads",\n    "bookmarks",\n    "nightlyReflections",\n    "thenNow",\n    "comfortItems",\n    "unsentLetters",\n    "thoughtBubbles",\n    "dreams",\n    "dailyCheckins",\n    "lifeCollections",\n    "habitDefinitions",\n    "moments",\n    "randomThoughts"\n  ];'''
app = sub_once(
    app,
    r'(async function verifyRestoredContent\(expected\) \{\s*const actual = await diaryRepository\.readCurrentData\(\);\s*)const storeNames = \[[\s\S]*?\];',
    lambda m: m.group(1) + cloud_store_list,
    "restore verification store list",
)

# Refuse inconsistent cloud metadata before the IndexedDB replacement transaction begins.
needle = '''  incoming.moments = validateSimpleStore(incoming.moments, "moments");\n  incoming.randomThoughts = validateSimpleStore(incoming.randomThoughts, "randomThoughts");\n\n  const existingMedia = await diaryRepository.readAllMedia();'''
replacement = '''  incoming.moments = validateSimpleStore(incoming.moments, "moments");\n  incoming.randomThoughts = validateSimpleStore(incoming.randomThoughts, "randomThoughts");\n\n  const incomingRecordCount = cloudBackupRecordCount(incoming);\n  const declaredRecordCount = Number(payload.recordCount);\n  if (Number.isFinite(declaredRecordCount) && declaredRecordCount !== incomingRecordCount) {\n    throw new Error(`invalid-cloud-backup:record-count:${incomingRecordCount}/${declaredRecordCount}`);\n  }\n\n  const existingMedia = await diaryRepository.readAllMedia();'''
app = replace_once(app, needle, replacement, "cloud restore preflight record count")

# A failed post-write verification must be able to restore every cloud-backed store
# from the in-memory full-device snapshot. Local-only media/scrapbook stores are never
# replaced by cloud restore, so they are deliberately left untouched during rollback.
safety_marker = '''async function createRestoreSafetyBackup() {\n  // Keep the safety snapshot in memory while restore runs. On iOS, triggering\n  // the file download before the IndexedDB write can navigate away from Fuwa.\n  return createFullLocalBackupPayload();\n}\n'''
safety_function = safety_marker + '''\nasync function restoreSafetyBackup(payload) {\n  if (!payload || payload.app !== "Fuwa" || !payload.data) {\n    throw new Error("invalid-restore-safety-backup");\n  }\n\n  const incoming = normalizeCloudValue(payload.data);\n  validateContentData(incoming);\n  incoming.moodCheckins = validateMoodCheckins(incoming.moodCheckins);\n  incoming.bookmarks = validateBookmarks(incoming.bookmarks);\n  incoming.unsentLetters = validateUnsentLetters(incoming.unsentLetters);\n  incoming.thoughtBubbles = validateSimpleStore(incoming.thoughtBubbles, "thoughtBubbles");\n  incoming.dreams = validateSimpleStore(incoming.dreams, "dreams");\n  incoming.dailyCheckins = validateSimpleStore(incoming.dailyCheckins, "dailyCheckins");\n  incoming.lifeCollections = validateSimpleStore(incoming.lifeCollections, "lifeCollections");\n  incoming.habitDefinitions = validateSimpleStore(incoming.habitDefinitions, "habitDefinitions");\n  incoming.moments = validateSimpleStore(incoming.moments, "moments");\n  incoming.randomThoughts = validateSimpleStore(incoming.randomThoughts, "randomThoughts");\n\n  const existingMedia = await diaryRepository.readAllMedia();\n  await diaryRepository.replaceContent(incoming, existingMedia);\n\n  const verification = await verifyRestoredContent(incoming);\n  const expectedCount = restoredRecordCount(incoming);\n  if (verification.recordCount !== expectedCount) {\n    throw new Error(`safety-rollback-verification-failed:${verification.recordCount}/${expectedCount}`);\n  }\n\n  try {\n    await loadState();\n    renderAll();\n  } catch (renderError) {\n    console.error("Fuwa restored the safety snapshot but could not refresh the interface immediately.", renderError);\n  }\n\n  return { ok: true, recordCount: verification.recordCount };\n}\n'''
app = replace_once(app, safety_marker, safety_function, "safety rollback engine")

app = replace_once(
    app,
    '''window.fuwaCreateRestoreSafetyBackup = createRestoreSafetyBackup;\nwindow.fuwaDownloadRestoreSafetyBackup = downloadRestoreSafetyBackup;\nwindow.fuwaApplyCloudRestorePayload = applyCloudRestorePayload;''',
    '''window.fuwaCreateRestoreSafetyBackup = createRestoreSafetyBackup;\nwindow.fuwaRestoreSafetyBackup = restoreSafetyBackup;\nwindow.fuwaDownloadRestoreSafetyBackup = downloadRestoreSafetyBackup;\nwindow.fuwaApplyCloudRestorePayload = applyCloudRestorePayload;''',
    "restore API export",
)

app_path.write_text(app, encoding="utf-8")


firebase_path = Path("firebase-fuwa.js")
fb = firebase_path.read_text(encoding="utf-8")

fb = replace_once(
    fb,
    '''async function handleCloudRestoreConfirm() {\n  const button = $auth("cloudRestoreConfirmButton");\n  const cancel = $auth("cloudRestoreCancelButton");\n  if (button?.disabled) return;''',
    '''async function handleCloudRestoreConfirm() {\n  const button = $auth("cloudRestoreConfirmButton");\n  const cancel = $auth("cloudRestoreCancelButton");\n  let safetyBackup = null;\n  let restoreStarted = false;\n  if (button?.disabled) return;''',
    "restore handler safety state",
)

fb = replace_once(
    fb,
    '''    if (typeof window.fuwaCreateRestoreSafetyBackup !== "function"\n      || typeof window.fuwaApplyCloudRestorePayload !== "function") {''',
    '''    if (typeof window.fuwaCreateRestoreSafetyBackup !== "function"\n      || typeof window.fuwaRestoreSafetyBackup !== "function"\n      || typeof window.fuwaApplyCloudRestorePayload !== "function") {''',
    "restore engine readiness",
)

fb = replace_once(
    fb,
    '    const safetyBackup = await window.fuwaCreateRestoreSafetyBackup();',
    '    safetyBackup = await window.fuwaCreateRestoreSafetyBackup();',
    "safety snapshot assignment",
)

fb = replace_once(
    fb,
    '''    if (button) button.textContent = "Restoring & verifying…";\n\n    const result = await window.fuwaApplyCloudRestorePayload(backup);''',
    '''    if (button) button.textContent = "Restoring & verifying…";\n    restoreStarted = true;\n\n    const result = await window.fuwaApplyCloudRestorePayload(backup);''',
    "restore started marker",
)

old_catch = '''  } catch (error) {\n    console.error("Fuwa cloud restore failed.", error?.name || "Error", error?.message || error);\n    window.alert("Fuwa couldn't complete the restore. Your existing device data was kept as safely as possible. Please don't clear Fuwa data.");\n    if (button) {\n      button.disabled = false;\n      button.textContent = "Restore safely";\n    }\n    if (cancel) cancel.disabled = false;\n  }\n}'''
new_catch = '''  } catch (error) {\n    console.error("Fuwa cloud restore failed.", error?.name || "Error", error?.message || error);\n\n    let rollbackOk = false;\n    let safetyDownloadAttempted = false;\n\n    if (restoreStarted && safetyBackup && typeof window.fuwaRestoreSafetyBackup === "function") {\n      if (button) button.textContent = "Restoring device safety copy…";\n      try {\n        const rollback = await window.fuwaRestoreSafetyBackup(safetyBackup);\n        rollbackOk = rollback?.ok === true;\n      } catch (rollbackError) {\n        console.error("Fuwa safety rollback failed.", rollbackError?.name || "Error", rollbackError?.message || rollbackError);\n      }\n    }\n\n    if (restoreStarted && safetyBackup && !rollbackOk && typeof window.fuwaDownloadRestoreSafetyBackup === "function") {\n      try {\n        await window.fuwaDownloadRestoreSafetyBackup(safetyBackup);\n        safetyDownloadAttempted = true;\n      } catch (downloadError) {\n        console.error("Fuwa could not download the restore safety copy.", downloadError);\n      }\n    }\n\n    const message = !restoreStarted\n      ? "Fuwa couldn't start the restore. Nothing on this device was changed."\n      : rollbackOk\n        ? "Fuwa couldn't complete the restore, so your previous device data was restored from Fuwa's safety snapshot. Please don't clear Fuwa data."\n        : safetyDownloadAttempted\n          ? "Fuwa couldn't complete the restore or automatically roll back the device copy. Fuwa prepared your pre-restore safety backup for download. Please don't clear or reload Fuwa until you've kept that file."\n          : "Fuwa couldn't complete the restore or automatically roll back the device copy. Please don't clear or reload Fuwa data.";\n\n    window.alert(message);\n    if (button) {\n      button.disabled = false;\n      button.textContent = "Restore safely";\n    }\n    if (cancel) cancel.disabled = false;\n  }\n}'''
fb = replace_once(fb, old_catch, new_catch, "restore failure rollback")
firebase_path.write_text(fb, encoding="utf-8")


index_path = Path("index.html")
index = index_path.read_text(encoding="utf-8")
index = replace_once(index, '<!-- FUWA_BUILD: v93-stability-performance-qa -->', '<!-- FUWA_BUILD: v94-cloud-restore-safety-qa -->', "build marker")
index = replace_once(index, 'What’s new in Fuwa 1.1.8', 'What’s new in Fuwa 1.1.9', "release heading")
index = replace_once(
    index,
    'A quieter reliability update: faster app updates, proper iPad rotation, and another full stability pass without changing your journal data.',
    'A cloud-restore safety update: Fuwa now verifies every backed-up record consistently and automatically restores the pre-restore device snapshot if a restore cannot finish safely.',
    "release lead",
)
index = replace_once(
    index,
    '<div class="fuwa-release-list"><article><span>◌</span>',
    '<div class="fuwa-release-list"><article><span>☁️</span><div><strong>Cloud restore verification fixed</strong><p>Moments and Random Thoughts now count correctly during restore verification, so valid cloud backups no longer fail after being written.</p></div></article>\n        <article><span>🛟</span><div><strong>Automatic safety rollback</strong><p>Fuwa validates cloud record totals before writing and restores the pre-restore device snapshot automatically if a later verification step cannot complete.</p></div></article>\n        <article><span>◌</span>',
    "release notes prepend",
)
index_path.write_text(index, encoding="utf-8")


sw_path = Path("service-worker.js")
sw = sw_path.read_text(encoding="utf-8")
sw = replace_once(sw, 'const CACHE_NAME = "fuwa-shell-v93";', 'const CACHE_NAME = "fuwa-shell-v94";', "service worker cache")
sw = replace_once(sw, 'const RELEASE_KEY = "fuwa-v1.1.8-2026-08-14";', 'const RELEASE_KEY = "fuwa-v1.1.9-2026-08-14";', "service worker release key")
sw_path.write_text(sw, encoding="utf-8")

print("Fuwa v94 cloud restore safety patch applied.")
