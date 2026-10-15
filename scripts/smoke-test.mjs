import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { startServer } from './serve.mjs';

await mkdir('test-results', { recursive: true });
const { server, url } = await startServer({ port: 0 });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const errors = [];

function pixelVariation(bytes) {
  const image = PNG.sync.read(bytes);
  let differing = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset] !== image.data[0]
      || image.data[offset + 1] !== image.data[1]
      || image.data[offset + 2] !== image.data[2]) differing += 1;
  }
  return differing;
}

async function capture(page, address, path) {
  await page.goto(address);
  await page.locator('canvas').first().waitFor();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    return canvas?.width > 0 && canvas?.height > 0;
  });
  await page.evaluate(() => new Promise(resolveFrame => {
    requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
  }));
  const bytes = await page.screenshot({ path });
  assert.ok(pixelVariation(bytes) > 1000, 'Rendered city must not be blank');
  return bytes;
}

try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  const seedUrl = `${url}/?size=15&seed=682063530`;
  const first = await capture(page, seedUrl, 'test-results/desktop.png');
  const second = await capture(page, seedUrl, 'test-results/desktop-repeat.png');
  assert.deepEqual(PNG.sync.read(first).data, PNG.sync.read(second).data, 'Same seed must reproduce the same image');
  const different = await capture(page, `${url}/?size=15&seed=42`, 'test-results/different-seed.png');
  assert.notDeepEqual(PNG.sync.read(first).data, PNG.sync.read(different).data, 'Different seeds must change the city');

  const baselineRoot = resolve('.toolchain/upstream-baseline');
  if (existsSync(resolve(baselineRoot, 'index.html'))) {
    const baseline = await startServer({ root: baselineRoot, port: 0 });
    try {
      const original = await capture(page, `${baseline.url}/?size=15&seed=682063530`, 'test-results/upstream.png');
      const originalPixels = PNG.sync.read(original);
      const currentPixels = PNG.sync.read(first);
      for (let row = 0; row < 900; row += 1) {
        const start = row * 1200 * 4;
        const end = start + 980 * 4;
        assert.deepEqual(currentPixels.data.subarray(start, end), originalPixels.data.subarray(start, end),
          `Original map pixels must match outside the controls (row ${row})`);
      }
      console.log('PASS: map pixels match the untouched upstream build');
    } finally {
      await new Promise(resolveClose => baseline.server.close(resolveClose));
    }
  } else {
    console.log('SKIP: upstream comparison (no .toolchain/upstream-baseline build)');
  }

  await capture(page, seedUrl, 'test-results/desktop.png');
  const canvas = await page.locator('canvas').first().boundingBox();
  const scale = await page.evaluate(() => Math.floor(window.devicePixelRatio * 72 / 24));
  const downloadPromise = page.waitForEvent('download');
  await page.mouse.click(canvas.x + canvas.width - 22.5 * scale, canvas.y + 62.5 * scale);
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'city-15-682063530.png');
  await download.saveAs('test-results/export.png');
  const exportedBytes = await readFile('test-results/export.png');
  const exported = PNG.sync.read(exportedBytes);
  assert.equal(exported.width, 2048);
  assert.equal(exported.height, 2048);
  assert.ok(pixelVariation(exportedBytes) > 10000, 'Export must contain city geometry');

  await page.mouse.click(canvas.x + canvas.width - 22.5 * scale, canvas.y + 6.5 * scale);
  await page.waitForURL(address => Number(address.searchParams.get('size')) >= 6
    && Number(address.searchParams.get('size')) < 10);
  assert.ok(Number(new URL(page.url()).searchParams.get('seed')) > 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, `${url}/?size=6&seed=42`, 'test-results/mobile.png');
  await page.setViewportSize({ width: 1200, height: 900 });
  await capture(page, `${url}/?size=40&seed=123456`, 'test-results/metropolis.png');
  assert.deepEqual(errors, [], 'Browser must not report runtime errors');
  console.log('PASS: deterministic seeds, different cities, size controls, desktop/mobile rendering, 2048px PNG download');
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}