// Pure UI helpers (no React, no I/O beyond localStorage) — unit-tested in tests/ui-logic.test.ts.

import type { CSSProperties } from 'react';
import type { ConnectionStatus } from '@/backend/AgentBackend';
import { hexColor } from '@/world/taxonomy';

export type BackendKind = 'mock' | 'agentcore' | 'server';

/** Roving-tabindex keyboard nav for a tablist: the index to move to, or undefined to ignore the key. */
export function nextTabIndex(key: string, current: number, count: number): number | undefined {
  if (count <= 0) return undefined;
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count;
    case 'ArrowLeft':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}

/** Human text for the HUD connection pill. `wasConnected` turns "Connecting…" into "Reconnecting…". */
export function connectionLabel(kind: BackendKind, status: ConnectionStatus, wasConnected = false): string {
  if (kind === 'mock') return 'Demo mode';
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return wasConnected ? 'Reconnecting…' : 'Connecting…';
    case 'signed-out':
      return 'Signed out';
    case 'disconnected':
    case 'error':
      return 'Offline';
  }
}

/** Can the player send commands right now? The mock backend is always usable. */
export const isOnline = (kind: BackendKind, status: ConnectionStatus) => kind === 'mock' || status === 'connected';

/** Why an action is disabled while offline (for `title`), or undefined when online. */
export function offlineReason(kind: BackendKind, status: ConnectionStatus): string | undefined {
  if (isOnline(kind, status)) return undefined;
  if (status === 'signed-out') return 'Sign in first (use the Sign in button at the top)';
  if (status === 'connecting') return 'Connecting to the AWS City server…';
  return 'Not connected to the AWS City server — press Retry at the top';
}

/** Inline style that sets the `--district` CSS custom property (used by .edge, .svc, .meter.district, .nav-district h4). */
export const districtStyle = (color?: number): CSSProperties | undefined =>
  color === undefined ? undefined : ({ '--district': hexColor(color) } as CSSProperties);

/** Fisher–Yates shuffle (copy). `rand` is injectable for tests. */
export function shuffle<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Account step: a 12-digit account id or an IAM role ARN (the server accepts either). */
export const isAccountIdOrRoleArn = (v: string) => /^\d{12}$/.test(v.trim()) || /^arn:aws:iam::\d{12}:role\/.+/.test(v.trim());

// ── Small localStorage prefs (per surface is fine; failures are ignored) ──

export const TAB_KEY = 'awscity.tab';
export const TOUR_KEY = 'awscity.tourDone';

export function readPref(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* storage disabled */
  }
}

export const isTourDone = () => readPref(TOUR_KEY) === '1';
export const markTourDone = () => writePref(TOUR_KEY, '1');
