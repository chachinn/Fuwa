from pathlib import Path
p=Path('smart-fuwa.js')
s=p.read_text(encoding='utf-8')
old_places='for(const m of d.text.matchAll(/\\b(?:in|at|to|from|visited|visit)\\s+([A-Z][A-Za-z\'’-]+(?:\\s+[A-Z][A-Za-z\'’-]+){0,2})/g))add(places,m[1],d);'
new_places='for(const m of d.text.matchAll(/\\b(?:in|In|at|At|to|To|from|From|visited|Visited|visit|Visit)\\s+([A-Z][A-Za-z\'’-]+(?:\\s+[A-Z][A-Za-z\'’-]+){0,2})/g))add(places,m[1],d);'
old_people='for(const m of d.text.matchAll(/\\b(?:with|met|called|talked to|saw)\\s+([A-Z][A-Za-z\'’-]+(?:\\s+[A-Z][A-Za-z\'’-]+){0,1})/g))add(people,m[1],d);'
new_people='for(const m of d.text.matchAll(/\\b(?:with|With|met|Met|called|Called|talked to|Talked to|saw|Saw)\\s+([A-Z][A-Za-z\'’-]+(?:\\s+[A-Z][A-Za-z\'’-]+){0,1})/g))add(people,m[1],d);'
if s.count(old_places)!=1: raise SystemExit(f'place entity anchor mismatch: {s.count(old_places)}')
if s.count(old_people)!=1: raise SystemExit(f'people entity anchor mismatch: {s.count(old_people)}')
s=s.replace(old_places,new_places,1).replace(old_people,new_people,1)
p.write_text(s,encoding='utf-8')
print('v97 entity detection repaired')