/** The length of a full edge fade on the sidebar's scrollable list, in px. */
export const NAV_FADE_PX = 22

/**
 * How far to fade each edge of the sidebar's scrollable list, in px. An edge fades only
 * when more than a fade's length is hidden past it: when what is hidden is just the rest
 * of the last row and the list's padding, a fade would dim a label that is otherwise
 * readable. Past that, the fade grows with what is hidden, up to NAV_FADE_PX, so it
 * never appears all at once while scrolling.
 */
export function navFade({
  scrollTop,
  clientHeight,
  scrollHeight
}: {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}): { top: number; bottom: number } {
  const fade = (hidden: number) =>
    Math.round(Math.min(NAV_FADE_PX, Math.max(0, hidden - NAV_FADE_PX)))
  return { top: fade(scrollTop), bottom: fade(scrollHeight - clientHeight - scrollTop) }
}
