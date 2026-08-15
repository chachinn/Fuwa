from pathlib import Path
exec(Path('tools/v100_patch.py').read_text(), {'__name__':'__main__'})

# v100 hardening: if the automatic Mood Check-In already opened on Home, leaving
# Home must retire it immediately so it cannot follow the user into Insights/Me/etc.
p=Path('app.js'); s=p.read_text()
old='''function navigate(view) {\n  closeFuwaDrawer();\n  currentView = view;\n'''
new='''function navigate(view) {\n  closeFuwaDrawer();\n  currentView = view;\n\n  // Automatic Mood Check-In belongs to Home only. If it opened just before a\n  // navigation tap, close it rather than letting the modal follow the user and\n  // intercept controls in Fuwa Insights or another destination.\n  if (view !== "home" && !$("moodCheckinModal")?.classList.contains("hidden")) {\n    closeMoodCheckin();\n  }\n'''
assert old in s
p.write_text(s.replace(old,new,1))
