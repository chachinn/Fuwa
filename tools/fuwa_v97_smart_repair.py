from pathlib import Path
p=Path('smart-fuwa.js')
s=p.read_text(encoding='utf-8')
old='let dismissedThreads=new Set(loadPrefs().dismissedThreads||[]);'
if s.count(old)!=1: raise SystemExit(f'dismissed thread init anchor mismatch: {s.count(old)}')
s=s.replace(old,'let dismissedThreads;',1)
anchor='const savePrefs=p=>{try{localStorage.setItem(PREF_KEY,JSON.stringify(p))}catch{}};'
if s.count(anchor)!=1: raise SystemExit(f'preference helper anchor mismatch: {s.count(anchor)}')
s=s.replace(anchor,anchor+'\ndismissedThreads=new Set(loadPrefs().dismissedThreads||[]);',1)
p.write_text(s,encoding='utf-8')
print('v97 smart startup order repaired')