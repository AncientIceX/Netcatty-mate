import { useSyncExternalStore } from 'react';

/**
 * Phone-sized viewport detection shared by the terminal layer.
 *
 * Below this width the terminal side panel (AI / Scripts / SFTP …) is shown as
 * a bottom sheet instead of a desktop side column, so both the layer container
 * (flex direction) and the panel section must agree on the same breakpoint.
 */
export const COMPACT_VIEWPORT_QUERY = '(max-width: 767px)';

const getMedia = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(COMPACT_VIEWPORT_QUERY)
    : null;

const subscribe = (listener: () => void) => {
  const media = getMedia();
  if (!media) return () => {};
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
};

const getSnapshot = () => getMedia()?.matches ?? false;

/** True while the viewport is phone-sized; re-renders on rotation/resizes. */
export function useIsCompactViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
