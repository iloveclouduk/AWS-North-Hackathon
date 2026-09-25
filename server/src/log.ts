import { createHash } from 'node:crypto';

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
