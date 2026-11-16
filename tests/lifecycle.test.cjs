'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { dispatch } = require('../src/lifecycle/dispatch.cjs');

function fixture(change = {}) {
  const repo = 'Kooraseru/Template';
  const env = {
    GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request_target',
    GITHUB_EVENT_PATH: '/tmp/close.json', GITHUB_REPOSITORY: repo,
    CI_PREVIEW_CLOSED_NUMBER: '52', GH_TOKEN: 'example',
    CLOUDFLARE_API_TOKEN: 'example', CLOUDFLARE_ACCOUNT_ID: 'example',
    ...change.env,
  };
  const event = {
    action: 'closed', repository: { full_name: repo },
    pull_request: {
      number: 52, base: { repo: { full_name: repo } },
      head: { repo: { full_name: repo } },
    }, ...change.event,
  };
  const config = { version: 1, routes: [{
    event: 'pull_request_target', action: 'closed',
    component: 'lifecycle/preview-retire',
    sameRepository: true, numberEnvironment: 'CI_PREVIEW_CLOSED_NUMBER',
  }] };
  const component = {
    boundary: 'privileged', events: ['pull_request_target'],
    command: ['node', 'ci/components/preview/retire.cjs'],
    credentials: ['gh_token', 'cloudflare_api_token'],
  };
  const files = {
    '/tmp/close.json': JSON.stringify(event),
    [path.join('/repo', '.github/config/ci/lifecycle.json')]:
      JSON.stringify(change.config || config),
    [path.join('/repo', '.github/config/ci/components/lifecycle/preview-retire/component.json')]:
      JSON.stringify(change.component || component),
  };
  const launched = [];
  const options = {
    env, cwd: '/repo',
    readFile: file => {
      if (!(file in files)) throw new Error('unknown fixture path ' + file);
      return files[file];
    },
    spawn: (command, args, spec) => {
      launched.push({ command, args, spec });
      return change.exit || { status: 0 };
    },
  };
  return { options, launched };
}

test('closed same-repository PR runs one protected component', () => {
  const { options, launched } = fixture();
  const result = dispatch(options);
  assert.equal(result.status, 'completed');
  assert.equal(result.component, 'lifecycle/preview-retire');
  assert.equal(launched.length, 1);
  assert.equal(launched[0].command, 'node');
  assert.equal(launched[0].spec.shell, false);
});

test('fork PR closure never executes privileged components', () => {
  const { options, launched } = fixture({
    event: { pull_request: {
      number: 52, base: { repo: { full_name: 'Kooraseru/Template' } },
      head: { repo: { full_name: 'someone/fork' } },
    } },
  });
  assert.equal(dispatch(options).status, 'skipped');
  assert.equal(launched.length, 0);
});

test('event identity, number binding and credentials fail closed', () => {
  const wrongNumber = fixture({ env: { CI_PREVIEW_CLOSED_NUMBER: '53' } });
  assert.throws(() => dispatch(wrongNumber.options), /event number/);
  const wrongRepository = fixture({ event: {
    repository: { full_name: 'someone/else' },
  } });
  assert.throws(() => dispatch(wrongRepository.options), /repository mismatch/);
  const missingCredential = fixture({ env: { GH_TOKEN: '' } });
  assert.throws(() => dispatch(missingCredential.options), /credentials unavailable/);
});

test('routes reject path traversal and ambiguous event admission', () => {
  const invalid = { version: 1, routes: [{
    event: 'pull_request_target', action: 'closed', component: '../evil',
    sameRepository: true, numberEnvironment: 'CI_PREVIEW_CLOSED_NUMBER',
  }] };
  assert.throws(() => dispatch(fixture({ config: invalid }).options),
    /unsafe lifecycle component identity/);
  const duplicates = { version: 1, routes: [
    { event: 'pull_request_target', action: 'closed', component: 'one' },
    { event: 'pull_request_target', action: 'closed', component: 'two' },
  ] };
  assert.throws(() => dispatch(fixture({ config: duplicates }).options),
    /ambiguous lifecycle event routing/);
});

test('failed lifecycle component fails the whole run', () => {
  const f = fixture({ exit: { status: 42 } });
  assert.throws(() => dispatch(f.options), /failed: 42/);
});


test('reusable workflow contains an isolated privileged lifecycle lane', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const yaml = fs.readFileSync(path.join(__dirname, '../.github/workflows/bootstrap.yml'), 'utf8');
  assert.match(yaml, /^  lifecycle:\s*$/m);
  assert.match(yaml, /  lifecycle:\n    name: Lifecycle\n    needs: resolve/);
  assert.match(yaml, /phase: lifecycle-resolve/);
  assert.match(yaml, /if: github\.event_name == 'pull_request_target' && github\.event\.action == 'closed'/);
  assert.match(yaml, /environment: ci-preview-cloudflare/);
  assert.match(yaml, /pull-requests: write/);
  assert.match(yaml, /cloudflare_api_token/);
  assert.match(yaml, /phase: lifecycle/);
  assert.match(yaml, /needs: \[cleanup, lifecycle\]/);
  assert.match(yaml, /needs\.lifecycle\.result/);
});


test('lifecycle admission runs in Resolve without privileged credentials', () => {
  const { options, launched } = fixture({ env: { GH_TOKEN: '', CLOUDFLARE_API_TOKEN: '' } });
  assert.deepEqual(dispatch({ ...options, validateOnly: true }), {
    status: 'validated', component: 'lifecycle/preview-retire',
  });
  assert.equal(launched.length, 0);
  assert.throws(() => dispatch({ ...options, env: { ...options.env, CI_PREVIEW_CLOSED_NUMBER: '53' }, validateOnly: true }), /event number/);
});
