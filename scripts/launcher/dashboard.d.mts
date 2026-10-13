// Types for scripts/launcher/dashboard.mjs (used by tests/launcher.test.ts).
export interface Step { id: string; title: string; status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'; detail?: string; started?: number; ended?: number; progress?: number }
export interface DashState { steps: Step[]; status?: string; info?: string[]; infoTitle?: string; logs?: string[]; showLogs?: boolean; logTitle?: string; keys?: [string, string][] }
export declare function renderDashboard(state: DashState, t: number, cols: number, rows: number, o?: { color?: boolean; now?: number }): string[];
export declare function createDashboard(steps: { id: string; title: string }[], o?: { onInterrupt?: () => string[] }): unknown;
export declare function wrap(s: string, n: number): string[];
export declare function stepsGrowth(steps: Step[], now?: number): number;
export declare function growthCaption(steps: Step[], now?: number): string;
