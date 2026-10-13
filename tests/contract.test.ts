import { describe, expect, it } from 'vitest';
import { MockBackend } from '@/backend/MockBackend';
import { bearerSubprotocols, CONTRACT_VERSION, isServerEvent, type AwsHealthEvent, type CityFinding, type ServerEvent } from '@/backend/contract';
import { DEMO, demoBill, demoFindings, demoFlow, demoHealth, demoInventory, demoNews } from '@/backend/mockAccount';
import regionFacts from '../shared/region-facts.json' with { type: 'json' };
import { ruleById } from '@/world/citizens';
import { serviceById } from '@/world/taxonomy';

/** The mock is the executable spec for the backend team: every event it emits must satisfy the contract. */
describe('MockBackend speaks the contract', () => {
  it('task.submit → plan, steps, working/idle states, done', async () => {
    const mock = new MockBackend({ speed: 200 });
    const events: ServerEvent[] = [];
    mock.onEvent((e) => events.push(e));
    mock.send({ action: 'task.submit', taskId: 't1', prompt: 'Store my holiday photos cheaply', context: {} });
    await new Promise((r) => setTimeout(r, 600));

    expect(events.every(isServerEvent)).toBe(true);
    const plan = events.find((e) => e.type === 'task.plan');
    expect(plan).toMatchObject({ type: 'task.plan', taskId: 't1', agentId: 's3', targetServiceId: 's3' });
    const steps = events.filter((e) => e.type === 'task.step');
    expect(steps.length).toBeGreaterThan(2);
    const states = events.filter((e) => e.type === 'agent.state' && e.agentId === 's3');
    expect(states.some((e) => e.type === 'agent.state' && e.state === 'working')).toBe(true);
    expect(states.at(-1)).toMatchObject({ state: 'idle' });
    const done = events.find((e) => e.type === 'task.done');
    expect(done).toMatchObject({ taskId: 't1', ok: true });
    // done comes after the plan
    expect(events.indexOf(done!)).toBeGreaterThan(events.indexOf(plan!));
  });

  it('chat.ask streams chat.answer chunks ending with done=true', async () => {
    const mock = new MockBackend({ speed: 200 });
    const events: ServerEvent[] = [];
    mock.onEvent((e) => events.push(e));
    mock.send({ action: 'chat.ask', requestId: 'r1', districtId: 'storage', question: 'When should I use EFS?', context: {} });
    await new Promise((r) => setTimeout(r, 400));
    const chunks = events.filter((e) => e.type === 'chat.answer');
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.at(-1)).toMatchObject({ done: true, districtId: 'storage', agentId: 'efs' });
  });

  it('deploy.plan → preview; nothing is created until deploy.approve', async () => {
    const mock = new MockBackend({ speed: 200 });
    const events: ServerEvent[] = [];
    mock.onEvent((e) => events.push(e));
    mock.send({ action: 'deploy.plan', requestId: 'p1', templateId: 'static-site' });
    await new Promise((r) => setTimeout(r, 100));
    const preview = events.find((e) => e.type === 'deploy.preview');
    expect(preview).toMatchObject({ requestId: 'p1', templateId: 'static-site', stackName: 'aws-city-static-site' });
    expect(events.some((e) => e.type === 'deploy.status')).toBe(false);
    if (preview?.type !== 'deploy.preview') throw new Error('no preview');
    expect(preview.changes.map((c) => c.resourceType)).toContain('AWS::CloudFront::Distribution');

    mock.send({ action: 'deploy.approve', deployId: preview.deployId });
    await new Promise((r) => setTimeout(r, 300));
    const statuses = events.filter((e) => e.type === 'deploy.status').map((e) => (e.type === 'deploy.status' ? e.status : ''));
    expect(statuses).toEqual(['creating', 'complete']);
  });

  describe('city care (v2.3)', () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    /** A mock that has connected and sent its inventory and every planted finding. */
    async function connected() {
      const mock = new MockBackend({ speed: 200 });
      const events: ServerEvent[] = [];
      mock.onEvent((e) => events.push(e));
      mock.connect();
      await sleep(500);
      mock.disconnect(); // stops the ambient chatter; the findings were already sent
      return { mock, events };
    }
    const findingsIn = (events: ServerEvent[]) => events.flatMap((e) => (e.type === 'city.finding' ? [e.finding] : []));
    const byRule = (events: ServerEvent[], ruleId: string) => findingsIn(events).find((f) => f.ruleId === ruleId)!;

    it('sends city.inventory on connect, then the open findings', async () => {
      const { events } = await connected();
      expect(events.every(isServerEvent)).toBe(true);
      const inv = events.findIndex((e) => e.type === 'city.inventory');
      const first = events.findIndex((e) => e.type === 'city.finding');
      expect(inv).toBeGreaterThanOrEqual(0);
      expect(first).toBeGreaterThan(inv);
      const e = events[inv];
      if (e.type !== 'city.inventory') throw new Error('no inventory');
      expect(e).toMatchObject({ source: 'mock', complete: true, truncated: false });
      expect(e.items.length).toBeGreaterThanOrEqual(35);
      expect(e.items.some((i) => i.serviceId === null)).toBe(true);
      expect(e.counts.other).toBe(e.items.filter((i) => i.serviceId === null).length);
      expect(findingsIn(events).map((f) => f.ruleId).sort()).toEqual(
        [
          'dynamodb-no-pitr',
          'ebs-default-encryption',
          'ebs-unattached',
          'ec2-graviton-candidate',
          'ec2-imdsv1',
          'ec2-previous-generation',
          'lambda-old-runtime',
          's3-public-access',
          'sg-world-admin',
        ].sort(),
      );
      expect(findingsIn(events).every((f) => f.status === 'open')).toBe(true);
    });

    it('builds findings from wa-rules.json, with the right fix scope', () => {
      const fs = demoFindings();
      for (const f of fs) {
        const rule = ruleById(f.ruleId)!;
        expect(f.title).toBe(rule.title);
        expect(f.text).not.toContain('{name}');
        expect(f.url).toBe(rule.url);
        expect(serviceById(f.serviceId)).toBeTruthy();
        expect(f.citizenId).toBe(`citizen:${rule.pillar}`);
        expect(!!f.fix).toBe(!!rule.fix);
      }
      const scope = (id: string) => fs.find((f) => f.ruleId === id)?.fix?.scope;
      // The city never builds things insecurely: only the PITR table is city-built (a game-scope fix).
      expect(scope('dynamodb-no-pitr')).toBe('game');
      expect([scope('s3-public-access'), scope('sg-world-admin'), scope('ec2-imdsv1'), scope('ebs-default-encryption')]).toEqual(['account', 'account', 'account', 'account']);
      expect(fs.filter((f) => f.resource.gameOwned).map((f) => f.ruleId)).toEqual(['dynamodb-no-pitr']);
      // Every citizen has work, and the three new rules are explain-only.
      expect(new Set(fs.map((f) => f.citizenId)).size).toBe(6);
      for (const id of ['ebs-unattached', 'ec2-previous-generation', 'ec2-graviton-candidate']) expect(fs.find((f) => f.ruleId === id)?.fix).toBeUndefined();
      expect(fs.every((f) => !!f.why)).toBe(true);
      expect(fs.find((f) => f.ruleId === 'dynamodb-no-pitr')?.fix?.costNote).toBe(ruleById('dynamodb-no-pitr')!.fix!.costNote);
      expect(demoInventory().items.every((i) => i.serviceId === null || serviceById(i.serviceId))).toBe(true);
    });

    it('finding.explain: the citizen works, then answers the player', async () => {
      const { mock, events } = await connected();
      const f = byRule(events, 'lambda-old-runtime');
      mock.send({ action: 'finding.explain', requestId: 'x1', findingId: f.id });
      await sleep(50);
      const states = events.filter((e) => e.type === 'agent.state' && e.agentId === f.citizenId);
      expect(states.map((e) => (e.type === 'agent.state' ? e.state : ''))).toEqual(['working', 'idle']);
      const msg = events.find((e) => e.type === 'agent.message' && e.from === f.citizenId && e.to === 'user');
      if (msg?.type !== 'agent.message') throw new Error('no answer');
      // It adds to the card (text + why) rather than repeating it, and leaves the link to the card's chip.
      expect(msg.text).not.toContain(f.text);
      expect(msg.text).not.toContain(f.why!);
      expect(msg.text).not.toContain('https://');
      expect(events.every(isServerEvent)).toBe(true);
    });

    it('finding.fix → deploy.preview with findingId and rollback; nothing resolves before approve', async () => {
      const { mock, events } = await connected();
      const f = byRule(events, 'dynamodb-no-pitr');
      mock.send({ action: 'finding.fix', requestId: 'f1', findingId: f.id });
      await sleep(50);
      const preview = events.find((e) => e.type === 'deploy.preview');
      if (preview?.type !== 'deploy.preview') throw new Error('no preview');
      expect(preview).toMatchObject({ requestId: 'f1', findingId: f.id, rollback: f.fix!.rollback, costNote: f.fix!.costNote });
      expect(preview.confirmText).toBeUndefined();
      expect(events.some((e) => e.type === 'deploy.status')).toBe(false);
      expect(findingsIn(events).some((x) => x.id === f.id && x.status === 'resolved')).toBe(false);

      mock.send({ action: 'deploy.approve', deployId: preview.deployId });
      await sleep(50);
      const statuses = events.filter((e) => e.type === 'deploy.status').map((e) => (e.type === 'deploy.status' ? e.status : ''));
      expect(statuses).toEqual(['creating', 'complete']);
      const after = findingsIn(events).filter((x) => x.id === f.id).at(-1) as CityFinding;
      expect(after.status).toBe('resolved');
      expect(after.undoUntil).toBeUndefined(); // fixes are one-way; the rollback text says how to undo in the console
      expect(events.every(isServerEvent)).toBe(true);
    });

    it('an account-scope fix needs the typed confirmation', async () => {
      const { mock, events } = await connected();
      const f = byRule(events, 'ec2-imdsv1');
      const ask = async (requestId: string) => {
        mock.send({ action: 'finding.fix', requestId, findingId: f.id });
        await sleep(50);
        const p = events.find((e) => e.type === 'deploy.preview' && e.requestId === requestId);
        if (p?.type !== 'deploy.preview') throw new Error('no preview');
        return p;
      };
      const first = await ask('a1');
      expect(first.confirmText).toBe(f.resource.arn ?? (f.resource.id.includes(':') ? f.resource.name : f.resource.id));
      mock.send({ action: 'deploy.approve', deployId: first.deployId, confirm: 'build-runne' });
      await sleep(50);
      expect(events.find((e) => e.type === 'deploy.status' && e.deployId === first.deployId)).toMatchObject({ status: 'failed' });
      expect(findingsIn(events).some((x) => x.id === f.id && x.status === 'resolved')).toBe(false);

      const second = await ask('a2');
      mock.send({ action: 'deploy.approve', deployId: second.deployId, confirm: second.confirmText });
      await sleep(50);
      expect(findingsIn(events).filter((x) => x.id === f.id).at(-1)?.status).toBe('resolved');
    });

    it('a finding with no fix is refused, and finding.undo only says how to undo by hand', async () => {
      const { mock, events } = await connected();
      const old = byRule(events, 'lambda-old-runtime');
      mock.send({ action: 'finding.fix', requestId: 'n1', findingId: old.id });
      const s3 = byRule(events, 's3-public-access');
      mock.send({ action: 'finding.undo', requestId: 'u1', findingId: s3.id });
      await sleep(50);
      expect(events.find((e) => e.type === 'error' && e.requestId === 'n1')).toBeTruthy();
      // Contract v2.3 (FindingUndo): the answer is an agent.message from the citizen, never an error.
      expect(events.some((e) => e.type === 'error' && e.requestId === 'u1')).toBe(false);
      expect(events.find((e) => e.type === 'agent.message' && e.text === s3.fix!.rollback)).toMatchObject({ from: s3.citizenId, to: 'user' });
      expect(events.some((e) => e.type === 'deploy.preview')).toBe(false);
    });
  });

  describe('the real map and the bill (v2.5)', () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const facts = regionFacts.regions as Record<string, { optIn: boolean; azIds: string[]; partition: string }>;

    it('the inventory carries zones whose names cover every demo item and link AZ, with real AZ IDs', () => {
      const inv = demoInventory();
      const zones = inv.zones!;
      for (const it of inv.items.filter((i) => i.az)) {
        const r = it.region ?? inv.region;
        expect(zones[r]?.map((z) => z.name), `${it.name} in ${it.az}`).toContain(it.az);
      }
      for (const l of inv.links ?? []) for (const end of [l.from, l.to]) if (end.az) expect(zones[end.region]?.map((z) => z.name)).toContain(end.az);
      for (const [r, zs] of Object.entries(zones)) {
        expect(new Set(zs.map((z) => z.id)), r).toEqual(new Set(facts[r]!.azIds));
        expect(zs.map((z) => z.name)).toEqual([...zs.map((z) => z.name)].sort());
      }
      // Names are mapped per account: here us-west-2a isn't usw2-az1.
      expect(zones['us-west-2']!.find((z) => z.name === 'us-west-2a')!.id).not.toBe('usw2-az1');
    });

    it('regionStatus: every non-opt-in Region is enabled, af-south-1 is not, and some opt-in Regions are', () => {
      const status = demoInventory().regionStatus!;
      // A standard account's DescribeRegions never lists GovCloud or the Sovereign Cloud: those need their own account.
      for (const [code, f] of Object.entries(facts)) if (!f.optIn && f.partition === 'aws') expect(status[code], code).toBe('enabled');
      for (const [code, f] of Object.entries(facts)) if (f.partition !== 'aws') expect(status[code], code).toBeUndefined();
      expect(status['af-south-1']).toBe('not-enabled');
      const optIn = Object.keys(status).filter((c) => facts[c]?.optIn);
      expect(optIn.some((c) => status[c] === 'enabled')).toBe(true);
      expect(Object.keys(status).every((c) => c in facts)).toBe(true);
    });

    it('the demo bill is small, adds up, and only names real services and the account’s Regions', () => {
      const b = demoBill(new Date('2026-10-10T12:00:00Z'));
      expect(b).toMatchObject({ type: 'city.bill', month: '2026-10', currency: 'USD', estimated: true });
      expect(b.total).toBeGreaterThanOrEqual(3);
      expect(b.total).toBeLessThanOrEqual(15);
      const sum = (m: Record<string, number>) => Math.round(Object.values(m).reduce((a, n) => a + n, 0) * 100) / 100;
      expect(sum(b.byService)).toBe(b.total);
      expect(sum(b.byRegion)).toBe(b.total);
      for (const id of Object.keys(b.byService)) expect(id === 'other' || !!serviceById(id), id).toBe(true);
      const regions = new Set(DEMO.items.map((i) => i.region ?? DEMO.region));
      for (const r of Object.keys(b.byRegion)) expect(r === 'global' || regions.has(r), r).toBe(true);
    });

    it('background chatter is talk only: no agent works for it (only real calls animate work)', async () => {
      const mock = new MockBackend({ speed: 200 });
      const events: ServerEvent[] = [];
      mock.onEvent((e) => events.push(e));
      mock.connect();
      await sleep(600);
      mock.disconnect();
      expect(events.some((e) => e.type === 'agent.message' && e.to !== 'user')).toBe(true);
      expect(events.filter((e) => e.type === 'agent.state')).toEqual([]);
    });

    it('the practice account’s links to other Regions show only once it is linked', async () => {
      const mock = new MockBackend({ speed: 200 });
      const events: ServerEvent[] = [];
      mock.onEvent((e) => events.push(e));
      const crossRegion = () =>
        events
          .filter((e) => e.type === 'city.inventory')
          .map((e) => (e.type === 'city.inventory' ? (e.links ?? []).filter((l) => l.from.region !== l.to.region).length : 0));
      mock.connect();
      await sleep(100);
      expect(crossRegion()).toEqual([0]);
      mock.send({ action: 'account.verify', roleArn: 'arn:aws:iam::123456789012:role/AWSCityPlayerRole-us-west-2' } as never);
      await sleep(200);
      expect(crossRegion().at(-1)).toBeGreaterThan(0);
      mock.disconnect();
    });

    it('the bill is off until bill.enable; then city.bill comes, and again on reconnect', async () => {
      const mock = new MockBackend({ speed: 200 });
      const events: ServerEvent[] = [];
      mock.onEvent((e) => events.push(e));
      mock.connect();
      await sleep(100);
      expect(events.some((e) => e.type === 'city.bill')).toBe(false);
      mock.send({ action: 'bill.enable', on: true });
      await sleep(700);
      expect(events.filter((e) => e.type === 'city.bill')).toHaveLength(1);
      expect(events.every(isServerEvent)).toBe(true);
      mock.disconnect();
      mock.connect();
      await sleep(100);
      expect(events.filter((e) => e.type === 'city.bill')).toHaveLength(2);
      mock.send({ action: 'bill.enable', on: false });
      mock.disconnect();
      mock.connect();
      await sleep(100);
      mock.disconnect();
      expect(events.filter((e) => e.type === 'city.bill')).toHaveLength(2);
    });
  });

  describe('live traffic (v2.8)', () => {
    it('the demo traffic is valid, only real landmarks, and its AZs are the demo Region\'s', () => {
      const f = demoFlow(new Date('2026-10-12T12:00:00Z'));
      expect(isServerEvent(f)).toBe(true);
      expect(f.region).toBe(DEMO.region);
      for (const r of f.rates) {
        expect(serviceById(r.serviceId), r.serviceId).toBeTruthy();
        expect(r.perMin).toBeGreaterThan(0);
        for (const az of Object.keys(r.byAz ?? {})) expect(az.startsWith(DEMO.region), az).toBe(true);
      }
      // It moves from minute to minute, the same for everyone in the same minute.
      expect(demoFlow(new Date('2026-10-12T12:00:10Z'))).toMatchObject({ rates: f.rates });
      expect(demoFlow(new Date('2026-10-12T12:07:00Z')).rates).not.toEqual(f.rates);
    });

    it('is off until flow.enable; then city.flow comes, and again on reconnect', async () => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const mock = new MockBackend({ speed: 200 });
      const events: ServerEvent[] = [];
      mock.onEvent((e) => events.push(e));
      mock.connect();
      await sleep(100);
      expect(events.some((e) => e.type === 'city.flow')).toBe(false);
      mock.send({ action: 'flow.enable', on: true });
      await sleep(700);
      expect(events.filter((e) => e.type === 'city.flow')).toHaveLength(1);
      mock.disconnect();
      mock.connect();
      await sleep(100);
      expect(events.filter((e) => e.type === 'city.flow')).toHaveLength(2);
      mock.send({ action: 'flow.enable', on: false });
      mock.disconnect();
    });
  });

  describe('AWS public status (v2.6)', () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    it('is contract 2.8 (2.6 added these), and both new events pass the frame guard', () => {
      expect(CONTRACT_VERSION).toBe(2.8);
      expect(isServerEvent(demoHealth())).toBe(true);
      expect(isServerEvent(demoNews())).toBe(true);
    });

    it('the demo dashboard is the real Bahrain and UAE events, only real landmarks, and AWS links only', () => {
      const h = demoHealth(new Date('2026-10-11T12:00:00Z'));
      expect(h.incidents.map((i) => i.region).sort()).toEqual(['me-central-1', 'me-south-1']);
      for (const i of h.incidents) {
        expect(i.drill, i.id).toBeUndefined();
        for (const id of i.serviceIds) expect(serviceById(id), id).toBeTruthy();
        expect(i.log.length).toBeGreaterThan(0);
        expect(i.log[0].at >= i.log.at(-1)!.at).toBe(true);
      }
      for (const n of demoNews().items) expect(n.url.startsWith('https://aws.amazon.com/'), n.url).toBe(true);
    });

    it('a practice drill is always marked as one, in the demo Region, and resolves', () => {
      const at = new Date('2026-10-11T12:00:00Z');
      const open = demoHealth(at, { at }).incidents[0];
      expect(open).toMatchObject({ drill: true, region: DEMO.region, status: 'open' });
      expect(open.title).toMatch(/^Practice drill/);
      const done = demoHealth(at, { at, resolvedAt: new Date('2026-10-11T12:02:00Z') }).incidents[0];
      expect(done.status).toBe('resolved');
      expect(done.log[0].at).toBe('2026-10-11T12:02:00.000Z');
    });

    it('the demo sends the dashboard and news on connect, then a drill that opens and resolves, once per session', async () => {
      const mock = new MockBackend({ speed: 1000 });
      const events: ServerEvent[] = [];
      mock.onEvent((e) => events.push(e));
      mock.connect();
      await sleep(5);
      const health = () => events.filter((e): e is AwsHealthEvent => e.type === 'aws.health');
      // No drill while the player is on their first quest.
      await sleep(245);
      expect(health().every((h) => !h.incidents.some((i) => i.drill))).toBe(true);
      // Once a quest is done, the drill runs.
      mock.send({ action: 'progress.put', progress: { version: 2, landmarks: {}, quests: { q: { status: 'done', step: 1 } }, updatedAt: new Date().toISOString() } });
      await sleep(250);
      expect(events.some((e) => e.type === 'aws.news')).toBe(true);
      expect(health().length).toBeGreaterThanOrEqual(3);
      expect(health()[0].incidents.some((i) => i.drill)).toBe(false);
      expect(health().at(-1)!.incidents.find((i) => i.drill)?.status).toBe('resolved');
      const n = health().length;
      mock.disconnect();
      mock.connect();
      await sleep(250);
      mock.disconnect();
      // On reconnect: the dashboard again (drill included, still resolved), no second drill.
      expect(health().length).toBe(n + 1);
      expect(health().at(-1)!.incidents.filter((i) => i.drill)).toHaveLength(1);
      expect(events.every(isServerEvent)).toBe(true);
    });
  });

  it('bearerSubprotocols uses the AgentCore browser OAuth format (token never in the URL)', () => {
    const [p1, p2] = bearerSubprotocols('a.b+c/d=');
    expect(p2).toBe('base64UrlBearerAuthorization');
    expect(p1.startsWith('base64UrlBearerAuthorization.')).toBe(true);
    expect(p1).not.toMatch(/[+/=]/);
  });

  it('rejects frames with unknown types', () => {
    expect(isServerEvent({ type: 'nope' })).toBe(false);
    expect(isServerEvent(null)).toBe(false);
  });
});
