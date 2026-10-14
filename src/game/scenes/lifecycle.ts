import Phaser from 'phaser';

/**
 * Runs `fn` once when the scene shuts down or is destroyed, whichever comes first, and removes the other listener.
 * Registering both with `once` on every create() stacked a DESTROY listener per restart (scene events are only cleared
 * on destroy); this keeps one pair per run. CLAUDE.md: scenes unsubscribe on both SHUTDOWN and DESTROY.
 */
export function onSceneEnd(scene: Phaser.Scene, fn: () => void) {
  const { SHUTDOWN, DESTROY } = Phaser.Scenes.Events;
  const done = () => {
    scene.events.off(SHUTDOWN, done);
    scene.events.off(DESTROY, done);
    fn();
  };
  scene.events.once(SHUTDOWN, done);
  scene.events.once(DESTROY, done);
}
