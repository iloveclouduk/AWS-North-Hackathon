// Colours shared by the scenes. SEA matches the sea texture's base (art/tiles/landscape_art.py SEA), so the camera
// background, the game's background and the world map's water read as one sea.
export const SEA_COLOR = 0x2e78bc;
export const SEA_CSS = '#2e78bc';
/** The sea as RGB, for camera fades (cam.fadeIn(ms, r, g, b)). */
export const SEA_RGB = [0x2e, 0x78, 0xbc] as const;
