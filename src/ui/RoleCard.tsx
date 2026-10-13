import { useCity } from '@/state/store';
import { placeFor } from '@/world/places';
import { districtById, serviceById, servicesIn } from '@/world/taxonomy';
import { Portrait } from './Portrait';

/** Amazon-style levels: the agent's backend level (agent.level events) mapped onto L4… */
const LEVELS = ['L4 · Engineer I', 'L5 · Engineer II', 'L6 · Senior', 'L7 · Principal', 'L8 · Senior Principal', 'L10 · Distinguished'];

/** ISO week number: the on-call rotation moves one agent along each week. */
export function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y0.getTime()) / 86_400_000 + 1) / 7);
}

/** Who's primary on-call in a district this week (a rotation over its agents). */
export function onCallFor(districtId: string, week = isoWeek()) {
  const team = servicesIn(districtId as never);
  return team.length ? team[week % team.length].id : undefined;
}

/** An agent's employee card: team, level, on-call — and what they're doing, only from real agent.state events. */
export function RoleCard({ serviceId }: { serviceId: string }) {
  const level = useCity((s) => s.agentLevels[serviceId] ?? 1);
  const status = useCity((s) => s.agents[serviceId]);
  const svc = serviceById(serviceId);
  const place = placeFor(serviceId);
  if (!svc || !place) return null;
  const d = districtById(svc.districtId)!;
  const onCall = onCallFor(d.id) === serviceId;
  const working = status?.state === 'working';
  return (
    <div className="role-card" aria-label={`${place.agentName} role card`}>
      <div className="badge-photo">
        <Portrait id={serviceId} size={52} />
        <span className="lanyard" aria-hidden="true" />
        {onCall && (
          <span className="pager" title="On call this week" aria-hidden="true">
            📟
          </span>
        )}
      </div>
      <dl>
        <dt>Name</dt>
        <dd>
          <b>{place.agentName}</b>
        </dd>
        <dt>Team</dt>
        <dd>
          {svc.name.replace(/^(Amazon|AWS) /, '')} team · {d.hq}
        </dd>
        <dt>Level</dt>
        <dd>{LEVELS[Math.max(0, Math.min(level - 1, LEVELS.length - 1))]}</dd>
        <dt>On-call</dt>
        <dd>{onCall ? '📟 Primary this week' : 'Not this week'}</dd>
        <dt>Status</dt>
        <dd className={working ? 'working' : ''}>{working ? `● Working${status?.detail ? `: ${status.detail}` : ''}` : 'Idle'}</dd>
      </dl>
    </div>
  );
}
