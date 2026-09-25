// Wires backend ⇄ store ⇄ bus ⇄ chrome APIs. UI components call the commands exported here;
// they never touch the backend or chrome.* directly.

import { browser } from 'wxt/browser';
import { createBackend, type AgentBackend } from '@/backend';
import { uid } from '@/backend/AgentBackend';
import type { Progress } from '@/backend/contract';
import { captureVisibleTab, hasCapturePermission, requestCapturePermission } from '@/capture/screenshot';
import { bus } from '@/state/bus';
import { knownAgents, useCity } from '@/state/store';
import { matchUrl, serviceById } from '@/world/taxonomy';
import { FOCUS_STORAGE_KEY, PROGRESS_STORAGE_KEY, SETTINGS_STORAGE_KEY, type PageFocus, type RuntimeMessage } from '@/state/types';

export type Layout = 'panel' | 'full';

let backend: AgentBackend | undefined;
let layout: Layout = 'panel';
let started = false;

const store = () => useCity.getState();

export function startRuntime(l: Layout) {
  if (started) return;
  started = true;
  layout = l;

  backend = createBackend({ knownAgents: () => knownAgents(store().progress) });
  const kind = backend.kind;
  store().setBackend(kind, 'connecting');
  backend.onStatus((s) => store().setBackend(kind, s));
  backend.onEvent((e) => {
    store().applyServerEvent(e);
    bus.emit('server', e);
  });
  backend.connect();

  void initProgress();
  void initFocus();
  void initSettings();

  store().log({ kind: 'system', text: `Welcome to AWS City! Backend: ${kind === 'mock' ? 'mock (offline demo)' : 'AWS'}.` });
  store().log({ kind: 'message', from: 'concierge', to: 'user', text: 'Open any AWS Console page and I will build that part of town. Or just ask me to do something!' });
}

// ── Progress: local cache (chrome.storage.local) + backend (source of truth when available) ──

async function initProgress() {
  const local = (await browser.storage.local.get(PROGRESS_STORAGE_KEY))[PROGRESS_STORAGE_KEY] as Progress | undefined;
  if (local?.version === 1) store().loadProgress(local);

  try {
    const remote = await backend!.getProgress();
    if (remote && remote.updatedAt > store().progress.updatedAt) store().loadProgress(remote);
  } catch (err) {
    console.warn('[runtime] getProgress failed, using local cache', err);
  }

  let putTimer: ReturnType<typeof setTimeout> | undefined;
  useCity.subscribe((s, prev) => {
    if (s.progress === prev.progress) return;
    void browser.storage.local.set({ [PROGRESS_STORAGE_KEY]: s.progress });
    clearTimeout(putTimer);
    putTimer = setTimeout(() => backend!.putProgress(s.progress), 1500);
  });

  // Side panel and full-city tab run separately; keep them in sync.
  browser.storage.onChanged.addListener((changes, area) => {
    const next = changes[PROGRESS_STORAGE_KEY]?.newValue as Progress | undefined;
    if (area === 'local' && next && next.updatedAt > store().progress.updatedAt) store().loadProgress(next);
  });
}

// ── Page focus (from background.ts) ──

async function initFocus() {
  browser.runtime.onMessage.addListener((msg: RuntimeMessage) => {
    if (msg?.type === 'page.focus') handleFocus(msg.focus);
  });
  const saved = (await browser.storage.session.get(FOCUS_STORAGE_KEY))[FOCUS_STORAGE_KEY] as PageFocus | undefined;
  if (saved) handleFocus(saved);
}

let autoSnapTimer: ReturnType<typeof setTimeout> | undefined;
function handleFocus(f: PageFocus) {
  if (f.kind === 'extension') return; // our own full-city tab
  const prev = store().focus;
  store().setFocus(f);
  bus.emit('focus', f);
  if (prev?.url === f.url) return;
  clearTimeout(autoSnapTimer);
  if (store().autoSnap && f.kind === 'other' && layout === 'panel') {
    autoSnapTimer = setTimeout(() => void snap(), 1500);
  }
}

async function initSettings() {
  const s = (await browser.storage.local.get(SETTINGS_STORAGE_KEY))[SETTINGS_STORAGE_KEY] as { autoSnap?: boolean } | undefined;
  if (s?.autoSnap) store().setAutoSnap(true);
}

// ── Commands used by the UI ──

export function submitPrompt(prompt: string) {
  const text = prompt.trim();
  if (!text || !backend) return;
  const taskId = uid();
  const f = store().focus;
  store().addTask(taskId, text);
  backend.send({ action: 'task.submit', taskId, prompt: text, context: { url: f?.url, title: f?.title, serviceId: f?.serviceId, screenshotKey: lastScreenshotKey } });
}

export function askDistrict(districtId: string, question: string) {
  const q = question.trim();
  if (!q || !backend) return;
  const requestId = uid();
  const f = store().focus;
  store().addUserChat(districtId, requestId, q);
  backend.send({ action: 'chat.ask', requestId, districtId, question: q, context: { url: f?.url, title: f?.title, serviceId: f?.serviceId } });
}

let lastScreenshotKey: string | undefined;

/** Lookout snaps the visible tab, uploads it, and asks the backend what it shows. */
export async function snap() {
  if (!backend || store().snap === 'snapping') return;
  if (layout === 'full') {
    store().setSnap('unavailable');
    return;
  }
  store().setSnap('snapping');
  bus.emit('snap', { phase: 'start' });
  const f = store().focus;
  const shot = await captureVisibleTab(f?.windowId);
  if (!shot.ok) {
    store().setSnap(shot.reason === 'needs-permission' ? 'needs-permission' : 'failed');
    store().log({ kind: 'message', from: 'lookout', to: 'user', text:
        shot.reason === 'restricted'
          ? 'Chrome won’t let me photograph this page.'
          : shot.reason === 'needs-permission'
            ? 'Chrome needs your OK first — press “📷 Allow” and I’ll snap the page.'
            : `I couldn’t take the photo: ${shot.message}` });
    bus.emit('snap', { phase: 'failed' });
    return;
  }
  try {
    lastScreenshotKey = await backend.uploadScreenshot(shot.dataUrl);
    backend.send({ action: 'page.classify', requestId: uid(), context: { url: f?.url, title: f?.title, serviceId: f?.serviceId, screenshotKey: lastScreenshotKey } });
    store().setSnap('idle', shot.dataUrl);
    bus.emit('snap', { phase: 'done' });
  } catch (err) {
    store().setSnap('failed');
    store().log({ kind: 'system', text: `⚠️ Screenshot upload failed: ${String(err)}` });
    bus.emit('snap', { phase: 'failed' });
  }
}

/** Call directly from a click handler. */
export function grantLookout() {
  void requestCapturePermission().then((ok) => {
    if (ok) void snap();
  });
}

export function setAutoSnap(on: boolean) {
  store().setAutoSnap(on);
  void browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: { autoSnap: on } });
  if (on) void hasCapturePermission().then((has) => !has && store().log({ kind: 'message', from: 'lookout', to: 'user', text: 'Auto-snap is on. Press my camera once so Chrome lets me see pages.' }));
}

// ── Account linking + real deploys (curated templates, change-set approval) ──

export function signIn() {
  void backend?.signIn?.().catch((e) => store().log({ kind: 'system', text: `⚠️ Sign-in failed: ${String(e)}` }));
}

export function linkAccount(region = 'us-west-2') {
  backend?.send({ action: 'account.link', requestId: uid(), region });
}

export function verifyAccount(roleArn: string) {
  if (!/^arn:aws:iam::\d{12}:role\/.+/.test(roleArn.trim())) {
    store().log({ kind: 'system', text: '⚠️ That does not look like a role ARN (arn:aws:iam::123456789012:role/…).' });
    return;
  }
  backend?.send({ action: 'account.verify', requestId: uid(), roleArn: roleArn.trim() });
}

export function planDeploy(templateId: string, taskId?: string) {
  backend?.send({ action: 'deploy.plan', requestId: uid(), templateId, taskId });
}

export function decideDeploy(deployId: string, approve: boolean) {
  backend?.send({ action: approve ? 'deploy.approve' : 'deploy.reject', deployId });
}

export function teardownDeploy(deployId: string) {
  backend?.send({ action: 'deploy.teardown', deployId });
}

export function startQuest(questId: string) {
  backend?.send({ action: 'quest.start', questId, taskId: uid() });
}

export function openUrl(url: string) {
  void browser.tabs.create({ url });
}

export function openFullCity() {
  void browser.tabs.create({ url: browser.runtime.getURL('/city.html') });
}

export function openConsole(serviceId: string) {
  const path = serviceById(serviceId) ? `${serviceById(serviceId)!.consolePaths[0]}/home` : 'console/home';
  void browser.tabs.create({ url: `https://console.aws.amazon.com/${path}` });
}

/** Dev helper: pretend the user opened `url` (used by tests and the DevTools console via window.awsCity). */
export function simulateFocus(url: string, title = url) {
  const m = matchUrl(url);
  handleFocus({ url, title, kind: m.kind, serviceId: m.serviceId });
}
