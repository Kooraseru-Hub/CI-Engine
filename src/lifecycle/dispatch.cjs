'use strict';
// Generic CI Engine lifecycle admission and component dispatch.
// The consumer checkout and GitHub's protected environment are supplied by
// the fixed caller; this runner never elevates permissions or evaluates YAML.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const componentIdentity = /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/;
const repositoryName = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function fail(reason) {
  throw new Error('CI Engine lifecycle: ' + reason);
}

function readJson(file, readFile) {
  let data;
  try {
    data = JSON.parse(readFile(file, 'utf8'));
  } catch (error) {
    fail('invalid or missing JSON: ' + file + ' (' + error.message + ')');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    fail('expected a JSON object: ' + file);
  }
  return data;
}

function select(config, context, event) {
  if (config.version !== 1 || !Array.isArray(config.routes)) {
    fail('unsupported lifecycle route configuration');
  }
  const candidates = config.routes.filter(route =>
    route && route.event === context.GITHUB_EVENT_NAME &&
    route.action === event.action);
  if (candidates.length === 0) return null;
  if (candidates.length !== 1) fail('ambiguous lifecycle event routing');
  const route = candidates[0];
  if (typeof route.component !== 'string' ||
      !componentIdentity.test(route.component)) {
    fail('unsafe lifecycle component identity');
  }
  if (typeof route.sameRepository !== 'boolean') {
    fail('sameRepository must be explicitly declared');
  }
  if (typeof route.numberEnvironment !== 'string' ||
      !/^[A-Z][A-Z0-9_]*$/.test(route.numberEnvironment)) {
    fail('invalid lifecycle event number binding');
  }
  return route;
}

function dispatch(options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const readFile = options.readFile || fs.readFileSync;
  const spawn = options.spawn || spawnSync;
  if (env.GITHUB_ACTIONS !== 'true' ||
      !repositoryName.test(env.GITHUB_REPOSITORY || '') ||
      !env.GITHUB_EVENT_PATH ||
      !env.GITHUB_EVENT_NAME) {
    fail('requires an authenticated GitHub Actions event');
  }
  const event = readJson(env.GITHUB_EVENT_PATH, readFile);
  if (event.repository?.full_name !== env.GITHUB_REPOSITORY) {
    fail('event repository mismatch');
  }
  const config = readJson(path.join(cwd, '.github/config/ci/lifecycle.json'), readFile);
  const route = select(config, env, event);
  if (!route) return { status: 'skipped', reason: 'no configured event action' };

  const number = event.pull_request?.number;
  if (!Number.isSafeInteger(number) || number < 1 ||
      String(number) !== env[route.numberEnvironment]) {
    fail('event number does not match trusted workflow binding');
  }
  if (event.pull_request?.base?.repo?.full_name !== env.GITHUB_REPOSITORY) {
    fail('event base repository mismatch');
  }
  if (route.sameRepository &&
      event.pull_request?.head?.repo?.full_name !== env.GITHUB_REPOSITORY) {
    return { status: 'skipped', reason: 'external pull request' };
  }

  const manifestPath = path.join(cwd, '.github/config/ci/components',
    route.component, 'component.json');
  const component = readJson(manifestPath, readFile);
  if (component.boundary !== 'privileged' ||
      !Array.isArray(component.events) ||
      !component.events.includes(env.GITHUB_EVENT_NAME) ||
      !Array.isArray(component.command) || component.command.length === 0 ||
      !component.command.every(x => typeof x === 'string' && x.length > 0 &&
        !/[\r\n\0]/.test(x))) {
    fail('invalid privileged lifecycle component contract');
  }
  if (options.validateOnly === true) {
    return { status: 'validated', component: route.component };
  }
  if (!Array.isArray(component.credentials) ||
      !component.credentials.every(name => typeof name === 'string' &&
        /^[a-z][a-z0-9_]*$/.test(name) && !!env[name.toUpperCase()])) {
    fail('lifecycle component credentials unavailable');
  }

  const command = component.command;
  const result = spawn(command[0], command.slice(1), {
    cwd, env, stdio: 'inherit', shell: false, timeout: 900000,
  });
  if (result.error || result.status !== 0) {
    fail(route.component + ' failed: ' + (result.error?.message || result.status));
  }
  return { status: 'completed', component: route.component };
}

module.exports = { dispatch, select };
if (require.main === module) {
  try {
    const outcome = dispatch({ validateOnly: process.argv.includes('--check') });
    console.log('CI Engine lifecycle: ' + outcome.status +
      (outcome.component ? ' (' + outcome.component + ')' : ''));
  } catch (error) {
    console.error('::error::' + error.message);
    process.exitCode = 1;
  }
}
