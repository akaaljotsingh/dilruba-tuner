/**
 * Scrolls an element, smoothly where supported. Falls back to setting
 * scrollLeft / scrollTop on engines without Element.scrollTo (older WebViews, jsdom).
 */
export function scrollElementTo(
  el: HTMLElement,
  pos: { left?: number; top?: number },
  smooth = false,
): void {
  if (typeof el.scrollTo === 'function') {
    try {
      el.scrollTo({ ...pos, behavior: smooth ? 'smooth' : 'auto' });
      return;
    } catch {
      /* fall through */
    }
  }
  if (pos.left !== undefined) el.scrollLeft = pos.left;
  if (pos.top !== undefined) el.scrollTop = pos.top;
}
