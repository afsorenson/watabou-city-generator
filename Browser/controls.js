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
const status = document.querySelector('#build-status');
const appRoot = new URL(window.cityBuild?.appRoot ?? './', location.href);
if (new URLSearchParams(location.search).get('embed') === '1') document.body.classList.add('embedded');

function showStatus(message) {
  status.textContent = message;
  status.hidden = !message;
}

function cityUrl() {
  const city = window.cityGenerator;
  const url = new URL(`builds/${city.buildId}/`, appRoot);
  url.search = new URLSearchParams({ size: city.size, seed: city.seed, walls: city.walls ? '1' : '0',
    buildings: city.blockFrontage ? 'frontage' : (city.footprints ? 'footprints' : 'original'),
    style: city.diagnostic ? 'diagnostic' : (city.roofed ? 'roofed' : 'flat'), layout: city.frontageGrowth ? 'frontage-growth' : (city.prototype ? 'prototype' : 'standard') });
  return url;
}

document.addEventListener('city-ready', () => {
  sizeInput.value = window.cityGenerator.size;
  wallsInput.checked = window.cityGenerator.walls;
  buildingsInput.value = window.cityGenerator.blockFrontage ? 'frontage' : (window.cityGenerator.footprints ? 'footprints' : 'original');
  seedInput.value = window.cityGenerator.seed;
  styleInput.value = window.cityGenerator.diagnostic ? 'diagnostic' : (window.cityGenerator.roofed ? 'roofed' : 'flat');
  styleInput.querySelector('option[value="diagnostic"]').disabled = !window.cityGenerator.frontageGrowth;
  document.querySelector('#frontage-legend').hidden = !window.cityGenerator.diagnostic;
  layoutInput.value = window.cityGenerator.frontageGrowth ? 'frontage-growth' : (window.cityGenerator.prototype ? 'prototype' : 'standard');
  document.querySelector('#build-id').textContent = window.cityGenerator.buildId;
  for (const control of [sizeInput, wallsInput, buildingsInput, styleInput, seedInput, applySeedButton, copyButton, compareButton, regenerateButton, exportButton]) control.disabled = false;
  layoutInput.disabled = !window.cityGenerator.blockFrontage;
  if (window.cityBuild?.id !== window.cityGenerator.buildId) showStatus('Build mismatch: reload this page.');
  else if ((window.cityGenerator.prototype || window.cityGenerator.frontageGrowth) && window.cityGenerator.prototypePatch < 0) showStatus('No suitable district met the prototype safeguards; Standard layout retained.');
  else if (status.textContent.startsWith('No suitable district')) showStatus('');
});

document.querySelector('#seed-form').addEventListener('submit', event => {
  event.preventDefault();
  if (seedInput.reportValidity()) window.cityGenerator.restoreSeed(Number(seedInput.value));
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
  url.searchParams.set('beforeLayout', window.cityGenerator.diagnostic ? 'frontage-growth' : 'standard');
  url.searchParams.set('afterLayout', window.cityGenerator.frontageGrowth ? 'frontage-growth' : (window.cityGenerator.prototype ? 'prototype' : 'standard'));
  if (window.cityGenerator.prototype || window.cityGenerator.frontageGrowth) url.searchParams.set('view', 'prototype');
  location.href = url.href;
});

function generate(newSeed) {
  if (!sizeInput.reportValidity()) return;
  const walls = new URLSearchParams(location.search).has('walls') ? wallsInput.checked : null;
  window.cityGenerator.generate(Number(sizeInput.value), walls, newSeed, buildingsInput.value === 'footprints', buildingsInput.value === 'frontage', layoutInput.value === 'prototype', layoutInput.value === 'frontage-growth');
}

sizeInput.addEventListener('change', () => generate(false));
wallsInput.addEventListener('change', () => {
  if (!sizeInput.reportValidity()) return;
  window.cityGenerator.generate(Number(sizeInput.value), wallsInput.checked, false, buildingsInput.value === 'footprints', buildingsInput.value === 'frontage', layoutInput.value === 'prototype', layoutInput.value === 'frontage-growth');
});
buildingsInput.addEventListener('change', () => generate(false));
styleInput.addEventListener('change', () => styleInput.value === 'diagnostic' ? window.cityGenerator.setDiagnostic() : window.cityGenerator.setStyle(styleInput.value === 'roofed'));
layoutInput.addEventListener('change', () => generate(false));
regenerateButton.addEventListener('click', () => generate(true));
exportButton.addEventListener('click', () => window.cityGenerator.exportPng());