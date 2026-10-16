const root = new URL(window.cityBuild?.appRoot ?? './', location.href);
const params = new URLSearchParams(location.search);
const form = document.querySelector('#comparison-form');
const status = document.querySelector('#comparison-status');
const regionInput = document.querySelector('#comparison-region');
const beforeInput = document.querySelector('#before-build');
const afterInput = document.querySelector('#after-build');
const beforeLayoutInput = document.querySelector('#before-layout');
const afterLayoutInput = document.querySelector('#after-layout');
const beforeMixInput = document.querySelector('#before-mix');
const afterMixInput = document.querySelector('#after-mix');
const seedInput = document.querySelector('#comparison-seed');
const sizeInput = document.querySelector('#comparison-size');
const wallsInput = document.querySelector('#comparison-walls');
const buildingsInput = document.querySelector('#comparison-buildings');
const styleInput = document.querySelector('#comparison-style');
const snapshots = new Map();
const regions = { northwest: [450, 350], center: [724, 724], south: [750, 1100] };
let catalog;
let settings;
let frames = [];

function draw() {
  for (const side of ['before', 'after']) {
    const snapshot = snapshots.get(side);
    if (!snapshot) continue;
    const canvas = document.querySelector(`[data-side="${side}"] canvas`);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 600, 600);
    const region = regions[regionInput.value];
    if (region) context.drawImage(snapshot.image, region[0], region[1], 600, 600, 0, 0, 600, 600);
    else context.drawImage(snapshot.image, 0, 0, 2048, 2048, 0, 0, 600, 600);
  }
}

function loadEngine(build, query) {
  return new Promise((resolveEngine, reject) => {
    const frame = document.createElement('iframe');
    frame.className = 'comparison-engine';
    frame.title = `Archived engine ${build.id}`;
    frames.push(frame);
    let completed = false;
    const timer = setTimeout(() => {
      completed = true;
      reject(new Error(`Build ${build.id} did not finish loading.`));
    }, query.layout === 'mixed' ? 120000 : 20000);
    frame.onload = async () => {
      try {
        const style = frame.contentDocument.createElement('style');
        style.textContent = '.toolbar, #build-status { display: none !important; }';
        frame.contentDocument.head.append(style);
        frame.contentWindow.dispatchEvent(new frame.contentWindow.Event('resize'));
        for (let attempt = 0; attempt < 400 && !completed; attempt += 1) {
          const api = frame.contentWindow.cityGenerator;
          if (api) {
            if (!build.legacy && api.buildId !== build.id) throw new Error(`Engine identity mismatch for ${build.id}.`);
            if (Boolean(api.roofed) !== (query.style === 'roofed')) throw new Error(`Build ${build.id} does not support the requested rendering style.`);
            if (Boolean(api.diagnostic) !== (query.style === 'diagnostic')) throw new Error(`Build ${build.id} does not support the requested diagnostic style and layout.`);
            if (Boolean(api.prototype) !== (query.layout === 'prototype')) throw new Error(`Build ${build.id} does not support the requested neighborhood layout.`);
            if (Boolean(api.frontageGrowth) !== (query.layout === 'frontage-growth')) throw new Error(`Build ${build.id} does not support frontage-driven growth.`);
            if (Boolean(api.mixed) !== (query.layout === 'mixed')) throw new Error(`Build ${build.id} does not support mixed neighborhoods.`);
            if (query.layout === 'mixed' && (api.mixPercent !== query.mix || api.districtOverrides !== query.overrides))
              throw new Error(`Build ${build.id} did not apply the requested mix policies.`);
            if (query.layout === 'prototype' && api.prototypePatch < 0) throw new Error(`Build ${build.id} retained Standard layout because no district met prototype safeguards.`);
            if (query.layout === 'frontage-growth' && api.prototypePatch < 0) throw new Error(`Build ${build.id} retained Standard layout because no district met frontage-growth safeguards.`);
            if (api.seed !== query.seed || api.size !== query.size || api.walls !== query.walls
              || Boolean(api.blockFrontage) !== (query.buildings === 'frontage')
              || Boolean(api.footprints) !== (query.buildings === 'footprints')) {
              throw new Error(`Build ${build.id} cannot reproduce the requested settings.`);
            }
            completed = true;
            clearTimeout(timer);
            resolveEngine(frame);
            return;
          }
          await new Promise(resolveAttempt => setTimeout(resolveAttempt, 40));
        }
      } catch (error) {
        completed = true;
        clearTimeout(timer);
        reject(error);
      }
    };
    const url = new URL(build.url, root);
    url.search = new URLSearchParams({ seed: query.seed, size: query.size, walls: query.walls ? '1' : '0',
      buildings: query.buildings, style: query.style, layout: query.layout,
      mix: query.mix ?? 50, overrides: query.overrides ?? '', embed: '1' });
    frame.src = url.href;
    document.body.append(frame);
  });
}

function capturePng(frame) {
  return new Promise((resolvePng, reject) => {
    const engine = frame.contentWindow;
    const save = engine.saveAs;
    const timer = setTimeout(() => { engine.saveAs = save; reject(new Error('PNG capture timed out.')); }, 20000);
    engine.saveAs = blob => {
      engine.saveAs = save;
      const reader = new FileReader();
      reader.onload = () => { clearTimeout(timer); resolvePng(reader.result); };
      reader.onerror = () => { clearTimeout(timer); reject(new Error('PNG capture failed.')); };
      reader.readAsDataURL(blob);
    };
    try { engine.cityGenerator.exportPng(); }
    catch (error) { clearTimeout(timer); engine.saveAs = save; reject(error); }
  });
}

function comparisonUrl() {
  const url = new URL('compare.html', root);
  url.search = new URLSearchParams({ before: settings.before, after: settings.after, seed: settings.seed,
    size: settings.size, walls: settings.walls ? '1' : '0', buildings: settings.buildings, style: settings.style,
    beforeLayout: settings.beforeLayout, afterLayout: settings.afterLayout, beforeMix: settings.beforeMix, afterMix: settings.afterMix,
    beforeOverrides: settings.beforeOverrides, afterOverrides: settings.afterOverrides, view: regionInput.value });
  return url;
}

async function render() {
  if (!form.reportValidity()) return;
  for (const frame of frames) frame.remove();
  frames = [];
  snapshots.clear();
  if (settings && (settings.seed !== Number(seedInput.value) || settings.size !== Number(sizeInput.value)
    || settings.walls !== wallsInput.checked)) {
    document.querySelector('#before-overrides').value = '';
    document.querySelector('#after-overrides').value = '';
  }
  for (const canvas of document.querySelectorAll('.comparison-canvas')) {
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 600, 600);
  }
  settings = { before: beforeInput.value, after: afterInput.value, seed: Number(seedInput.value),
    size: Number(sizeInput.value), walls: wallsInput.checked, buildings: buildingsInput.value, style: styleInput.value,
    beforeLayout: beforeLayoutInput.value, afterLayout: afterLayoutInput.value,
    beforeMix: Number(beforeMixInput.value), afterMix: Number(afterMixInput.value),
    beforeOverrides: document.querySelector('#before-overrides').value, afterOverrides: document.querySelector('#after-overrides').value };
  history.replaceState(null, '', comparisonUrl());
  status.textContent = 'Rendering comparison...';
  for (const control of form.elements) control.disabled = true;
  for (const button of document.querySelectorAll('.download-comparison')) button.disabled = true;
  try {
    await Promise.all(['before', 'after'].map(async side => {
      const build = catalog.builds.find(candidate => candidate.id === settings[side]);
      if (!build) throw new Error(`Archived build ${settings[side]} is not available.`);
      document.querySelector(`[data-side="${side}"] .comparison-build`).textContent = build.id;
      const frame = await loadEngine(build, { ...settings, layout: settings[`${side}Layout`],
        mix: settings[`${side}Mix`], overrides: settings[`${side}Overrides`] });
      await new Promise(resolveFrame => frame.contentWindow.requestAnimationFrame(() =>
        frame.contentWindow.requestAnimationFrame(resolveFrame)));
      const png = await capturePng(frame);
      const image = new Image();
      image.src = png;
      await image.decode();
      if (image.width !== 2048 || image.height !== 2048) throw new Error('Unexpected comparison export dimensions.');
      snapshots.set(side, { build, png, image, prototypeCrop: frame.contentWindow.cityGenerator.prototypeCrop,
        policyId: frame.contentWindow.cityGenerator.districtOverrideId ?? '' });
    }));
    const crop = snapshots.get('after').prototypeCrop ?? snapshots.get('before').prototypeCrop;
    if (crop) regions.prototype = [crop.left, crop.top];
    else delete regions.prototype;
    regionInput.querySelector('option[value="prototype"]').disabled = !crop;
    if (regionInput.value === 'prototype' && !crop) regionInput.value = 'whole';
    draw();
    status.textContent = `Seed ${settings.seed} · Size ${settings.size} · ${settings.walls ? 'Walled' : 'Open'} · ${settings.buildings}`;
    for (const button of document.querySelectorAll('.download-comparison')) button.disabled = false;
    const back = new URL(`builds/${settings.after}/`, root);
    back.search = new URLSearchParams({ seed: settings.seed, size: settings.size, walls: settings.walls ? '1' : '0', buildings: settings.buildings, style: settings.style,
      layout: settings.afterLayout, mix: settings.afterMix, overrides: settings.afterOverrides });
    document.querySelector('#back-link').href = back.href;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    for (const control of form.elements) control.disabled = false;
    for (const frame of frames) frame.remove();
    frames = [];
  }
}

form.addEventListener('submit', event => { event.preventDefault(); render(); });
regionInput.addEventListener('change', () => { draw(); if (settings) history.replaceState(null, '', comparisonUrl()); });
for (const button of document.querySelectorAll('.download-comparison')) {
  button.addEventListener('click', () => {
    const side = button.closest('[data-side]').dataset.side;
    const snapshot = snapshots.get(side);
    if (!snapshot) return;
    const anchor = document.createElement('a');
    anchor.href = regions[regionInput.value] ? button.closest('figure').querySelector('canvas').toDataURL('image/png') : snapshot.png;
    const policy = settings[`${side}Layout`] === 'mixed' ? `-mix${settings[`${side}Mix`]}${snapshot.policyId ? `-policies${snapshot.policyId}` : ''}` : '';
    anchor.download = `city-${settings.size}-${settings.seed}-${settings.walls ? 'walled' : 'open'}-${settings.buildings}-${side}-${snapshot.build.id}-${settings.style}-${settings[`${side}Layout`]}${policy}-${regionInput.value}.png`;
    anchor.click();
  });
}
document.querySelector('#copy-comparison').addEventListener('click', async () => {
  if (!settings) return;
  try { await navigator.clipboard.writeText(comparisonUrl().href); status.textContent = 'Comparison link copied.'; }
  catch {
    const input = document.querySelector('#comparison-link');
    input.value = comparisonUrl().href;
    document.querySelector('#comparison-link-dialog').showModal();
    input.select();
  }
});

try {
  const response = await fetch(new URL('builds.json', root), { cache: 'no-store' });
  if (!response.ok) throw new Error('Build catalog is unavailable.');
  catalog = await response.json();
  for (const input of [beforeInput, afterInput]) {
    for (const build of catalog.builds) input.add(new Option(`${build.id}${build.legacy ? ' (legacy engine)' : ''}`, build.id));
  }
  const after = params.get('after') ?? catalog.current;
  const requestedStyle = params.get('style') ?? 'flat';
  const requestedBeforeLayout = params.get('beforeLayout') ?? 'standard';
  const compatible = build => (requestedStyle === 'flat' || build.styles?.includes(requestedStyle))
    && (requestedBeforeLayout === 'standard' || build.layouts?.includes(requestedBeforeLayout));
  const before = params.get('before') ?? catalog.builds.find(build => build.id !== after && !build.dirty && compatible(build))?.id
    ?? catalog.builds.find(build => build.id !== after && compatible(build))?.id ?? after;
  if (![before, after].every(id => catalog.builds.some(build => build.id === id))) throw new Error('A requested archived build is unavailable.');
  beforeInput.value = before;
  afterInput.value = after;
  seedInput.value = params.get('seed') ?? '682063530';
  sizeInput.value = params.get('size') ?? '40';
  wallsInput.checked = params.get('walls') !== '0';
  buildingsInput.value = params.get('buildings') ?? 'frontage';
  styleInput.value = params.get('style') ?? 'flat';
  beforeLayoutInput.value = params.get('beforeLayout') ?? 'standard';
  afterLayoutInput.value = params.get('afterLayout') ?? params.get('layout') ?? 'standard';
  beforeMixInput.value = params.get('beforeMix') ?? params.get('mix') ?? '50';
  afterMixInput.value = params.get('afterMix') ?? params.get('mix') ?? '50';
  document.querySelector('#before-overrides').value = params.get('beforeOverrides') ?? '';
  document.querySelector('#after-overrides').value = params.get('afterOverrides') ?? params.get('overrides') ?? '';
  regionInput.value = params.get('view') ?? 'whole';
  document.querySelector('#back-link').href = root.href;
  await render();
} catch (error) { status.textContent = error.message; }