import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'Export/html5/bin');
const history = join(root, '.toolchain/build-history');
const statePath = join(root, '.toolchain/build-state.json');
const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJson = (path, data) => writeFile(path, JSON.stringify(data, null, 2));

async function copyApp(source, destination) {
  await cp(source, destination, { recursive: true,
    filter: path => !relative(source, path).split('/').includes('builds') });
}

async function writeMetadata(directory, info, appRoot) {
  const metadata = { ...info, appRoot };
  await writeJson(join(directory, 'build-info.json'), metadata);
  await writeFile(join(directory, 'build-info.js'), `window.cityBuild = Object.freeze(${JSON.stringify(metadata)});\n`);
}

if (process.argv[2] === 'prepare') {
  await mkdir(history, { recursive: true });
  const legacySource = join(root, '.toolchain/pre-build-id-version');
  if (!(await readdir(history)).length) {
    const source = existsSync(join(legacySource, 'TownGenerator.js')) ? legacySource : output;
    if (existsSync(join(source, 'TownGenerator.js'))) {
      const engineSha256 = digest(await readFile(join(source, 'TownGenerator.js')));
      const info = { id: `legacy-${engineSha256.slice(0, 12)}`, engineSha256, commit: null,
        sourceHash: null, dirty: false, legacy: true, builtAt: new Date().toISOString() };
      const destination = join(history, info.id);
      await copyApp(source, destination);
      await writeMetadata(destination, info, '../../');
      await writeFile(join(destination, 'legacy-build.js'), `const previousSave = window.saveAs;
window.saveAs = function(blob, name, options) {
  return previousSave(blob, name.replace(/\\.png$/i, '-${info.id}.png'), options);
};\n`);
      const html = await readFile(join(destination, 'index.html'), 'utf8');
      await writeFile(join(destination, 'index.html'), html.replace('<script src="./controls.js">',
        '<script src="./build-info.js"></script><script src="./legacy-build.js"></script><script src="./controls.js">'));
    }
  }
  const paths = ['Source', 'Browser', 'Engine', 'Assets', 'project.xml', 'tsconfig.engine.json', 'scripts/build.sh', 'scripts/build-info.mjs', 'package.json', 'package-lock.json'];
  const files = git(['ls-files', '--cached', '--others', '--exclude-standard', '--', ...paths]).split('\n').filter(Boolean).sort();
  const hash = createHash('sha256');
  for (const path of files) {
    hash.update(`${path}\0`);
    hash.update(await readFile(join(root, path)));
  }
  const sourceHash = hash.digest('hex');
  const commit = git(['rev-parse', '--short=7', 'HEAD']);
  const dirty = Boolean(git(['status', '--porcelain', '--', ...paths]));
  const id = `${commit}${dirty ? '-dirty' : ''}-${sourceHash.slice(0, 10)}`;
  const styles = (await readFile(join(root, 'Browser/index.html'), 'utf8')).includes('id="render-style"')
    ? ['flat', 'roofed'] : ['flat'];
  if ((await readFile(join(root, 'Browser/index.html'), 'utf8')).includes('value="diagnostic"')) styles.push('diagnostic');
  const layouts = (await readFile(join(root, 'Browser/index.html'), 'utf8')).includes('id="neighborhood-layout"')
    ? ['standard', 'prototype'] : ['standard'];
  if ((await readFile(join(root, 'Browser/index.html'), 'utf8')).includes('value="frontage-growth"')) layouts.push('frontage-growth');
  if ((await readFile(join(root, 'Browser/index.html'), 'utf8')).includes('value="mixed"')) layouts.push('mixed');
  await writeJson(statePath, { id, commit, sourceHash, dirty, styles, layouts, legacy: false, builtAt: new Date().toISOString() });
  console.log(id);
} else if (process.argv[2] === 'finish') {
  const info = JSON.parse(await readFile(statePath, 'utf8'));
  info.engineSha256 = digest(await readFile(join(output, 'TownGenerator.js')));
  info.contractEngineSha256 = digest(await readFile(join(output, 'inspector.js')));
  const html = await readFile(join(output, 'index.html'), 'utf8');
  await writeFile(join(output, 'index.html'), html.replaceAll('__CITY_BUILD_ID__', info.id));
  await writeMetadata(output, info, './');
  const destination = join(history, info.id);
  if (existsSync(join(destination, 'build-info.json'))) {
    const previous = JSON.parse(await readFile(join(destination, 'build-info.json'), 'utf8'));
    if (previous.engineSha256 !== info.engineSha256) throw new Error('Build ID collision: refusing to replace a different archived engine.');
  } else {
    await copyApp(output, destination);
    await writeMetadata(destination, info, '../../');
  }
  const versions = [];
  for (const id of await readdir(history)) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) continue;
    const path = join(history, id, 'build-info.json');
    if (existsSync(path)) versions.push(JSON.parse(await readFile(path, 'utf8')));
  }
  versions.sort((first, second) => second.builtAt.localeCompare(first.builtAt));
  const selected = [info, ...versions.filter(version => version.id !== info.id)];
  for (const version of selected) {
    await mkdir(join(output, 'builds'), { recursive: true });
    await copyApp(join(history, version.id), join(output, 'builds', version.id));
  }
  await writeJson(join(output, 'builds.json'), { current: info.id, builds: selected.map(version => ({
    ...version, url: `builds/${version.id}/`,
  })) });
  console.log(`Build ${info.id}; ${selected.length} local comparison builds available.`);
}