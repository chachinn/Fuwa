from pathlib import Path
p=Path('tools/fuwa_v97_patch.py')
s=p.read_text(encoding='utf-8')
old="html=once(html,'  <script src=\"app.js\"></script>\\n  <script type=\"module\" src=\"firebase-fuwa.js\"></script>','  <script src=\"app.js\"></script>\\n  <script src=\"smart-fuwa.js\"></script>\\n  <script type=\"module\" src=\"firebase-fuwa.js\"></script>','smart js')"
new="html=once(html,'  <script src=\"app.js\"></script>\\n</body>','  <script src=\"app.js\"></script>\\n  <script src=\"smart-fuwa.js\"></script>\\n</body>','smart js')"
if s.count(old)!=1: raise SystemExit(f'patch repair anchor mismatch: {s.count(old)}')
p.write_text(s.replace(old,new,1),encoding='utf-8')
print('v97 patch anchor repaired')