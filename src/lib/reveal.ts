/**
 * Whether a block may be hidden, to fade in later, once the page is running.
 *
 * The server sends every block visible. Hiding happens only in the browser, and
 * only for blocks nobody can see yet: anything already on screen when the page
 * starts stays put. A block that the server hid would be blank until the
 * page's JavaScript arrived — on a slow phone, the whole first screen, for
 * seconds, and forever to anything that does not run scripts.
 */
export function mayHideOnStart(top: number, viewportHeight: number): boolean {
  return top >= viewportHeight;
}
