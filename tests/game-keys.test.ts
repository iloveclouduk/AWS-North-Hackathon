import { describe, expect, it } from 'vitest';
import { keysBelongToUi } from '@/game/keys';

const el = (tagName: string) => ({ tagName }) as Element;

describe('arrow keys: game or UI', () => {
  const canvas = el('CANVAS') as HTMLCanvasElement;
  it('walk the player when nothing or the canvas has focus', () => {
    expect(keysBelongToUi(null, canvas)).toBe(false);
    expect(keysBelongToUi(el('BODY'), canvas)).toBe(false);
    expect(keysBelongToUi(canvas, canvas)).toBe(false);
  });
  it('stay with the UI on tabs, buttons, selects and inputs', () => {
    for (const t of ['BUTTON', 'SELECT', 'INPUT', 'TEXTAREA', 'DIV']) expect(keysBelongToUi(el(t), canvas)).toBe(true);
  });
});
