const sizeInput = document.querySelector('#city-size');
const wallsInput = document.querySelector('#walls');
const buildingsInput = document.querySelector('#buildings');
const regenerateButton = document.querySelector('#regenerate');
const exportButton = document.querySelector('#export');

document.addEventListener('city-ready', () => {
  sizeInput.value = window.cityGenerator.size;
  wallsInput.checked = window.cityGenerator.walls;
  buildingsInput.value = window.cityGenerator.footprints ? 'footprints' : 'original';
  document.querySelector('#seed').textContent = window.cityGenerator.seed;
  for (const control of [sizeInput, wallsInput, buildingsInput, regenerateButton, exportButton]) control.disabled = false;
});

function generate(newSeed) {
  if (!sizeInput.reportValidity()) return;
  const walls = new URLSearchParams(location.search).has('walls') ? wallsInput.checked : null;
  window.cityGenerator.generate(Number(sizeInput.value), walls, newSeed, buildingsInput.value === 'footprints');
}

sizeInput.addEventListener('change', () => generate(false));
wallsInput.addEventListener('change', () => {
  if (!sizeInput.reportValidity()) return;
  window.cityGenerator.generate(Number(sizeInput.value), wallsInput.checked, false, buildingsInput.value === 'footprints');
});
buildingsInput.addEventListener('change', () => generate(false));
regenerateButton.addEventListener('click', () => generate(true));
exportButton.addEventListener('click', () => window.cityGenerator.exportPng());