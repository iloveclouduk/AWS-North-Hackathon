/** The player asked their OS for less motion: skip flashes, shakes, confetti and the typewriter. */
export const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
