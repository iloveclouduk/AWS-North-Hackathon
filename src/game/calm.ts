// A calm city: the camera moves on its own only while the player isn't steering it, and the city says one
// thing at a time. Pure, so the rules are tested without Phaser (tests/calm.test.ts).

/** How long after the player's last pan, zoom, tap or key the camera stays where they put it. */
export const AUTO_PAN_QUIET_MS = 8000;

/** True when an automatic camera move (a discovery, a page focus, following a task) may run now. */
export const mayAutoPan = (now: number, lastInputAt: number, quietMs = AUTO_PAN_QUIET_MS) => now - lastInputAt >= quietMs;

/**
 * What a speech bubble is for:
 * - `alert`: something needs the player (a citizen found a problem). Always shows.
 * - `normal`: an answer to the player or real AWS work (task steps, clicks, quest moments). Always shows.
 * - `ambient`: the city talking to itself (citizens chatting, agents messaging each other with no task of yours
 *   running). Only with the chatter setting on, and only while no other bubble is up.
 */
export type BubblePriority = 'alert' | 'normal' | 'ambient';

/** Whether a bubble may show, given how many non-player bubbles are up now and the chatter setting. */
export const mayShowBubble = (priority: BubblePriority, visibleNonPlayer: number, chatter: boolean) =>
  priority !== 'ambient' || (chatter && visibleNonPlayer === 0);
