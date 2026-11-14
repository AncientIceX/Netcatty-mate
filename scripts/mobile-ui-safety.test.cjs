// Dependency-free safety regressions: node --test scripts/mobile-ui-safety.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const source = path => readFileSync(new URL('../' + path, `file://${__filename}`), 'utf8');

async function storageFixture(run) {
  const values = new Map();
  let quota = false;
  let nativeCalls = 0;
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      if (quota) throw new DOMException('full', 'QuotaExceededError');
      values.set(key, value);
    },
    removeItem: key => values.delete(key),
  }});
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    __netcattyMobileMode: true,
    NativeBridge: {
      getHomeDirSync: () => '/sandbox',
      readLocalFileB64: () => { nativeCalls++; return Buffer.from('"stale"').toString('base64'); },
      writeLocalFileText: () => { nativeCalls++; return true; },
    },
  }});
  try {
    const { localStorageAdapter: adapter } = await import('../infrastructure/persistence/localStorageAdapter.ts');
    await run({ adapter, values, setQuota: value => { quota = value; }, nativeCalls: () => nativeCalls });
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
}

test('quota failure is reported, preserves committed old value, never pretends native write succeeded', async () => {
  await storageFixture(({ adapter, setQuota, nativeCalls }) => {
    assert.equal(adapter.writeString('vault', 'committed'), true);
    setQuota(true);
    assert.equal(adapter.writeString('vault', 'new'), false);
    assert.equal(adapter.readString('vault'), 'committed');
    assert.equal(adapter.write('absent', { new: true }), false);
    assert.equal(adapter.read('absent'), null);
    assert.equal(nativeCalls(), 0);
  });
});

test('remove cannot resurrect stale native mirror, even when already absent', async () => {
  await storageFixture(({ adapter, nativeCalls }) => {
    adapter.writeString('vault', 'x'.repeat(20000));
    adapter.remove('vault');
    assert.equal(adapter.readString('vault'), null);
    adapter.remove('vault');
    assert.equal(adapter.read('vault'), null);
    assert.equal(nativeCalls(), 0);
  });
});

test('large to small rewrite and colliding sanitized names remain independent', async () => {
  await storageFixture(({ adapter, nativeCalls }) => {
    adapter.writeString('a/b', 'x'.repeat(20000));
    adapter.writeString('a_b', 'other');
    adapter.writeString('a/b', 'small');
    assert.equal(adapter.readString('a/b'), 'small');
    assert.equal(adapter.readString('a_b'), 'other');
    adapter.remove('a/b');
    assert.equal(adapter.readString('a/b'), null);
    assert.equal(adapter.readString('a_b'), 'other');
    assert.equal(nativeCalls(), 0);
  });
});

test('boolean, number, JSON and string paths share the same authority', async () => {
  await storageFixture(({ adapter, nativeCalls }) => {
    assert.equal(adapter.writeBoolean('bool', false), true);
    assert.equal(adapter.readBoolean('bool'), false);
    assert.equal(adapter.read('bool'), false);
    assert.equal(adapter.readString('bool'), 'false');
    assert.equal(adapter.writeNumber('num', 0), true);
    assert.equal(adapter.readNumber('num'), 0);
    assert.equal(adapter.read('num'), 0);
    for (const key of ['bool', 'num']) {
      adapter.remove(key);
      assert.equal(adapter.readBoolean(key), null);
      assert.equal(adapter.readNumber(key), null);
      assert.equal(adapter.readString(key), null);
      assert.equal(adapter.read(key), null);
    }
    assert.equal(nativeCalls(), 0);
  });
});

test('list mobile click selects with modifiers; double-click activates exactly once', () => {
  const text = source('components/sftp/SftpFileRow.tsx');
  const body = text.match(/const handleSelect = useCallback\(\(e: React.MouseEvent\) => \{([\s\S]*?)\n    \},/)[1];
  let selected = 0;
  let opened = 0;
  const entry = { name: 'directory', type: 'directory' };
  const click = runInNewContext(`(e) => {${body}}`, {
    window: { __netcattyMobileMode: true }, entry, index: 2,
    onOpen: () => opened++,
    onSelect: (actual, index, event) => { assert.equal(actual, entry); assert.equal(index, 2); assert.ok(event); selected++; },
  });
  const openBody = text.match(/const handleOpen = useCallback\(\(\) => \{([\s\S]*?)\n    \},/)[1];
  const doubleClick = runInNewContext(`() => {${openBody}}`, { entry, onOpen: () => opened++ });
  click({}); click({}); doubleClick();
  assert.equal(selected, 2);
  assert.equal(opened, 1);
  for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey']) click({ [modifier]: true });
  assert.equal(selected, 5);
  assert.equal(opened, 1);
});

test('tree selection, expansion and activation are separate event paths', () => {
  const text = source('components/sftp/SftpPaneTreeNode.tsx');
  assert.match(text, /onClick=\{e => onNodeClick\(entry, entryPath, e\)\}/);
  assert.match(text, /onDoubleClick=\{\(\) => onOpenEntry\(entry, entryPath\)\}/);
  assert.match(text, /e\.stopPropagation\(\); void onToggleExpand\(entry, entryPath\)/);
  assert.doesNotMatch(text, /__netcattyMobileMode/);
});

test('terminal has no second touch scroller or synthetic alternate-buffer arrows', () => {
  const text = source('components/terminal/runtime/createXTermRuntime.ts');
  assert.doesNotMatch(text, /handleMobileTouch|touchPixelRemainder|isTouchMobile|seq\.repeat\(count\)/);
  assert.doesNotMatch(text, /container\.addEventListener\(["']touchmove["']/);
});

test('locale detection uses exact language tags and explicit Chinese script precedence', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const cases = [['zh-CN', 'zh-CN'], ['zh-Hant', 'zh-TW'], ['zh-Hans-TW', 'zh-CN'], ['zh-HK', 'zh-TW'], ['es-MX', 'es'], ['ru-RU', 'ru'], ['fr-FR', 'en'], ['rubbish', 'en']];
  try {
    for (const [language, expected] of cases) {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language } });
      const config = await import(`../infrastructure/config/i18n.ts?mobile-ui=${language}`);
      assert.equal(config.DEFAULT_UI_LOCALE, expected, language);
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
});
