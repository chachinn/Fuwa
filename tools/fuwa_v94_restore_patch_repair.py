from pathlib import Path

path = Path('app.js')
text = path.read_text(encoding='utf-8')
old = '''  incoming.moodCheckins = validateMoodCheckins(incoming.moodCheckins);\n  incoming.bookmarks = validateBookmarks(incoming.bookmarks);\n  incoming.unsentLetters = validateUnsentLetters(incoming.unsentLetters);\n  incoming.thoughtBubbles = validateSimpleStore(incoming.thoughtBubbles, "thoughtBubbles");'''
new = '''  incoming.moodCheckins = validateMoodCheckins(incoming.moodCheckins);\n  incoming.threads = validateThreads(incoming.threads);\n  incoming.bookmarks = validateBookmarks(incoming.bookmarks);\n  incoming.nightlyReflections = validateNightlyReflections(incoming.nightlyReflections);\n  incoming.thenNow = validateSimpleStore(incoming.thenNow, "thenNow");\n  incoming.comfortItems = validateSimpleStore(incoming.comfortItems, "comfortItems");\n  incoming.unsentLetters = validateSimpleStore(incoming.unsentLetters, "unsentLetters");\n  incoming.thoughtBubbles = validateSimpleStore(incoming.thoughtBubbles, "thoughtBubbles");'''
if text.count(old) != 1:
    raise SystemExit(f'rollback validator repair expected one match, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Fuwa v94 rollback validator sequence repaired.')
