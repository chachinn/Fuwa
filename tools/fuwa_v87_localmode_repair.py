from pathlib import Path

path = Path("firebase-fuwa.js")
text = path.read_text(encoding="utf-8")
marker = "/* FUWA V87 — LOCAL MODE AUTO-SYNC SAFETY */"
if marker in text:
    raise SystemExit("v87 local-mode repair already applied")

anchor = '''let firebaseInitialized = false;

function isLocalModeChosen(){try{return localStorage.getItem(FUWA_LOCAL_MODE_KEY)==="1"}catch(_){return false}}
'''
replacement = '''let firebaseInitialized = false;

/* FUWA V87 — LOCAL MODE AUTO-SYNC SAFETY */
function stopAutoSync() {
  window.clearTimeout(autoSyncTimer);
  autoSyncTimer = null;
  autoSyncQueued = false;
}

function isLocalModeChosen(){try{return localStorage.getItem(FUWA_LOCAL_MODE_KEY)==="1"}catch(_){return false}}
'''
if text.count(anchor) != 1:
    raise SystemExit(f"Expected one local-mode anchor, found {text.count(anchor)}")
text = text.replace(anchor, replacement, 1)

schedule_anchor = '''function scheduleAutomaticCloudSync() {
  if (Date.now() < suppressAutoSyncUntil) return;
'''
schedule_replacement = '''function scheduleAutomaticCloudSync() {
  // Local-only mode must never start cloud timers. Once a user signs in,
  // auth.currentUser becomes available and normal automatic backup resumes.
  if (isLocalModeChosen() || !auth?.currentUser?.uid) return;
  if (Date.now() < suppressAutoSyncUntil) return;
'''
if text.count(schedule_anchor) != 1:
    raise SystemExit(f"Expected one auto-sync scheduler anchor, found {text.count(schedule_anchor)}")
text = text.replace(schedule_anchor, schedule_replacement, 1)

path.write_text(text, encoding="utf-8")
print("Fuwa v87 local-mode auto-sync repair applied")
