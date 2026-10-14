// Types for scripts/launcher/banner.mjs (used by tests/launcher.test.ts).
export declare const INTRO_SECONDS: number;
export declare function frame(t: number, width: number, o?: { color?: boolean; compact?: boolean; pending?: number; tagline?: boolean; growth?: number }): string[];
export declare function printBanner(): void;
export declare function playIntro(o?: { animate?: boolean }): Promise<void>;
export declare const ROOF_TIPS: string;
export declare const introGrowth: (t: number) => number;
export declare function lotsFor(width: number, o?: { compact?: boolean }): unknown[];
export interface Cell { ch: string; fg?: string; bg?: string; bold?: boolean }
export declare function vehicle(kind: 'car' | 'sports' | 'truck' | 'bus' | 'van', label: string, body: string, ink: string, right?: boolean): [(Cell | undefined)[], (Cell | undefined)[]];
