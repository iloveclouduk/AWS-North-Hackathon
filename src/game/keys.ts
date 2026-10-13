/**
 * Phaser listens for keys on the whole window. Arrow keys and E belong to the game only when nothing
 * (the body) or the game canvas has focus; tabs, menus, the tour and form fields all use them too.
 */
export function keysBelongToUi(active: Element | null, canvas: HTMLCanvasElement | undefined): boolean {
  if (!active || active.tagName === 'BODY' || active.tagName === 'HTML') return false;
  return active !== canvas;
}
