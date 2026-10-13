// Types for scripts/launcher/lib.mjs (used by tests/launcher.test.ts).
export interface Browser { id: string; name: string; app?: string; hint?: string; build: 'chrome' | 'firefox' | 'safari'; auto: boolean }
export declare const BROWSERS: Browser[];
export declare const detectBrowsers: (exists: (p: string) => boolean, o?: { platform?: string; appDirs?: string[] }) => Browser[];
export declare const extensionsPage: (id: string) => string;
export declare const listProfiles: (credentials?: string, config?: string) => string[];
export declare const pickProfile: (profiles: string[], env?: Record<string, string | undefined>) => string | undefined;
export declare const upsertProfile: (text: string, name: string, keys: { accessKeyId: string; secretAccessKey: string; sessionToken?: string }) => string;
export declare const parsePastedKeys: (text: string) => { accessKeyId: string; secretAccessKey: string; sessionToken?: string } | undefined;
export declare const explainAwsError: (err: unknown) => string;
export type BuildEvent = { step: number; of: number; label: string; name: string; done?: undefined } | { done: true; seconds: number };
export declare const parseBuildProgress: (chunk: string | Buffer) => BuildEvent[];
export declare const progressBar: (fraction: number, width?: number) => string;
export declare const elapsed: (ms: number) => string;
export declare const parseDownloadProgress: (chunk: string | Buffer) => { fraction: number; total: string } | undefined;
export declare const explainDownloadError: (output?: string) => string;
export declare const browserFromArg: (value: unknown) => string | undefined;
export interface LaunchArgs { help: boolean; intro: boolean; mode?: 'demo' | 'live'; browser?: string; error?: string }
export declare const parseArgs: (argv: string[], env?: Record<string, string | undefined>) => LaunchArgs;
export declare const helpText: () => string;
export declare const lockPid: (target: unknown) => number | undefined;
export declare const ALREADY_OPEN: string;
export declare const alreadyOpenPid: (output?: string) => number | undefined;
export declare const meaningfulLines: (output?: string, max?: number) => string[];
