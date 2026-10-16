import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { startServer } from './serve.mjs';

await mkdir('test-results', { recursive: true });
const { server, url } = await startServer({ port: 0 });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const manifest = JSON.parse(await readFile('Export/html5/bin/build-info.json', 'utf8'));
assert.equal(createHash('sha256').update(await readFile('Export/html5/bin/inspector.js')).digest('hex'), manifest.contractEngineSha256);
const errors = [];
const state = page => page.evaluate(() => window.contractInspector.getState());
async function ready(page) { await page.waitForFunction(() => { const current = window.contractInspector?.getState(); return current?.ready && current.fingerprint.length === 64; }); return state(page); }
async function fixture(page, id) { await page.selectOption('#fixture', id); await ready(page); }
async function apply(page, contract) { await page.locator('#contract-json').evaluate(editor => { editor.closest('details').open = true; }); await page.locator('#contract-json').fill(JSON.stringify(contract)); await page.locator('#apply-json').click(); return ready(page); }
async function bytes(download) { const stream = await download.createReadStream(); const parts = []; for await (const part of stream) parts.push(part); return Buffer.concat(parts); }
async function capture(page, name) {
  await page.screenshot({ path: `test-results/inspector-${name}.png`, fullPage: true });
  const png = PNG.sync.read(await page.locator('#contract-map').screenshot());
  const colors = new Set(); for (let offset = 0; offset < png.data.length; offset += 16) colors.add(png.data.subarray(offset, offset + 3).toString('hex'));
  assert.ok(colors.size > 30, `${name}: canvas must show actual geometry and image content`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${name}: no horizontal overflow`);
  assert.equal(await page.locator('button').evaluateAll(buttons => buttons.filter(button => button.offsetParent && button.scrollWidth > button.clientWidth + 2).length), 0, `${name}: button labels must fit`);
}

try {
  for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, acceptDownloads: true });
    const page = await context.newPage(); const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(`${url}/inspector.html?fixture=open&seed=123456`); let current = await ready(page);
    assert.equal(current.contract.seed,123456); assert.equal(current.validation.valid,true); assert.equal(current.approval,null);
    assert.equal(requests.some(request => request.includes('TownGenerator.js') || request.includes('frontage-geometry')),false,'Inspector must not load the legacy engine');
    assert.equal(current.result.phase,'contract'); assert.deepEqual(current.result.streets,{connected:false,components:0,nodes:[],edges:[]}); assert.deepEqual(current.result.buildings,[]);
    await capture(page,`${viewport.width}-open`);
    await page.locator('#generate-streets').click(); current=await state(page);
    assert.equal(current.phase,'streets'); assert.equal(current.result.streets.connected,true);
    assert.ok(current.result.streets.edges.length>20); assert.deepEqual(current.result.blocks,[]); assert.deepEqual(current.result.buildings,[]);
    assert.equal(await page.locator('#street-legend').isVisible(),true);
    await capture(page,`${viewport.width}-streets`);
    const streetPixels=await page.locator('#contract-map').screenshot();
    await page.getByRole('checkbox',{name:'Show streets',exact:true}).uncheck();
    assert.notDeepEqual(await page.locator('#contract-map').screenshot(),streetPixels,'Street layer toggle must affect pixels');
    await page.getByRole('checkbox',{name:'Show streets',exact:true}).check();
    const streetDownload=page.waitForEvent('download');await page.locator('#export-contract').click();
    const streetExport=JSON.parse((await bytes(await streetDownload)).toString());
    assert.equal(streetExport.result.phase,'streets');assert.equal(streetExport.result.streets.connected,true);
    assert.equal(streetExport.result.streets.edges.length,current.result.streets.edges.length);
    await fixture(page,'coast'); current=await state(page); assert.ok(current.validation.metrics.waterArea>0);
    await page.locator('#generate-streets').click();current=await state(page);assert.equal(current.result.streets.connected,true);
    await capture(page,`${viewport.width}-coast-streets`);
    await page.locator('#approve-contract').click(); assert.equal((await state(page)).approval.status,'approved');
    const originalHash=(await state(page)).fingerprint;
    await page.reload(); await ready(page); assert.equal((await state(page)).approval?.status,'approved','Exact persisted review must restore');
    await page.locator('#contract-seed').fill('123'); await page.locator('#contract-seed').dispatchEvent('change'); await ready(page);
    assert.equal((await state(page)).approval,null,'Seed edits must invalidate approval'); assert.notEqual((await state(page)).fingerprint,originalHash);
    await page.locator('#image-x').fill('50'); await page.locator('#image-y').fill('-20'); await page.locator('#image-scale').fill('1.25'); await page.locator('#image-rotation').fill('15');
    await page.locator('#apply-registration').click(); current=await ready(page);
    assert.deepEqual(current.contract.background.origin,[50,-20]); assert.equal(current.contract.background.rotationDegrees,15);
    await capture(page,`${viewport.width}-registration`);
    await fixture(page,'exclusion'); current=await state(page); assert.ok(current.validation.buildable.some(part=>part.length>1));
    await page.locator('#generate-streets').click();current=await state(page);assert.equal(current.result.streets.connected,true);
    await capture(page,`${viewport.width}-exclusion-streets`);
    const visible = await page.locator('#contract-map').screenshot();
    await page.getByRole('checkbox',{name:'Show forbidden',exact:true}).uncheck();
    assert.notDeepEqual(await page.locator('#contract-map').screenshot(),visible,'Layer toggle must affect pixels');
    await page.getByRole('checkbox',{name:'Show forbidden',exact:true}).check();
    await capture(page,`${viewport.width}-exclusion`);
    const barrier=(await state(page)).contract;
    barrier.masks=[{id:'citywide-barrier',label:'Full-width exclusion',kind:'forbidden',geometry:{type:'Polygon',coordinates:[[[490,0],[510,0],[510,800],[490,800],[490,0]]]}}];
    current=await apply(page,barrier);assert.equal(current.validation.valid,true);
    await page.locator('#generate-streets').click();current=await state(page);
    assert.equal(current.result.streets.connected,false);assert.ok(current.result.streets.components>1);
    assert.match(await page.locator('#street-status').textContent(),/Disconnected/);
    await fixture(page,'conflict'); current=await state(page); assert.equal(current.validation.valid,false); assert.equal(current.result,null);
    assert.equal(await page.locator('#approve-contract').isDisabled(),true);
    assert.ok(current.validation.issues.some(issue=>issue.code==='PROTECTED_MASK_CONFLICT'));
    await page.locator('.issue').first().click(); await capture(page,`${viewport.width}-conflict`);
    const invalidDownload=page.waitForEvent('download'); await page.locator('#export-contract').click();
    const invalidExport=JSON.parse((await bytes(await invalidDownload)).toString()); assert.equal(invalidExport.result,null);assert.equal(invalidExport.review,null);
    await fixture(page,'open');
    const malformed=(await state(page)).contract; malformed.seed=-1;
    current=await apply(page,malformed); assert.equal(current.validation.valid,false); assert.equal(await page.locator('#approve-contract').isDisabled(),true);
    await fixture(page,'open');
    const openRaster=await page.locator('#contract-map').evaluate(map=>map.toDataURL());
    const mismatched=(await state(page)).contract; mismatched.background.pixelWidth=999;
    current=await apply(page,mismatched); assert.equal(current.validation.valid,false,'Cached background must validate pixel dimensions again');
    await fixture(page,'open');
    assert.equal(await page.locator('#contract-map').evaluate(map=>map.toDataURL()),openRaster,'Valid raster must restore after failed dimension validation');
    const broken=(await state(page)).contract; broken.background={...broken.background,imageDataUrl:'data:image/png;base64,AAAA'}; delete broken.background.fixture;
    current=await apply(page,broken); assert.equal(current.validation.valid,false,'Bad raster must prevent approval');
    await fixture(page,'open');
    assert.equal(await page.locator('#contract-map').evaluate(map=>map.toDataURL()),openRaster,'Valid raster must restore after a failed decode');
    const bitmap=new PNG({width:80,height:60});bitmap.data.fill(255);
    await page.locator('#background-file').setInputFiles({name:'reference.png',mimeType:'image/png',buffer:PNG.sync.write(bitmap)});
    await page.waitForFunction(()=>window.contractInspector.getState().contract.background?.pixelWidth===80);current=await ready(page);
    assert.equal(current.validation.valid,true);assert.equal(current.contract.background.pixelHeight,60);
    await page.locator('#approve-contract').click();
    const download=page.waitForEvent('download'); await page.locator('#export-contract').click(); const exported=JSON.parse((await bytes(await download)).toString());
    assert.equal(exported.review.status,'approved');assert.equal(exported.review.fingerprint,exported.fingerprint);assert.equal(exported.result.phase,'contract');
    const pngDownload=page.waitForEvent('download');await page.locator('#export-diagnostic').click();const diagnostic=PNG.sync.read(await bytes(await pngDownload));assert.equal(diagnostic.width,2048);assert.equal(diagnostic.height,1536);
    await page.locator('#contract-file').setInputFiles({name:'contract.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});await ready(page);
    assert.equal((await state(page)).fingerprint,exported.fingerprint,'Export/import must preserve exact contract');
    await page.goto(`${url}/builds/${manifest.id}/inspector.html`);await ready(page);assert.equal(await page.locator('#generator-link').getAttribute('href'),`${url}/`);
    await context.close();
  }
  assert.deepEqual(errors,[],'No browser runtime errors or missing assets');
  console.log('PASS: independent desktop/mobile inspector, fixture pixels, conflicts, registration/upload, approval invalidation/persistence, versioned JSON/PNG exports, and archive navigation');
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
}