import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MOBILE_SHEET_MINI_HEIGHT,
  getMobileSheetHeights,
  nextMobileSheetSnapOnTap,
  resolveMobileSheetSnap,
} from './mobileSheet.ts';

test('snap heights keep terminal rows visible on a 390x844 phone', () => {
  const h = getMobileSheetHeights(760);
  assert.equal(h.mini, MOBILE_SHEET_MINI_HEIGHT);
  assert.equal(h.half, 380);
  assert.equal(h.full, 760 - 160);
});

test('short viewport (keyboard open) still leaves a terminal strip', () => {
  const h = getMobileSheetHeights(300);
  assert.equal(h.full, 225);
  assert.ok(h.half <= h.full && h.half >= h.mini);
});

test('release snaps to nearest height without velocity', () => {
  const h = getMobileSheetHeights(760);
  assert.equal(resolveMobileSheetSnap(90, 0, h), 'mini');
  assert.equal(resolveMobileSheetSnap(400, 0, h), 'half');
  assert.equal(resolveMobileSheetSnap(600, 0, h), 'full');
});

test('flicks move one snap in the flick direction, and close from mini', () => {
  const h = getMobileSheetHeights(760);
  assert.equal(resolveMobileSheetSnap(390, 1, h), 'full');
  assert.equal(resolveMobileSheetSnap(370, -1, h), 'mini');
  assert.equal(resolveMobileSheetSnap(70, -1, h), 'close');
  assert.equal(resolveMobileSheetSnap(30, 0, h), 'close');
});

test('handle tap toggles half and full', () => {
  assert.equal(nextMobileSheetSnapOnTap('half'), 'full');
  assert.equal(nextMobileSheetSnapOnTap('full'), 'half');
  assert.equal(nextMobileSheetSnapOnTap('mini'), 'half');
});
