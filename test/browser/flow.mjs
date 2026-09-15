import { createRequire } from 'node:module';

// Playwright is an optional dev dependency; resolve it wherever it is installed.
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PF_PLAYWRIGHT ?? 'playwright');
const problems = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });

await page.goto(process.env.PF_URL ?? 'http://127.0.0.1:8899/fixture.html', { waitUntil:'networkidle' });
await page.waitForSelector('#pf-anvil.pf-anvil--ready');

// Queue the responses the mocked API will hand back, in order.
await page.evaluate(() => {
  const blueprint = JSON.stringify({
    name:'Ashfall', summary:'grimdark',
    settings:{temperature:0.9},
    modules:[
      {key:'main',label:'✒ role.',kind:'core',core:'main',enabled:true,brief:'identity'},
      {key:'axioms',label:'✒ axioms.',kind:'rule',enabled:true,brief:'rules'},
      {key:'bias_a',label:'⚖ neutral.',kind:'option',group:'bias',enabled:true,brief:'n'},
      {key:'bias_b',label:'⚖ dark.',kind:'option',group:'bias',enabled:false,brief:'d'},
      {key:'hud',label:'𝚿 hud.',kind:'feature',enabled:false,brief:'status'},
      {key:'chatHistory',label:'history',kind:'marker',enabled:true},
    ]});
  const body = n => JSON.stringify({ modules: Array.from({length:n}, (_,i)=>({ key:'K'+i, content:'' })) });
  // Content batches answer positionally, which the merge path supports.
  globalThis.__responses = [blueprint,
    JSON.stringify({modules:[{key:'main',content:'ROLE BODY {{char}}'},{key:'axioms',content:'AXIOM BODY'},{key:'bias_a',content:'NEUTRAL BODY'},{key:'bias_b',content:'DARK BODY'}]}),
    JSON.stringify({modules:[{key:'hud',content:'HUD BODY'}]}),
  ];
  void body;
});

const b = await page.locator('#pf-anvil').boundingBox();
await page.touchscreen.tap(b.x+b.width/2, b.y+b.height/2);
await page.waitForSelector('#pf-panel.pf-panel--open');

// Fill the brief and forge.
await page.locator('.pf-tab[data-tab="create"]').click();
await page.locator('#pf-panel .pf-textarea').fill('A grimdark low-fantasy roleplay preset.');
await page.locator('#pf-panel .pf-btn--primary').click();

await page.waitForSelector('.pf-modules', { timeout: 10000 });
console.log('flow: forge finished, landed on', await page.locator('.pf-tab--active').textContent());

const rows = await page.locator('.pf-module__name').allTextContents();
console.log('flow: modules ->', rows.join(' | '));
if (!rows.includes('✒ axioms.')) problems.push('generated module missing from the list');
if (rows.includes('history')) problems.push('markers should not be listed as editable modules');

// The disabled option must render as off.
const offCount = await page.locator('.pf-module--off').count();
console.log('flow: disabled rows =', offCount);
if (offCount < 2) problems.push('disabled modules not shown as off');

// Select two modules, then check the counter.
const boxes = page.locator('.pf-module .pf-checkbox');
await boxes.nth(0).check();
await boxes.nth(1).check();
const note = await page.locator('.pf-note').first().textContent();
console.log('flow: counter ->', note);
if (!note.includes('2')) problems.push('selection counter wrong');

// Toggle a module off via its power dot.
const wasOff = await page.locator('.pf-module').nth(0).getAttribute('class');
await page.locator('.pf-module .pf-power').nth(0).click();
await page.waitForTimeout(150);
const nowOff = await page.locator('.pf-module').nth(0).getAttribute('class');
console.log('flow: toggle', wasOff.includes('--off'), '->', nowOff.includes('--off'));
if (wasOff.includes('--off') === nowOff.includes('--off')) problems.push('power toggle did nothing');
await page.locator('.pf-module .pf-power').nth(0).click();

// Open the editor on a module and save an edit.
await page.locator('.pf-module__text').nth(1).click();
await page.waitForSelector('.pf-modal--open');
await page.locator('.pf-modal__body .pf-textarea').fill('EDITED BY HAND');
await page.locator('.pf-modal__footer .pf-btn:not(.pf-btn--ghost)').click();
await page.waitForTimeout(250);
const preview = await page.locator('.pf-module__preview').nth(1).textContent();
console.log('flow: edited preview ->', preview);
if (!preview.includes('EDITED BY HAND')) problems.push('module editor did not save');

// Now rewrite ONLY the selected modules.
await page.evaluate(() => {
  globalThis.__seen = [];
  const ctxFn = globalThis.SillyTavern.getContext;
  globalThis.SillyTavern.getContext = () => {
    const c = ctxFn();
    const orig = c.generateRaw;
    c.generateRaw = async (args) => {
      globalThis.__seen.push(Array.isArray(args.prompt) ? args.prompt[0].content : String(args.prompt));
      const m = /REWRITE EXACTLY THESE MODULES\n([\s\S]*?)\n\nReturn/.exec(
        Array.isArray(args.prompt) ? args.prompt[0].content : '');
      const keys = m ? JSON.parse(m[1]).map(x=>x.key) : [];
      return JSON.stringify({ modules: keys.map(k => ({ key:k, content:'REWRITTEN ' + k })) });
    };
    void orig;
    return c;
  };
});

await page.locator('.pf-tab[data-tab="rewrite"]').click();
await page.locator('#pf-panel .pf-textarea').fill('Move it to hard sci-fi.');
await page.locator('#pf-panel .pf-btn--primary').click();
await page.waitForSelector('.pf-modules', { timeout: 10000 });

const previews = await page.locator('.pf-module__preview').allTextContents();
const names = await page.locator('.pf-module__name').allTextContents();
const rewritten = previews.filter(p => p.startsWith('REWRITTEN')).length;
console.log('flow: after rewrite ->');
names.forEach((n,i)=>console.log('   ', n, '::', previews[i].slice(0,40)));
if (rewritten !== 2) problems.push(`expected exactly 2 rewritten modules, got ${rewritten}`);
if (!previews.some(p => p.startsWith('NEUTRAL BODY'))) problems.push('unselected module was clobbered by the rewrite');
if (!previews.some(p => p.startsWith('HUD BODY'))) problems.push('unselected feature was clobbered by the rewrite');

if (errors.length) problems.push('console errors: ' + errors.join(' ; '));
await page.screenshot({ path: process.env.PF_SHOT ?? 'flow.png' });
await browser.close();
console.log('\n' + (problems.length ? 'PROBLEMS:\n- '+problems.join('\n- ') : 'FLOW CHECKS PASSED'));
process.exit(problems.length?1:0);
