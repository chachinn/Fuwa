const { chromium } = require(process.cwd() + '/node_modules/playwright');
const sizes=[
  {name:'iPhone small',width:320,height:568},
  {name:'iPhone standard',width:390,height:844},
  {name:'iPhone large',width:430,height:932},
  {name:'iPad portrait',width:820,height:1180},
  {name:'iPad landscape',width:1180,height:820}
];
(async()=>{
  const browser=await chromium.launch({headless:true});
  for(const spec of sizes){
    const context=await browser.newContext({viewport:{width:spec.width,height:spec.height},isMobile:true,hasTouch:true});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(String(e)));
    await page.addInitScript(()=>{
      localStorage.setItem('fuwaLocalModeV1','1');
      localStorage.setItem('fuwaTutorialSeenV1','1');
      localStorage.setItem('fuwaFeatureTutorial:v1:home','1');
      localStorage.setItem('fuwaFeatureTutorial:v1:sleep','1');
    });
    await page.goto('http://127.0.0.1:4173/index.html',{waitUntil:'domcontentloaded'});
    await page.waitForTimeout(900);

    // This smoke test is for an existing-user UI release. Suppress unrelated
    // onboarding/check-in overlays so they do not intercept the controls under test.
    await page.evaluate(()=>{
      document.querySelector('#fuwaTutorial')?.classList.add('hidden');
      document.querySelector('#featureTutorial')?.classList.add('hidden');
      document.querySelector('#moodCheckinModal')?.classList.add('hidden');
    });

    const home=await page.evaluate(()=>{
      const buttons=[...document.querySelectorAll('#moodPicker button')];
      const nav=document.querySelector('.bottom-nav')?.getBoundingClientRect();
      const circles=buttons.map(b=>{const r=b.getBoundingClientRect(),s=getComputedStyle(b);return {w:r.width,h:r.height,r:s.borderRadius}});
      return {overflow:document.documentElement.scrollWidth-window.innerWidth,navBottom:nav?window.innerHeight-nav.bottom:999,circles};
    });
    if(home.overflow>2) throw new Error(`${spec.name} home overflow ${home.overflow}`);
    if(Math.abs(home.navBottom)>2) throw new Error(`${spec.name} nav not bottom-attached: ${home.navBottom}`);
    if(home.circles.length!==6) throw new Error(`${spec.name} expected 6 mood choices`);
    for(const c of home.circles){
      if(Math.abs(c.w-c.h)>2) throw new Error(`${spec.name} mood not square ${JSON.stringify(c)}`);
      if(parseFloat(c.r)<c.w*.40) throw new Error(`${spec.name} mood not circular ${JSON.stringify(c)}`);
    }

    await page.evaluate(()=>document.querySelector('[data-nav="sleep"]')?.click());
    await page.waitForTimeout(300);
    await page.evaluate(()=>document.querySelector('#moodCheckinModal')?.classList.add('hidden'));
    const sleep=await page.evaluate(()=>{
      const player=document.querySelector('#sleepPlayerCard');
      const timer=[...document.querySelectorAll('#sleepView .sleep-section')].find(x=>x.textContent.includes('Sleep timer'));
      const sounds=[...document.querySelectorAll('[data-sleep-sound]')];
      return {overflow:document.documentElement.scrollWidth-window.innerWidth,playerBeforeTimer:!!(player&&timer&&(player.compareDocumentPosition(timer)&Node.DOCUMENT_POSITION_FOLLOWING)),soundCount:sounds.length};
    });
    if(sleep.overflow>2) throw new Error(`${spec.name} sleep overflow ${sleep.overflow}`);
    if(!sleep.playerBeforeTimer) throw new Error(`${spec.name} player is not above timer`);
    if(sleep.soundCount<8) throw new Error(`${spec.name} missing sleep sounds: ${sleep.soundCount}`);

    await page.locator('[data-sleep-sound="rain"]').click();
    const play=page.locator('#sleepPlayPauseButton');
    if(await play.count()){
      await play.click();
      await page.waitForTimeout(150);
      await page.locator('[data-sleep-sound="waves"]').click();
      await page.locator('[data-sleep-sound="forest"]').click();
      await page.locator('[data-sleep-sound="cafe"]').click();
      await page.waitForTimeout(1500);
      const stop=page.locator('#sleepStopButton');
      if(await stop.count()) await stop.click();
    }
    if(errors.length) throw new Error(`${spec.name} page errors: ${errors.join(' | ')}`);
    if(spec.width===390) await page.screenshot({path:'/tmp/fuwa-v90-home-sleep.png',fullPage:true});
    await context.close();
  }
  await browser.close();
  console.log('responsive/interaction QA passed');
})().catch(e=>{console.error(e);process.exit(1)});
