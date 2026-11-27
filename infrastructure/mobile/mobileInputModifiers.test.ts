// node --test infrastructure/mobile/mobileInputModifiers.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyMobileInputModifiers,
  clearMobileInputModifiers,
  ctrlChar,
  getMobileInputModifiers,
  onMobileInputModifiersChange,
  setMobileInputModifiers,
} from './mobileInputModifiers.ts';

test('unarmed input passes through unchanged', () => {
  assert.equal(applyMobileInputModifiers('s0', 'ls\r'), 'ls\r');
  assert.equal(applyMobileInputModifiers('s0', 'x'), 'x');
});

test('sticky Ctrl transforms exactly one typed character, then disarms', () => {
  setMobileInputModifiers('s1', { ctrl: true, alt: false });
  assert.equal(applyMobileInputModifiers('s1', 'c'), '\x03');
  assert.deepEqual(getMobileInputModifiers('s1'), { ctrl: false, alt: false });
  assert.equal(applyMobileInputModifiers('s1', 'c'), 'c');
});

test('Alt prefixes ESC and combines with Ctrl', () => {
  setMobileInputModifiers('s2', { ctrl: false, alt: true });
  assert.equal(applyMobileInputModifiers('s2', 'b'), '\x1bb');
  setMobileInputModifiers('s2', { ctrl: true, alt: true });
  assert.equal(applyMobileInputModifiers('s2', 'x'), '\x1b\x18');
});

test('pastes, binary reports and escape sequences keep the modifier armed', () => {
  setMobileInputModifiers('s3', { ctrl: true, alt: false });
  assert.equal(applyMobileInputModifiers('s3', 'hello'), 'hello');
  assert.equal(applyMobileInputModifiers('s3', '\x1b[A'), '\x1b[A');
  assert.equal(applyMobileInputModifiers('s3', 'a', { binary: true }), 'a');
  assert.equal(applyMobileInputModifiers('s3', 'a', { pasteRequestId: 'p' }), 'a');
  assert.equal(getMobileInputModifiers('s3').ctrl, true);
  assert.equal(applyMobileInputModifiers('s3', 'd'), '\x04');
});

test('sessions are isolated and close clears state with a notification', () => {
  const seen: Array<[string, boolean]> = [];
  const off = onMobileInputModifiersChange((id, m) => seen.push([id, m.ctrl]));
  setMobileInputModifiers('a', { ctrl: true, alt: false });
  assert.equal(applyMobileInputModifiers('b', 'c'), 'c');
  clearMobileInputModifiers('a');
  assert.equal(applyMobileInputModifiers('a', 'c'), 'c');
  off();
  assert.deepEqual(seen, [['a', true], ['a', false]]);
});

test('ctrlChar covers common terminal conventions', () => {
  assert.equal(ctrlChar('a'), '\x01');
  assert.equal(ctrlChar('Z'), '\x1a');
  assert.equal(ctrlChar('['), '\x1b');
  assert.equal(ctrlChar(' '), '\x00');
  assert.equal(ctrlChar('?'), '\x7f');
  assert.equal(ctrlChar('1'), '1');
});
