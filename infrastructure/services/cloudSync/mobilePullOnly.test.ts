import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

// Native Node type stripping only; no project dependencies or build required.
function load(path: string, names: string[], extra: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\s*$/gm, '')
    .replace(/^export default .*;\s*$/gm, '')
    .replace(/\bexport /g, '');
  const context = vm.createContext({
    window: { __netcattyMobileMode: true }, console,
    setTimeout, clearTimeout, AbortController, crypto,
    SYNC_CONSTANTS: { GITHUB_CLIENT_ID: '', GITHUB_API_BASE: 'https://example.invalid' },
    netcattyBridge: { get: () => null }, ...extra,
  });
  return vm.runInContext(stripTypeScriptTypes(source) + `\n;({${names.join(',')}})`, context);
}

const { syncToProviderImpl } = load('./providerSyncMethods.ts', ['syncToProviderImpl']);
function manager() {
  const calls: string[] = [];
  return {
    calls, state: { securityState: 'UNLOCKED', providers: {}, syncState: 'IDLE' },
    masterPassword: 'test-only',
    updateProviderStatus() {}, notifyStateChange() {}, emit() {},
    async downloadFromProvider() { calls.push('download'); return { payload: {}, remoteFile: { meta: {} } }; },
    async commitRemoteInspection() { calls.push('commit'); },
  };
}

test('mobile empty vault pulls, applies once, then commits once', async () => {
  const m = manager();
  const result = await syncToProviderImpl.call(m, 'github', {}, {
    async applyConvergentPayload(_payload: unknown, commit: () => Promise<void>) {
      m.calls.push('apply'); await commit(); await commit();
    },
  });
  assert.deepEqual(m.calls, ['download', 'apply', 'commit']);
  assert.equal(result.success, true);
  assert.equal(result.mergedPayloadApplied, true);
  assert.ok(result.remoteFile);
});

test('security change during download cannot apply or acknowledge remote', async () => {
  const m = manager();
  Object.assign(m, {
    getSyncSecurityGeneration: () => 1,
    assertSyncSecurityGeneration: () => { throw new Error('Vault locked during download'); },
  });
  const result = await syncToProviderImpl.call(m, 'github', {}, {
    async applyConvergentPayload() { m.calls.push('apply'); },
  });
  assert.equal(result.success, false);
  assert.deepEqual(m.calls, ['download']);
});

test('mobile sync-all applies each provider independently, never fan-out uploads', async () => {
  const { syncAllProvidersImpl } = load('./syncAllStorageMethods.ts', ['syncAllProvidersImpl'], {
    isProviderReadyForSync: () => true,
  });
  const m = manager();
  m.state.providers = { github: {}, s3: {} };
  Object.assign(m, {
    syncToProvider(provider: string, payload: unknown, opts: unknown) {
      return syncToProviderImpl.call(m, provider, payload, opts);
    },
  });
  const results = await syncAllProvidersImpl.call(m, {}, {
    async applyConvergentPayload(_payload: unknown, commit: () => Promise<void>) {
      m.calls.push('apply'); await commit();
    },
  });
  assert.equal(results.size, 2);
  assert.deepEqual(m.calls, ['download', 'apply', 'commit', 'download', 'apply', 'commit']);
  assert.ok([...results.values()].every(r => r.mergedPayloadApplied));
});

test('failed apply does not acknowledge remote', async () => {
  const m = manager();
  const result = await syncToProviderImpl.call(m, 'github', {}, {
    async applyConvergentPayload() { throw new Error('apply failed'); },
  });
  assert.equal(result.success, false);
  assert.deepEqual(m.calls, ['download']);
});

test('legacy caller receives uncommitted payload and file for apply-first flow', async () => {
  const m = manager();
  const result = await syncToProviderImpl.call(m, 's3', {});
  assert.equal(result.success, true);
  assert.ok(result.remoteFile);
  assert.equal(result.mergedPayloadApplied, undefined);
  assert.deepEqual(m.calls, ['download']);
});

test('protected applier must invoke commit callback', async () => {
  const m = manager();
  const result = await syncToProviderImpl.call(m, 'webdav', {}, {
    async applyConvergentPayload() {},
  });
  assert.equal(result.success, false);
  assert.deepEqual(m.calls, ['download']);
});

for (const name of ['GitHub', 'GoogleDrive', 'OneDrive', 'WebDAV', 'S3']) {
  test(`${name} rejects uploads and deletes before touching network or credentials`, async () => {
    const className = `${name}Adapter`;
    const Adapter = load(`../adapters/${className}.ts`, [className])[className];
    await assert.rejects(Adapter.prototype.upload.call({}, {}), /download-only/);
    await assert.rejects(Adapter.prototype.deleteSync.call({}), /download-only/);
  });
}

test('PAT mailbox isolates attempts, clears on completion, and refuses cancelled attempts', async () => {
  const api = load('../adapters/GitHubAdapter.ts',
    ['startDeviceFlow', 'pollForToken', 'submitGitHubPat', 'cancelGitHubPat'],
    { fetch: async () => ({ ok: true }) });
  const a = await api.startDeviceFlow();
  const b = await api.startDeviceFlow();
  assert.notEqual(a.deviceCode, b.deviceCode);
  assert.equal(api.submitGitHubPat(a.deviceCode, 'test-token'), true);
  const tokens = await api.pollForToken(a.deviceCode, 1, a.expiresAt);
  assert.equal(tokens.accessToken, 'test-token');
  assert.equal(api.submitGitHubPat(a.deviceCode, 'test-token'), false);
  api.cancelGitHubPat(b.deviceCode);
  await assert.rejects(api.pollForToken(b.deviceCode, 1, b.expiresAt), /cancelled/);
  assert.equal(api.submitGitHubPat(b.deviceCode, 'test-token'), false);
});

test('cancellation during PAT validation cannot authenticate', async () => {
  let finish: (() => void) | undefined;
  const api = load('../adapters/GitHubAdapter.ts',
    ['startDeviceFlow', 'pollForToken', 'submitGitHubPat', 'cancelGitHubPat'],
    { fetch: () => new Promise(resolve => { finish = () => resolve({ ok: true }); }) });
  const a = await api.startDeviceFlow();
  api.submitGitHubPat(a.deviceCode, 'test-token');
  const pending = api.pollForToken(a.deviceCode, 1, a.expiresAt);
  api.cancelGitHubPat(a.deviceCode);
  finish!();
  await assert.rejects(pending, /cancelled/);
});

for (const name of ['GoogleDrive', 'OneDrive']) {
  test(`${name} mobile OAuth fails honestly instead of opening placeholder flow`, async () => {
    const { buildAuthUrl } = load(`../adapters/${name}Adapter.ts`, ['buildAuthUrl']);
    await assert.rejects(buildAuthUrl('https://example.invalid/callback'), /not configured or supported/);
  });
}

test('mobile auto-sync timer is in protected UI hook; local edit debounce cannot upload', () => {
  const source = readFileSync(new URL('../../../application/state/useAutoSync.ts', import.meta.url), 'utf8');
  assert.match(source, /setInterval\(\(\) => \{ void syncNowRef\.current\(\); \}/);
  assert.match(source, /if \(typeof window !== 'undefined' && \(window as any\)\.__netcattyMobileMode\) \{\s*return \(\) =>/);
  assert.doesNotMatch(readFileSync(new URL('../adapters/GitHubAdapter.ts', import.meta.url), 'utf8'), /__netcattyPendingGitHubPat/);
});
