const sizeInput = document.querySelector('#city-size');
const wallsInput = document.querySelector('#walls');
const buildingsInput = document.querySelector('#buildings');
const regenerateButton = document.querySelector('#regenerate');
const exportButton = document.querySelector('#export');
const seedInput = document.querySelector('#seed');
const applySeedButton = document.querySelector('#apply-seed');
const copyButton = document.querySelector('#copy-link');
const compareButton = document.querySelector('#compare');
const styleInput = document.querySelector('#render-style');
const layoutInput = document.querySelector('#neighborhood-layout');
const mixInput = document.querySelector('#growth-mix');
const mixDialog = document.querySelector('#district-dialog');
const status = document.querySelector('#build-status');
const appRoot = new URL(window.cityBuild?.appRoot ?? './', location.href);
document.querySelector('#site-contract').addEventListener('click', () => { location.href = new URL('inspector.html', appRoot).href; });
if (new URLSearchParams(location.search).get('embed') === '1') document.body.classList.add('embedded');

function showStatus(message) {
  status.textContent = message;
  status.hidden = !message;
}

async function mixedWork(action) {
  for (const control of document.querySelectorAll('.toolbar input, .toolbar select, .toolbar button, .mix-controls input, .mix-controls button')) control.disabled = true;
  showStatus('Generating mixed neighborhoods...');
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try { action(); showStatus(''); }
  catch (error) { showStatus(`Generation failed: ${error.message}`); }
  finally {
    document.dispatchEvent(new Event('city-ready'));
    for (const control of document.querySelectorAll('.mix-controls input, .mix-controls button')) control.disabled = false;
  }
}

function cityUrl() {
  const city = window.cityGenerator;
  const url = new URL(`builds/${city.buildId}/`, appRoot);
  url.search = new URLSearchParams({ size: city.size, seed: city.seed, walls: city.walls ? '1' : '0',
    buildings: city.blockFrontage ? 'frontage' : (city.footprints ? 'footprints' : 'original'),
    style: city.diagnostic ? 'diagnostic' : (city.roofed ? 'roofed' : 'flat'), layout: city.mixed ? 'mixed' : (city.frontageGrowth ? 'frontage-growth' : (city.prototype ? 'prototype' : 'standard')) });
  if (city.mixed) {
    url.searchParams.set('mix', city.mixPercent);
    if (city.districtOverrides) url.searchParams.set('overrides', city.districtOverrides);
  }
  return url;
}

document.addEventListener('city-ready', () => {
  sizeInput.value = window.cityGenerator.size;
  wallsInput.checked = window.cityGenerator.walls;
  buildingsInput.value = window.cityGenerator.blockFrontage ? 'frontage' : (window.cityGenerator.footprints ? 'footprints' : 'original');
  seedInput.value = window.cityGenerator.seed;
  styleInput.value = window.cityGenerator.diagnostic ? 'diagnostic' : (window.cityGenerator.roofed ? 'roofed' : 'flat');
  styleInput.querySelector('option[value="diagnostic"]').disabled = !window.cityGenerator.frontageGrowth && !window.cityGenerator.mixed;
  document.querySelector('#frontage-legend').hidden = !window.cityGenerator.diagnostic;
  layoutInput.value = window.cityGenerator.mixed ? 'mixed' : (window.cityGenerator.frontageGrowth ? 'frontage-growth' : (window.cityGenerator.prototype ? 'prototype' : 'standard'));
  document.querySelector('#mix-controls').hidden = !window.cityGenerator.mixed;
  mixInput.value = window.cityGenerator.mixPercent;
  document.querySelector('#growth-mix-value').textContent = `${mixInput.value}%`;
  const policies = window.cityGenerator.districtPolicies ?? [];
  const growth = policies.filter(policy => policy.applied === 'growth').length;
  const fallbacks = policies.filter(policy => policy.status === 'fallback').length;
  document.querySelector('#mix-summary').textContent = `${growth} growth · ${policies.length - growth} grid (${fallbacks} fallback)`;
  document.querySelector('#build-id').textContent = window.cityGenerator.buildId;
  for (const control of [sizeInput, wallsInput, buildingsInput, styleInput, seedInput, applySeedButton, copyButton, compareButton, regenerateButton, exportButton]) control.disabled = false;
  layoutInput.disabled = !window.cityGenerator.blockFrontage;
  if (window.cityBuild?.id !== window.cityGenerator.buildId) showStatus('Build mismatch: reload this page.');
  else if ((window.cityGenerator.prototype || window.cityGenerator.frontageGrowth) && window.cityGenerator.prototypePatch < 0) showStatus('No suitable district met the prototype safeguards; Standard layout retained.');
  else if (status.textContent.startsWith('No suitable district')) showStatus('');
});

document.querySelector('#seed-form').addEventListener('submit', event => {
  event.preventDefault();
  if (seedInput.reportValidity()) {
    const apply = () => window.cityGenerator.restoreSeed(Number(seedInput.value));
    if (window.cityGenerator.mixed) mixedWork(apply); else apply();
  }
});

copyButton.addEventListener('click', async () => {
  const url = cityUrl().href;
  try {
    await navigator.clipboard.writeText(url);
    showStatus('City link copied.');
  } catch {
    const input = document.querySelector('#city-link');
    input.value = url;
    document.querySelector('#link-dialog').showModal();
    input.select();
  }
});

compareButton.addEventListener('click', () => {
  const url = new URL('compare.html', appRoot);
  url.search = cityUrl().search;
  url.searchParams.set('after', window.cityGenerator.buildId);
  url.searchParams.set('beforeLayout', window.cityGenerator.diagnostic ? (window.cityGenerator.mixed ? 'mixed' : 'frontage-growth') : 'standard');
  url.searchParams.set('afterLayout', window.cityGenerator.mixed ? 'mixed' : (window.cityGenerator.frontageGrowth ? 'frontage-growth' : (window.cityGenerator.prototype ? 'prototype' : 'standard')));
  if (window.cityGenerator.mixed) {
    url.searchParams.set('afterMix', window.cityGenerator.mixPercent);
    url.searchParams.set('afterOverrides', window.cityGenerator.districtOverrides);
    if (window.cityGenerator.diagnostic) {
      url.searchParams.set('beforeMix', window.cityGenerator.mixPercent);
      url.searchParams.set('beforeOverrides', window.cityGenerator.districtOverrides);
    }
  }
  if (window.cityGenerator.prototype || window.cityGenerator.frontageGrowth) url.searchParams.set('view', 'prototype');
  location.href = url.href;
});

function generate(newSeed) {
  if (!sizeInput.reportValidity()) return;
  const walls = new URLSearchParams(location.search).has('walls') ? wallsInput.checked : null;
  const apply = () => window.cityGenerator.generate(Number(sizeInput.value), walls, newSeed, buildingsInput.value === 'footprints', buildingsInput.value === 'frontage', layoutInput.value === 'prototype', layoutInput.value === 'frontage-growth', layoutInput.value === 'mixed');
  if (layoutInput.value === 'mixed') mixedWork(apply); else apply();
}

sizeInput.addEventListener('change', () => generate(false));
wallsInput.addEventListener('change', () => {
  if (!sizeInput.reportValidity()) return;
  const apply = () => window.cityGenerator.generate(Number(sizeInput.value), wallsInput.checked, false, buildingsInput.value === 'footprints', buildingsInput.value === 'frontage', layoutInput.value === 'prototype', layoutInput.value === 'frontage-growth', layoutInput.value === 'mixed');
  if (layoutInput.value === 'mixed') mixedWork(apply); else apply();
});
buildingsInput.addEventListener('change', () => generate(false));
styleInput.addEventListener('change', () => styleInput.value === 'diagnostic' ? window.cityGenerator.setDiagnostic() : window.cityGenerator.setStyle(styleInput.value === 'roofed'));
layoutInput.addEventListener('change', () => generate(false));
regenerateButton.addEventListener('click', () => generate(true));
exportButton.addEventListener('click', () => window.cityGenerator.exportPng());

mixInput.addEventListener('input', () => { document.querySelector('#growth-mix-value').textContent = `${mixInput.value}%`; });
mixInput.addEventListener('change', () => mixedWork(() => window.cityGenerator.setMix(Number(mixInput.value), window.cityGenerator.districtOverrides)));

function openDistrictPolicies(selected = null) {
  if (selected !== null && !window.cityGenerator.districtPolicies.some(policy => policy.index === selected)) return;
  const list = document.querySelector('#district-policy-list');
  list.replaceChildren();
  for (const policy of window.cityGenerator.districtPolicies) {
    const row = document.createElement('div'); row.className = 'district-policy-row';
    if (policy.index === selected) row.classList.add('selected-district');
    const label = document.createElement('label');
    label.htmlFor = `policy-${policy.index}`;
    label.textContent = `District ${policy.index} · ${policy.label ?? 'Neighborhood'}`;
    const select = document.createElement('select'); select.id = label.htmlFor; select.dataset.district = policy.index;
    for (const [value, text] of [['auto', 'Automatic'], ['grid', 'Grid'], ['growth', 'Growth']]) select.add(new Option(text, value));
    select.value = policy.policy;
    const state = document.createElement('output');
    state.textContent = policy.status === 'fallback' ? 'Growth rejected · Grid retained' : (policy.applied === 'growth' ? 'Growth applied' : 'Grid applied');
    row.append(label, select, state); list.append(row);
  }
  mixDialog.showModal();
  if (selected !== null) document.querySelector('.selected-district')?.scrollIntoView({block:'center'});
}
document.querySelector('#district-policies').addEventListener('click', () => openDistrictPolicies());
document.addEventListener('district-selected', event => openDistrictPolicies(event.detail));
document.querySelector('#apply-district-policies').addEventListener('click', () => {
  const overrides = [...document.querySelectorAll('#district-policy-list select')]
    .filter(select => select.value !== 'auto').map(select => `${select.dataset.district}:${select.value}`).join(',');
  mixDialog.close();
  mixedWork(() => window.cityGenerator.setMix(Number(mixInput.value), overrides));
});
document.querySelector('#reset-district-policies').addEventListener('click', () => {
  mixDialog.close(); mixedWork(() => window.cityGenerator.setMix(Number(mixInput.value), ''));
});