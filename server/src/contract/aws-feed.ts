import type { AwsEvent, Resource, WorldSnapshot } from '../state/model.js';
import { EXPIRED_LESSON, KIND_LESSONS, LOCKED_LESSON, STATE_LESSONS } from '../translate/lessons.js';
import { AGENT_FOR_SERVICE, type ServerEvent } from '../world.js';

/** Which city agent speaks for a resource. Security groups belong to the VPC Walled Garden. */
export const agentFor = (r: Pick<Resource, 'kind' | 'service'>): string | undefined =>
  r.kind === 'security-group' ? 'vpc' : AGENT_FOR_SERVICE[r.service];

const say = (from: string, text: string): ServerEvent => ({ type: 'agent.message', from, to: 'user', text });

/**
 * State layer → city: what changed in the AWS console becomes the landmark agent telling the player,
 * with a short lesson. (Contract rule: agent.state is reserved for calls made on an agent's behalf,
 * so console changes are messages, not work animations.)
 */
export const feedEvents = (event: AwsEvent): ServerEvent[] => {
  switch (event.type) {
    case 'created':
    case 'deleted':
    case 'stateChanged': {
      const r = event.resource;
      const from = agentFor(r);
      if (!from) return [];
      const text =
        event.type === 'created'
          ? `New in your account: ${r.kind} "${r.name}". ${KIND_LESSONS[r.kind]}`
          : event.type === 'deleted'
            ? `"${r.name}" (${r.kind}) is gone from your account.`
            : `"${r.name}" went ${event.from} → ${event.to}. ${STATE_LESSONS[event.to] ?? ''}`.trim();
      return [say(from, text)];
    }
    case 'serviceLocked':
      return [say('iam', LOCKED_LESSON(event.service))];
    case 'serviceUnlocked':
      return [say('iam', `Good news: your role can read ${event.service} again.`)];
    case 'credentialsExpired':
      return [{ type: 'error', message: EXPIRED_LESSON }];
    case 'credentialsRestored':
      return [say('concierge', "We're reconnected to AWS.")];
  }
};

/** Sent once per connection: the concierge summarises what the city can see. */
export const welcomeEvents = (s: WorldSnapshot): ServerEvent[] => {
  const count = (kind: Resource['kind']) => s.resources.filter((r) => r.kind === kind && r.state !== 'terminated').length;
  const parts = [
    [count('instance'), 'EC2 instance'],
    [count('table'), 'DynamoDB table'],
    [count('bucket'), 'S3 bucket'],
    [count('function'), 'Lambda function'],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, label]) => `${n} ${label}${n === 1 ? '' : 's'}`);
  const locked = Object.entries(s.services).filter(([, v]) => v === 'locked').map(([k]) => k);
  return [
    say(
      'concierge',
      `Connected to your AWS account (${s.region}). I can see ${parts.length ? parts.join(', ') : 'no resources yet'}.` +
        (locked.length ? ` Locked by IAM: ${locked.join(', ')}.` : ''),
    ),
  ];
};
