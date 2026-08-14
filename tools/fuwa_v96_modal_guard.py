from pathlib import Path

path = Path('app.js')
text = path.read_text(encoding='utf-8')

old_open = '''function openMoodCheckin(force = false) {
  if (document.body.classList.contains("cloud-restore-open")) return;
  const today = getTodayMoodCheckin();'''
new_open = '''function fuwaMoodCheckinBlockedByActiveModal() {
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
  if (document.body.classList.contains("cloud-restore-open")) return;
  if (!force && fuwaMoodCheckinBlockedByActiveModal()) return;
  const today = getTodayMoodCheckin();'''
if text.count(old_open) != 1:
    raise SystemExit(f'openMoodCheckin guard anchor mismatch: {text.count(old_open)}')
text = text.replace(old_open, new_open, 1)

old_maybe = '''function maybeShowDailyMoodCheckin() {
  if (document.body.classList.contains("cloud-restore-open")) return;
  if (getTodayMoodCheckin() || homeMoodSyncRunning || pendingHomeMoodSync) return;
  setTimeout(() => {
    if (getTodayMoodCheckin() || homeMoodSyncRunning || pendingHomeMoodSync) return;
    openMoodCheckin();
  }, 350);
}'''
new_maybe = '''function maybeShowDailyMoodCheckin() {
  if (fuwaMoodCheckinBlockedByActiveModal()) return;
  if (getTodayMoodCheckin() || homeMoodSyncRunning || pendingHomeMoodSync) return;
  setTimeout(() => {
    if (fuwaMoodCheckinBlockedByActiveModal()) return;
    if (getTodayMoodCheckin() || homeMoodSyncRunning || pendingHomeMoodSync) return;
    openMoodCheckin();
  }, 350);
}'''
if text.count(old_maybe) != 1:
    raise SystemExit(f'maybeShowDailyMoodCheckin anchor mismatch: {text.count(old_maybe)}')
text = text.replace(old_maybe, new_maybe, 1)

path.write_text(text, encoding='utf-8')
print('Fuwa v96 modal race guard applied.')
