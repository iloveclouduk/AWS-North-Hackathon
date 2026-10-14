// Phaser syncs a scene's clock (`this.time.now`) only when the game boots and on frames while the scene runs, not when
// the scene starts again. So in create() a mini-game's clock still reads the moment it last stopped (or the boot): a
// round timed from it opened at "Wave 9" (Shield) or never reached the hot-key rush (Sort). Each round starts by
// setting the clock to the game loop's time now, so every timer and timestamp in the round starts from here.
export const syncClock = (scene: { time: { now: number }; game: { loop: { time: number } } }) => {
  scene.time.now = scene.game.loop.time;
};
