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
    style: city.roofed ? 'roofed' : 'flat' });
  return url;
}

document.addEventListener('city-ready', () => {
  sizeInput.value = window.cityGenerator.size;
  wallsInput.checked = window.cityGenerator.walls;
  buildingsInput.value = window.cityGenerator.blockFrontage ? 'frontage' : (window.cityGenerator.footprints ? 'footprints' : 'original');
  seedInput.value = window.cityGenerator.seed;
  styleInput.value = window.cityGenerator.roofed ? 'roofed' : 'flat';
  document.querySelector('#build-id').textContent = window.cityGenerator.buildId;
  for (const control of [sizeInput, wallsInput, buildingsInput, styleInput, seedInput, applySeedButton, copyButton, compareButton, regenerateButton, exportButton]) control.disabled = false;
  if (window.cityBuild?.id !== window.cityGenerator.buildId) showStatus('Build mismatch: reload this page.');
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
  location.href = url.href;
});

function generate(newSeed) {
  if (!sizeInput.reportValidity()) return;
  const walls = new URLSearchParams(location.search).has('walls') ? wallsInput.checked : null;
  window.cityGenerator.generate(Number(sizeInput.value), walls, newSeed, buildingsInput.value === 'footprints', buildingsInput.value === 'frontage');
}

sizeInput.addEventListener('change', () => generate(false));
wallsInput.addEventListener('change', () => {
  if (!sizeInput.reportValidity()) return;
  window.cityGenerator.generate(Number(sizeInput.value), wallsInput.checked, false, buildingsInput.value === 'footprints', buildingsInput.value === 'frontage');
});
buildingsInput.addEventListener('change', () => generate(false));
styleInput.addEventListener('change', () => window.cityGenerator.setStyle(styleInput.value === 'roofed'));
regenerateButton.addEventListener('click', () => generate(true));
exportButton.addEventListener('click', () => window.cityGenerator.exportPng());