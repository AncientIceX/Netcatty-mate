/**
 * Geometry for the phone bottom sheet that hosts terminal side-panel tools
 * (Catty Agent, Scripts, SFTP …) — modelled on Termius mobile.
 *
 * The sheet is docked *below* the terminal instead of covering it, and snaps
 * between three heights so the user can keep watching terminal output while
 * an AI agent or a script is running:
 *
 * - `mini`: only the drag handle and tool tabs are visible (terminal ≈ full).
 * - `half`: sheet and terminal share the screen (default).
 * - `full`: sheet takes most of the screen; a few terminal rows stay visible.
 *
 * Everything here is pure so it can be unit-tested without a DOM.
 */
export type MobileSheetSnap = 'mini' | 'half' | 'full';

export interface MobileSheetHeights {
  mini: number;
  half: number;
  full: number;
}

/** Drag handle (24px) + tool tab row (52px on phones). */
export const MOBILE_SHEET_MINI_HEIGHT = 76;
/** Terminal area (toolbar + a few rows) always visible above a fully expanded sheet. */
export const MOBILE_SHEET_TERMINAL_RESERVE = 160;
/** Releasing a drag below this height (or flicking down from mini) closes. */
export const MOBILE_SHEET_CLOSE_THRESHOLD = 44;
/** px/ms — faster drags are treated as a flick towards the next snap. */
export const MOBILE_SHEET_FLICK_VELOCITY = 0.5;

export function getMobileSheetHeights(layerHeight: number): MobileSheetHeights {
  const height = Math.max(0, Math.round(layerHeight));
  const mini = Math.min(MOBILE_SHEET_MINI_HEIGHT, height);
  // On short viewports (e.g. soft keyboard open) keep at least a 25% strip of
  // terminal instead of the fixed reserve, so the sheet stays usable.
  const reserve = Math.min(MOBILE_SHEET_TERMINAL_RESERVE, Math.round(height * 0.25));
  const full = Math.max(mini, height - reserve);
  const half = Math.min(full, Math.max(mini, Math.round(height * 0.5)));
  return { mini, half, full };
}

/**
 * Decide where a released drag lands.
 * @param height   sheet height at release (px)
 * @param velocity upward speed in px/ms (negative = moving down)
 */
export function resolveMobileSheetSnap(
  height: number,
  velocity: number,
  heights: MobileSheetHeights,
): MobileSheetSnap | 'close' {
  if (height < MOBILE_SHEET_CLOSE_THRESHOLD) return 'close';
  const order: MobileSheetSnap[] = ['mini', 'half', 'full'];
  // A flick moves one snap in the flick direction from the nearest snap below/above.
  if (Math.abs(velocity) >= MOBILE_SHEET_FLICK_VELOCITY) {
    if (velocity > 0) return order.find((snap) => heights[snap] > height + 1) ?? 'full';
    const below = [...order].reverse().find((snap) => heights[snap] < height - 1);
    if (below) return below;
    return 'close';
  }
  let best: MobileSheetSnap = 'half';
  for (const snap of order) {
    if (Math.abs(heights[snap] - height) < Math.abs(heights[best] - height)) best = snap;
  }
  return best;
}

/** Tapping the handle cycles mini → half → full → half. */
export function nextMobileSheetSnapOnTap(current: MobileSheetSnap): MobileSheetSnap {
  return current === 'half' ? 'full' : 'half';
}

// The last snap the user chose is remembered for the app session only; phone
// presentation never writes to the persisted desktop width/height settings.
let rememberedSnap: MobileSheetSnap = 'half';
export const getRememberedSheetSnap = (): MobileSheetSnap => rememberedSnap;
export const rememberSheetSnap = (snap: MobileSheetSnap) => { rememberedSnap = snap; };

/** Window event other components fire to move the sheet (e.g. after running a script). */
export const MOBILE_SHEET_SNAP_EVENT = 'netcatty:mobile:sheet-snap';

export function requestMobileSheetSnap(snap: MobileSheetSnap): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<MobileSheetSnap>(MOBILE_SHEET_SNAP_EVENT, { detail: snap }));
}
