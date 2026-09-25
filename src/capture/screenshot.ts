import { browser } from 'wxt/browser';

export const ALL_URLS = { origins: ['<all_urls>'] };

export type CaptureResult = { ok: true; dataUrl: string } | { ok: false; reason: 'needs-permission' | 'restricted' | 'error'; message: string };

/**
 * Capture the visible tab of the window this extension page lives in, downscaled to ≤1280px wide.
 * Works with activeTab (granted by the toolbar click) or the optional <all_urls> host permission.
 */
export async function captureVisibleTab(windowId?: number): Promise<CaptureResult> {
  try {
    const raw =
      windowId === undefined
        ? await browser.tabs.captureVisibleTab({ format: 'jpeg', quality: 70 })
        : await browser.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 70 });
    return { ok: true, dataUrl: await downscale(raw, 1280) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/chrome:\/\/|extensions gallery|cannot be scripted|webstore/i.test(message)) return { ok: false, reason: 'restricted', message };
    if (/permission|activeTab|<all_urls>/i.test(message)) return { ok: false, reason: 'needs-permission', message };
    return { ok: false, reason: 'error', message };
  }
}

/** Must be called synchronously from a click handler (user gesture). */
export function requestCapturePermission(): Promise<boolean> {
  return browser.permissions.request(ALL_URLS);
}

export function hasCapturePermission(): Promise<boolean> {
  return browser.permissions.contains(ALL_URLS);
}

async function downscale(dataUrl: string, maxW: number): Promise<string> {
  const bmp = await createImageBitmap(dataUrlToBlob(dataUrl));
  if (bmp.width <= maxW) return dataUrl;
  const scale = maxW / bmp.width;
  const canvas = new OffscreenCanvas(maxW, Math.round(bmp.height * scale));
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  return await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
