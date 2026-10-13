// A postcard of the player's city: the canvas as it is now, with a caption bar (the city, its Region, their stars and
// its landmark), saved as a PNG on their computer. Nothing is uploaded anywhere.

/** The caption under the picture. */
export const postcardCaption = (city: string, region: string, stars: number, landmark?: string) =>
  `My AWS City · ${city} (${region}) · ⭐ ${stars.toLocaleString()}${landmark ? ` · ${landmark}` : ''}`;

/** A file name a player can find again: aws-city-tokyo-2026-10-12.png. */
export const postcardName = (city: string, now = new Date()) =>
  `aws-city-${city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // São Paulo → Sao Paulo
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}-${now.toISOString().slice(0, 10)}.png`;

/** Frame the snapshot with a caption and hand it to the browser as a download. */
export function savePostcard(shot: HTMLImageElement, caption: string, fileName: string) {
  const bar = 44;
  const c = document.createElement('canvas');
  c.width = shot.width;
  c.height = shot.height + bar;
  const g = c.getContext('2d');
  if (!g) return;
  g.imageSmoothingEnabled = false; // pixel art stays crisp
  g.drawImage(shot, 0, 0);
  g.fillStyle = '#15171b';
  g.fillRect(0, shot.height, c.width, bar);
  g.fillStyle = '#f0a63a';
  g.fillRect(0, shot.height, c.width, 3);
  g.fillStyle = '#fff8ee';
  g.font = '800 18px Nunito, "Trebuchet MS", sans-serif';
  g.textBaseline = 'middle';
  g.fillText(caption, 16, shot.height + bar / 2 + 2, c.width - 32);
  c.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, 'image/png');
}
