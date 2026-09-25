import Phaser from 'phaser';
import { useCity, type View } from '@/state/store';
import { attachAudio } from './audio';
import { BootScene } from './scenes/BootScene';
import { CityScene } from './scenes/CityScene';
import { FishingScene } from './scenes/FishingScene';
import { InteriorScene } from './scenes/InteriorScene';
import { DanceGame } from './scenes/games/DanceGame';
import { KitchenGame } from './scenes/games/KitchenGame';
import { ShieldGame } from './scenes/games/ShieldGame';

const GAME_SCENES = { fishing: 'fishing', shield: 'game:shield', route53: 'game:route53', lambda: 'game:lambda' } as const;

/** Boots Phaser into `parent` and switches scenes when the store's `view` changes. */
export function createGame(parent: HTMLElement) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0f1a2b',
    scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth || 400, height: parent.clientHeight || 400 },
    scene: [BootScene, CityScene, InteriorScene, FishingScene, ShieldGame, DanceGame, KitchenGame],
    input: { mouse: { preventDefaultWheel: true } },
    pixelArt: true,
    roundPixels: true,
  });
  attachAudio(game);

  const apply = (v: View) => {
    const sm = game.scene;
    if (!sm.isActive('city') && !sm.isSleeping('city')) return; // still booting
    for (const k of ['interior', ...Object.values(GAME_SCENES)]) if (sm.isActive(k) || sm.isPaused(k)) sm.stop(k);
    if (v.name === 'city') {
      if (sm.isSleeping('city')) sm.wake('city');
      return;
    }
    if (!sm.isSleeping('city')) sm.sleep('city');
    if (v.name === 'interior') sm.start('interior', { districtId: v.districtId });
    if (v.name === 'game') sm.start(GAME_SCENES[v.game]);
  };
  const unsub = useCity.subscribe((s, prev) => s.view !== prev.view && apply(s.view));

  return () => {
    unsub();
    game.destroy(true);
  };
}
