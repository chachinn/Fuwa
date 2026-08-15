from pathlib import Path
p=Path('tools/fuwa_v97_browser_qa.js')
s=p.read_text(encoding='utf-8')
old="await p.evaluate(()=>window.fuwaSmartApi.openEntry('smart-work-1'));await p.waitForTimeout(100);const before=await p.locator('#entryBody').inputValue();"
new="await p.evaluate(()=>window.fuwaSmartApi.openEntry('smart-work-1'));await p.waitForTimeout(220);const featureGuide=p.locator('#featureTutorial');if(await featureGuide.isVisible()){await p.locator('#featureTutorialGotIt').click();await p.waitForTimeout(80);}const before=await p.locator('#entryBody').inputValue();"
if s.count(old)!=1: raise SystemExit(f'editor tutorial QA anchor mismatch: {s.count(old)}')
p.write_text(s.replace(old,new,1),encoding='utf-8')
print('v97 editor tutorial QA repaired')