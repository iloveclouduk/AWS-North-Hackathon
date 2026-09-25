import Phaser from 'phaser';
import { useCity, type View } from '@/state/store';
import { BootScene } from './scenes/BootScene';
import { CityScene } from './scenes/CityScene';
import { FishingScene } from './scenes/FishingScene';
import { InteriorScene } from './scenes/InteriorScene';

/** Boots Phaser into `parent` and switches scenes when the store's `view` changes. */
export function createGame(parent: HTMLElement) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0f1a2b',
    scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth || 400, height: parent.clientHeight || 400 },
    scene: [BootScene, CityScene, InteriorScene, FishingScene],
    input: { mouse: { preventDefaultWheel: true } },
    render: { antialias: true },
  });

  const apply = (v: View) => {
    const sm = game.scene;
    if (!sm.isActive('city') && !sm.isSleeping('city')) return; // still booting
    for (const k of ['interior', 'fishing'] as const) if (sm.isActive(k) || sm.isPaused(k)) sm.stop(k);
    if (v.name === 'city') {
      if (sm.isSleeping('city')) sm.wake('city');
      return;
    }
    if (!sm.isSleeping('city')) sm.sleep('city');
    if (v.name === 'interior') sm.start('interior', { districtId: v.districtId });
    if (v.name === 'fishing') sm.start('fishing');
  };
  const unsub = useCity.subscribe((s, prev) => s.view !== prev.view && apply(s.view));

  return () => {
    unsub();
    game.destroy(true);
  };
}
