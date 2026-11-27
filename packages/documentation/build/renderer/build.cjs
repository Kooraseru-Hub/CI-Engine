'use strict';
// A component-owned entry point for documentation renderer. The CI system sees only the site output.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(process.env.DOCS_ROOT || process.cwd());
const site = __dirname;
const output = path.resolve(root, process.env.DOCS_OUTPUT || 'build/github/pages');
const staging = path.join(site, 'dist');
const docs = path.resolve(root, process.env.DOCS_DIRECTORY || 'content/docs');
const images = path.resolve(root, process.env.DOCS_IMAGES || 'content/images');
const theme = path.resolve(root, process.env.DOCS_THEME || 'content/theme.css');
const stagedDocs = path.join(site, 'src/content/docs');
const stagedTheme = path.join(site, 'src/styles/project.css');
const favicon = path.resolve(root, process.env.DOCS_FAVICON || path.join(images, 'favicon.png'));
const stagedFavicon = path.join(site, 'public/images/favicon.png');

function stageFavicon(input = favicon, destination = stagedFavicon) {
  if (!fs.existsSync(input) || fs.lstatSync(input).isSymbolicLink() ||
      !fs.statSync(input).isFile()) {
    throw new Error('Missing or invalid authored favicon: ' + input);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink())
    throw new Error('Refusing symlinked staged favicon: ' + destination);
  fs.copyFileSync(input, destination);
  return destination;
}


function assertDirectory(input) {
  if (!fs.existsSync(input) || fs.lstatSync(input).isSymbolicLink() || !fs.statSync(input).isDirectory())
    throw new Error('Expected a non-symlink documentation directory: ' + input);
}

function stageDocs(source, destination, skipRepository = false, depth = 0) {
  assertDirectory(source);
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Refusing linked documentation source: ' + entry.name);
    if (skipRepository && entry.name === 'repository') continue;
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) stageDocs(from, to, false, depth + 1);
    else if (entry.isFile() && entry.name.endsWith('.api.yaml')) {
      const { compileReference } = require('./api-source.cjs');
      const data = require('yaml').parse(fs.readFileSync(from, 'utf8'));
      const target = to.replace(/\.api\.yaml$/, '.mdx');
      if (fs.existsSync(target) || fs.existsSync(from.replace(/\.api\.yaml$/, '.mdx'))) throw Error('Conflicting API source: ' + from);
      fs.writeFileSync(target, compileReference(data, '../'.repeat(depth + 2) + 'components/'));
    }
    else if (entry.isFile() && /\.(?:md|mdx)$/.test(entry.name)) fs.copyFileSync(from, to);
  }
}

function prepareSite(options = {}) {
  const source = options.docs || docs;
  const staged = options.stagedDocs || stagedDocs;
  const themeFile = options.theme || theme;
  const stagedCss = options.stagedTheme || stagedTheme;
  assertDirectory(source);
  if (fs.existsSync(staged)) {
    if (fs.lstatSync(staged).isSymbolicLink()) throw new Error('Refusing linked documentation renderer staging directory');
    fs.rmSync(staged, { recursive: true });
  }
  stageDocs(source, staged, true);
  if (!['index.md','index.mdx'].some(name=>fs.existsSync(path.join(staged,name))))
    throw new Error('Missing staged documentation homepage');
  fs.mkdirSync(path.dirname(stagedCss), { recursive: true });
  if (fs.existsSync(themeFile)) {
    if (fs.lstatSync(themeFile).isSymbolicLink() || !fs.statSync(themeFile).isFile())
      throw new Error('Refusing invalid project theme: ' + themeFile);
    fs.copyFileSync(themeFile, stagedCss);
  } else {
    fs.writeFileSync(stagedCss, '/* No project theme override. */\n');
  }
  const stagedIcon = stageFavicon(options.favicon || favicon, options.stagedFavicon || stagedFavicon);
  return { staged, stagedCss, stagedIcon };
}


function run(program, args, cwd = root) {
  const result = spawnSync(program, args, { cwd, stdio: 'inherit', shell: false,
    windowsHide: true, timeout: 300_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  if (result.error || result.status !== 0) {
    throw new Error(program + ' failed: ' + (result.error?.message || 'exit ' + result.status));
  }
}

function copyAssets(source, destination) {
  if (!fs.existsSync(source)) return;
  if (!fs.lstatSync(source).isDirectory()) throw new Error('Invalid image directory: ' + source);
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Refusing linked documentation asset: ' + entry.name);
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyAssets(from, to);
    else if (entry.isFile() && entry.name !== '.gitkeep') fs.copyFileSync(from, to);
    else if (!entry.isFile()) throw new Error('Unsupported documentation asset: ' + from);
  }
}

async function build() {
  if (fs.existsSync(output)) {
    if (fs.lstatSync(output).isSymbolicLink()) throw new Error('Refusing symlinked Pages output');
    fs.rmSync(output, { recursive: true });
  }
  const astroManifest = path.join(site, 'node_modules/astro/package.json');
  if (!fs.existsSync(astroManifest)) {
    // Exact direct versions are declared in the component's package.json.
    // This install is isolated from the workspace npm dependency loader.
    let npm = 'npm', args = ['install', '--no-audit', '--no-fund', '--no-package-lock'];
    if (process.platform === 'win32') {
      const candidates = [path.dirname(process.execPath), ...(process.env.PATH || '').split(path.delimiter)]
        .filter(Boolean).map(dir => path.join(dir, 'node_modules/npm/bin/npm-cli.js'));
      const cli = candidates.find(file => fs.existsSync(file));
      if (!cli) throw new Error('Cannot locate npm-cli.js');
      npm = process.execPath;
      args = [cli, ...args];
    }
    run(npm, args, site);
  }
  prepareSite();
  const installed = JSON.parse(fs.readFileSync(astroManifest, 'utf8'));
  const bin = typeof installed.bin === 'string' ? installed.bin : installed.bin?.astro;
  if (typeof bin !== 'string' || !bin) throw new Error('Astro installation has no CLI entry point');
  const cli = path.join(site, 'node_modules/astro', bin);
  if (!fs.existsSync(cli)) throw new Error('Missing Astro CLI: ' + cli);
  run(process.execPath, [cli, 'build', '--root', site]);
  // Keep dynamic prerender dependencies under the documentation renderer package while
  // compiling, then export plain static assets into the CI output contract.
  if (!fs.existsSync(path.join(staging, 'index.html'))) {
    throw new Error('documentation renderer did not produce dist/index.html');
  }
  run(process.execPath, [path.join(site,'node_modules/pagefind/lib/runner/bin.cjs'),'--site',staging], site);
  fs.cpSync(staging, output, { recursive: true, force: true });
  copyAssets(images, path.join(output, 'images'));
  if (process.env.DOCS_ASSET_MANIFEST) await require('./reference-assets.cjs').stageAssets(path.resolve(root,process.env.DOCS_ASSET_MANIFEST),path.join(output,'images'),path.join(root,'build/cache/documentation-assets'));
  if (!fs.existsSync(path.join(output, 'index.html'))) {
    throw new Error('documentation renderer failed to produce static output index.html');
  }
  process.stdout.write('documentation renderer: built ' + output + '\n');
}

module.exports = { build, prepareSite, stageFavicon, copyAssets, root, site, output, docs };
if (require.main === module) {
  Promise.resolve().then(()=>process.argv.includes('--prepare')?prepareSite():build()).catch(error=>{console.error(String(error));process.exitCode=1;});
}
