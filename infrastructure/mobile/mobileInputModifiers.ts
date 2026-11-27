/**
 * Sticky Ctrl/Alt modifiers for the Android touch keybar (Termius-style).
 *
 * The soft keyboard (IME) delivers text through xterm's onData path, so a
 * modifier armed on the keybar cannot be applied at key-event level. Instead
 * the bridge's writeToSession consults this per-session store and transforms
 * the next single typed character, then disarms the modifier.
 *
 * Pure module-level state: no DOM, no bridge access, safe to unit test.
 */

export interface MobileInputModifiers {
  ctrl: boolean;
  alt: boolean;
}

type Listener = (sessionId: string, mods: MobileInputModifiers) => void;

const NONE: MobileInputModifiers = Object.freeze({ ctrl: false, alt: false });
const armed = new Map<string, MobileInputModifiers>();
const listeners = new Set<Listener>();

function notify(sessionId: string, mods: MobileInputModifiers): void {
  listeners.forEach((cb) => {
    try { cb(sessionId, mods); } catch { /* listener errors must not break input */ }
  });
}

/** Current modifiers for a session (never null). */
export function getMobileInputModifiers(sessionId: string): MobileInputModifiers {
  return armed.get(sessionId) ?? NONE;
}

/** Arm/disarm modifiers; an all-false value clears the session entry. */
export function setMobileInputModifiers(sessionId: string, mods: MobileInputModifiers): void {
  if (!sessionId) return;
  if (mods.ctrl || mods.alt) armed.set(sessionId, { ctrl: mods.ctrl, alt: mods.alt });
  else armed.delete(sessionId);
  notify(sessionId, getMobileInputModifiers(sessionId));
}

/** Drop state when a session closes so ids are never reused with stale mods. */
export function clearMobileInputModifiers(sessionId: string): void {
  if (armed.delete(sessionId)) notify(sessionId, NONE);
}

export function onMobileInputModifiersChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Ctrl transform for one character, following common terminal conventions. */
export function ctrlChar(ch: string): string {
  if (ch === ' ' || ch === '@' || ch === '2') return '\x00';
  if (ch === '?') return '\x7f';
  const code = ch.toUpperCase().charCodeAt(0);
  // '@'..'_' (incl. A-Z, [ \ ] ^ _) map to 0x00..0x1f.
  if (code >= 64 && code <= 95) return String.fromCharCode(code - 64);
  return ch;
}

/**
 * Apply armed modifiers to an outgoing write. Only a single user-typed
 * character is transformed; pastes, paced writes, binary mouse reports and
 * multi-byte escape sequences pass through untouched and keep the modifier
 * armed for the next real keystroke.
 */
export function applyMobileInputModifiers(
  sessionId: string,
  data: string,
  options?: { binary?: boolean; lineDelayMs?: number; pasteRequestId?: unknown; automated?: boolean },
): string {
  const mods = armed.get(sessionId);
  if (!mods) return data;
  if (options?.binary || options?.lineDelayMs || options?.pasteRequestId || options?.automated) return data;
  // Array.from keeps surrogate pairs (emoji) as one code point.
  if (Array.from(data).length !== 1) return data;
  let out = data;
  if (mods.ctrl) out = ctrlChar(out);
  if (mods.alt) out = `\x1b${out}`;
  armed.delete(sessionId);
  notify(sessionId, NONE);
  return out;
}

// Expose to the Android bridge polyfill, which must stay import-free.
if (typeof window !== 'undefined') {
  window.__netcattyApplyMobileInputModifiers = applyMobileInputModifiers;
  window.__netcattyClearMobileInputModifiers = clearMobileInputModifiers;
}
