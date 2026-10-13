import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import world from '../shared/world.json' with { type: 'json' };
import manifest from '../shared/aws-icons.json' with { type: 'json' };

const ROOT = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(ROOT, 'scripts/fetch-aws-icons.mjs'), 'utf8');
const mapping = script.slice(script.indexOf('export const MAPPING'), script.indexOf('};', script.indexOf('export const MAPPING')));
const icons = (manifest as { icons: Record<string, { path: string }> }).icons;
const downloaded = Object.keys(icons).length > 0 && fs.existsSync(path.join(ROOT, 'public/assets/aws-icons/NOTICE'));

describe('official AWS Architecture Icons', () => {
  it.each(world.services.map((s) => s.id))('the fetch script maps %s to a package icon', (id) => {
    expect(mapping).toMatch(new RegExp(`\\n\\s*${id}: '[A-Za-z0-9-]+'`));
  });

  it.skipIf(!downloaded)('every service icon was downloaded, with a NOTICE (skipped: run `npm run icons` — the package could not be downloaded)', () => {
    for (const s of world.services) {
      expect(icons[s.id]?.path, s.id).toBe(`/assets/aws-icons/${s.id}.svg`);
      expect(fs.existsSync(path.join(ROOT, 'public', icons[s.id].path)), s.id).toBe(true);
    }
    const notice = fs.readFileSync(path.join(ROOT, 'public/assets/aws-icons/NOTICE'), 'utf8');
    expect(notice).toMatch(/https:\/\/aws\.amazon\.com\/architecture\/icons\//);
    expect(notice).toMatch(/architecture\s+diagrams/);
  });
});
