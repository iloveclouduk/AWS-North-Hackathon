import { createHash, randomBytes } from 'node:crypto';

/**
 * Structured JSON logs (one line each) for CloudWatch, and metrics in Embedded Metric Format.
 * Never log JWTs, prompts, page snapshots, screenshots or ExternalIds. Players appear only as a
 * short hash of their id.
 */
type Fields = Record<string, string | number | boolean | undefined>;

const json = process.env.LOG_FORMAT === 'json' || process.env.AWS_CITY_MODE === 'hosted';
const quiet = process.env.VITEST !== undefined;

const write = (level: 'info' | 'warn' | 'error', msg: string, fields: Fields = {}) => {
  if (quiet && level !== 'error') return;
  if (!json) return (level === 'info' ? console.log : level === 'warn' ? console.warn : console.error)(`[${level}] ${msg}`, Object.keys(fields).length ? fields : '');
  process.stdout.write(`${JSON.stringify({ level, msg, time: new Date().toISOString(), ...fields })}\n`);
};

export const who = (sub: string) => (sub === 'local' ? 'local' : createHash('sha256').update(sub).digest('hex').slice(0, 12));

export const log = {
  info: (msg: string, f?: Fields) => write('info', msg, f),
  warn: (msg: string, f?: Fields) => write('warn', msg, f),
  error: (msg: string, f?: Fields) => write('error', msg, f),
  /** CloudWatch EMF: the line itself becomes a metric in namespace AWSCity. */
  metric(name: string, value: number, unit: 'Count' | 'Milliseconds' = 'Count') {
    if (!json || quiet) return;
    process.stdout.write(
      `${JSON.stringify({ _aws: { Timestamp: Date.now(), CloudWatchMetrics: [{ Namespace: 'AWSCity', Dimensions: [[]], Metrics: [{ Name: name, Unit: unit }] }] }, [name]: value })}\n`,
    );
  },
};

/** Public mode hides internal error text from players. main.ts sets it from the config (signed-in players = public). */
let hosted = process.env.AWS_CITY_MODE === 'hosted';
export const setPublicErrors = (on: boolean) => void (hosted = on);
export const publicErrors = () => hosted;

/**
 * Logs a failure and returns what the player may see. AWS and Bedrock errors can carry our account id,
 * role and model ARNs, so hosted players get a plain sentence plus a reference to find the log line;
 * the local server (one developer, their own account) shows the real message.
 */
export const publicError = (scope: string, err: unknown, fields: Fields = {}): string => {
  const e = err as { name?: string; message?: string; status?: number; publicMessage?: string };
  // Errors written for players (quota, kill switch) pass through unchanged.
  if (e?.publicMessage) return e.publicMessage;
  const ref = randomBytes(3).toString('hex');
  write('error', scope, { ref, err: e?.name ?? 'Error', status: e?.status, detail: e?.message?.slice(0, 300), ...fields });
  if (!hosted) return e?.message ?? String(err);
  if (e?.status === 429 || e?.name === 'ThrottlingException') return 'The city’s AI is busy right now. Try again in a minute.';
  if (e?.name === 'TimeoutError' || /timed? ?out/i.test(e?.message ?? '')) return 'That took too long. Try again.';
  return `Something went wrong on our side (ref ${ref}). Try again.`;
};
