// @vitest-environment jsdom
// Stage 8: the Copilot on real Cloudscape markup (the AWS console design system).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findExact, isCustomSelect, listboxFor, matchOption, openListbox, optionsIn, press } from '@/console/act';
import { Pacer, nextSpeed, parseSpeed, SPEEDS } from '@/console/pacing';
import { mayAct, mayChoose } from '@/console/safety';
import { isBusy, settle } from '@/console/settle';
import { elementFor, takeSnapshot } from '@/console/snapshot';
import { flowFor } from '@/backend/consoleMock';

const snap = () => takeSnapshot(document, { requireLayout: false });
const byName = (name: string | RegExp) => snap().items.find((i) => (typeof name === 'string' ? i.name === name : name.test(i.name)));

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('snapshot: shadow roots', () => {
  it('lists controls inside open shadow roots (nested too), and elementFor finds them by id', () => {
    document.body.innerHTML = `<h1>Create function</h1><div id="host"></div><button type="button">Cancel</button>`;
    const outer = document.getElementById('host')!.attachShadow({ mode: 'open' });
    outer.innerHTML = `<label for="fn">Function name</label><input id="fn" type="text" /><div id="inner"></div>`;
    const inner = (outer.getElementById('inner') as HTMLElement).attachShadow({ mode: 'open' });
    inner.innerHTML = `<button type="button">Create function</button>`;
    const s = snap();
    expect(s.items.map((i) => i.name)).toEqual(['Function name', 'Create function', 'Cancel']); // document order
    const create = s.items.find((i) => i.name === 'Create function')!;
    const el = elementFor(document, create.id)!;
    expect(el.getRootNode()).toBe(inner);
    expect(findExact(document, { id: create.id, name: 'x' })).toBe(el);
    // closed shadow roots stay invisible, like they are to page scripts
    const closed = document.createElement('div');
    closed.attachShadow({ mode: 'closed' }).innerHTML = '<button>Secret button</button>';
    document.body.append(closed);
    expect(snap().items.map((i) => i.name)).not.toContain('Secret button');
  });
});

describe('snapshot: accessible names', () => {
  it('uses aria-labelledby (several ids), then aria-label, label[for], a wrapping label, the form-field label, placeholder last', () => {
    document.body.innerHTML = `
      <div class="awsui_form-field_1a2b3"><label id="it-l" class="awsui_label_1a2b3">Instance type</label>
        <button type="button" aria-haspopup="listbox" aria-labelledby="it-l it-v"><span id="it-v">t2.micro</span></button></div>
      <input type="text" aria-label="Filter instances" aria-labelledby="missing" />
      <label for="nm">Name</label><input id="nm" type="text" />
      <label class="awsui_tile-container_9z"><input type="radio" name="os" checked /> Amazon Linux <span>Free tier eligible</span></label>
      <div class="awsui_form-field_4c5d6"><div><label class="awsui_label_4c5d6">Function name</label></div><div><input type="text" /></div></div>
      <div class="awsui_form-field_x"><label>Runtime</label><div><button type="button" aria-haspopup="listbox">Python 3.13</button></div></div>
      <input type="text" placeholder="Search" />`;
    const names = snap().items.map((i) => [i.role, i.name]);
    expect(names).toEqual([
      ['combobox', 'Instance type t2.micro'],
      ['textbox', 'Filter instances'],
      ['textbox', 'Name'],
      ['radio', 'Amazon Linux Free tier eligible'],
      ['textbox', 'Function name'],
      ['combobox', 'Runtime'], // the field label, not the trigger's current value
      ['textbox', 'Search'],
    ]);
  });

  it('includes Cloudscape widgets: radio tiles, switches, tabs, awsui_ tabindex=0 controls; options of an open listbox with the combobox as context', () => {
    document.body.innerHTML = `
      <div role="tablist"><div role="tab" aria-selected="true">Details</div></div>
      <div class="awsui_toggle_1" role="switch" aria-checked="false" aria-label="Deletion protection"></div>
      <div class="awsui_expandable-section-header_2" tabindex="0">Advanced settings</div>
      <label id="rt-l">Runtime</label>
      <button type="button" aria-haspopup="listbox" aria-expanded="true" aria-controls="rt-list" aria-labelledby="rt-l">Python</button>
      <ul role="listbox" id="rt-list"><li role="option" aria-selected="false"><span class="awsui_label_3">Node.js 22.x</span></li>
        <li role="option" aria-selected="true"><span class="awsui_label_3">Python 3.13</span></li></ul>`;
    const items = snap().items;
    expect(items.find((i) => i.name === 'Details')).toMatchObject({ role: 'tab', checked: true });
    expect(items.find((i) => i.name === 'Deletion protection')).toMatchObject({ role: 'switch', checked: false });
    expect(items.find((i) => i.name === 'Advanced settings')).toBeDefined();
    expect(items.find((i) => i.name === 'Node.js 22.x')).toMatchObject({ role: 'option', context: 'Runtime', checked: false });
    expect(items.find((i) => i.name === 'Python 3.13')).toMatchObject({ role: 'option', context: 'Runtime', checked: true });
  });
});

/** A Cloudscape-like select: opens on mousedown (after a beat), selects on mouseup — like select/utils/use-select.ts. */
function cloudscapeSelect(options: string[], opts: { riskyTestId?: string } = {}) {
  document.body.innerHTML = `<div class="awsui_form-field_1"><label id="l">Setting</label>
    <div class="awsui_select_1"><button type="button" id="t" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="l v"><span id="v">Keep</span></button></div></div>`;
  const trigger = document.getElementById('t')!;
  const picked: string[] = [];
  trigger.addEventListener('mousedown', () => {
    setTimeout(() => {
      const ul = document.createElement('ul');
      ul.setAttribute('role', 'listbox');
      ul.id = 'lb';
      ul.innerHTML = options
        .map((o, i) => `<li role="option" data-i="${i}"${opts.riskyTestId && i === options.length - 1 ? ` data-testid="${opts.riskyTestId}"` : ''}><span class="awsui_label_2">${o}</span></li>`)
        .join('');
      ul.addEventListener('mouseup', (e) => picked.push(options[+(e.target as Element).closest('li')!.getAttribute('data-i')!]!));
      trigger.parentElement!.append(ul);
      trigger.setAttribute('aria-expanded', 'true');
      trigger.setAttribute('aria-controls', 'lb');
    }, 50);
  });
  return { trigger, picked };
}

describe('custom (Cloudscape) select', () => {
  it('opens the list like a person (mousedown), waits for it, and picks the exact option on mouseup', async () => {
    const { trigger, picked } = cloudscapeSelect(['t2.micro', 't4g.micro', 't4g.small']);
    expect(isCustomSelect(trigger)).toBe(true);
    const lb = await openListbox(trigger);
    expect(lb).toBeDefined();
    expect(listboxFor(trigger)).toBe(lb);
    const opt = matchOption(optionsIn(lb!), 't4g.micro')!;
    expect(mayChoose(opt, 'Instance type')).toEqual({ ok: true });
    press(opt);
    expect(picked).toEqual(['t4g.micro']);
  });

  it('never guesses: no match or an ambiguous prefix picks nothing', async () => {
    const { trigger } = cloudscapeSelect(['Node.js 22.x', 'Node.js 20.x', 'Python 3.13']);
    const opts = optionsIn((await openListbox(trigger))!);
    expect(matchOption(opts, 'Node.js')).toBeUndefined(); // two start with it
    expect(matchOption(opts, 'Ruby')).toBeUndefined();
    expect(matchOption(opts, 'python')?.textContent).toBe('Python 3.13'); // unique whole-word prefix
    expect(matchOption(opts, 'Node.js 2')).toBeUndefined(); // not a word boundary
  });

  it('refuses a risky option (by its text, or a disguise in its other signals), and the trigger check still applies', async () => {
    const { trigger } = cloudscapeSelect(['Keep defaults', 'Disable Block Public Access']);
    const opts = optionsIn((await openListbox(trigger))!);
    expect(mayChoose(matchOption(opts, 'Disable Block Public Access')!, 'Setting')).toMatchObject({ ok: false, reason: 'risky' });

    const disguised = cloudscapeSelect(['Keep defaults', 'Next'], { riskyTestId: 'delete-all-objects' });
    const o2 = optionsIn((await openListbox(disguised.trigger))!);
    expect(mayChoose(matchOption(o2, 'Next')!, 'Setting')).toMatchObject({ ok: false, reason: 'risky' });
    expect(mayChoose(matchOption(o2, 'Keep defaults')!, 'Setting')).toEqual({ ok: true });

    // phase one: a trigger whose own label is risky is never opened by the agent
    document.body.innerHTML = `<button type="button" aria-haspopup="listbox" aria-label="Deletion policy" data-testid="delete-policy-select">Retain</button>`;
    const item = snap().items[0]!;
    expect(mayAct(item, 'select', findExact(document, item)!, 'Retain')).toMatchObject({ ok: false, reason: 'risky' });
  });

  it('refuses disabled options', () => {
    document.body.innerHTML = `<ul role="listbox"><li role="option" aria-disabled="true">m5.24xlarge</li></ul>`;
    expect(mayChoose(document.querySelector('li')!)).toMatchObject({ ok: false, reason: 'disabled' });
  });
});

describe('riskSignals survives long Cloudscape class lists', () => {
  it('still sees the visible text of a Delete button behind a 700-char class attribute', () => {
    const cls = Array.from({ length: 40 }, (_, i) => `awsui_button_vjswe_${i}abcd`).join(' ');
    document.body.innerHTML = `<button type="button" aria-label="Continue" class="${cls}">Delete bucket</button>`;
    const item = snap().items[0]!;
    expect(mayAct(item, 'click', findExact(document, item)!)).toMatchObject({ ok: false, reason: 'risky' });
  });
});

describe('settle', () => {
  it('waits while a Cloudscape spinner or aria-busy region is visible, and ignores hidden ones', async () => {
    document.body.innerHTML = `<div class="awsui_spinner_abc" hidden></div><div aria-busy="true" style="display:none"></div><h1>Tables</h1>`;
    expect(isBusy(document, false)).toBe(false); // hidden spinners don't count
    const r1 = await settle(document, { quietMs: 60, capMs: 2000, requireLayout: false });
    expect(r1.reason).toBe('quiet');

    const spinner = document.createElement('span');
    spinner.className = 'awsui_spinner_abc';
    document.body.append(spinner);
    expect(isBusy(document, false)).toBe(true);
    setTimeout(() => spinner.remove(), 400);
    const r2 = await settle(document, { quietMs: 60, capMs: 3000, requireLayout: false });
    expect(r2.reason).toBe('quiet');
    expect(r2.ms).toBeGreaterThanOrEqual(400);
  });

  it('treats an SPA route change (URL or heading) like a mutation, and gives up at the cap', async () => {
    document.body.innerHTML = `<h1>Tables</h1>`;
    setTimeout(() => history.pushState({}, '', '/dynamodbv2/home#create-table'), 150);
    const r = await settle(document, { quietMs: 200, capMs: 3000, requireLayout: false });
    expect(r.reason).toBe('quiet');
    expect(r.ms).toBeGreaterThanOrEqual(340); // restarted after the pushState

    document.body.innerHTML = `<div aria-busy="true">Loading</div>`;
    const capped = await settle(document, { quietMs: 20, capMs: 300, requireLayout: false });
    expect(capped.reason).toBe('cap');
  });
});

describe('pacing', () => {
  it('has slow/normal/fast read times, defaulting to normal', () => {
    expect(SPEEDS).toEqual({ slow: 2500, normal: 1400, fast: 700 });
    expect(parseSpeed(undefined)).toBe('normal');
    expect(parseSpeed('fast')).toBe('fast');
    expect(parseSpeed('warp')).toBe('normal');
    expect([nextSpeed('slow'), nextSpeed('normal'), nextSpeed('fast')]).toEqual(['normal', 'fast', 'slow']);
  });

  it('Pause blocks the next action until Resume; Explain again extends; Stop wins', async () => {
    vi.useFakeTimers();
    const p = new Pacer();
    p.speed = 'fast';
    let acted = false;
    p.setPaused(true);
    const h = p.hold().then((ok) => (acted = ok));
    await vi.advanceTimersByTimeAsync(5000);
    expect(acted).toBe(false);
    p.setPaused(false);
    await vi.advanceTimersByTimeAsync(300);
    await h;
    expect(acted).toBe(true);

    let done = false;
    const h2 = p.hold().then(() => (done = true));
    p.extend(3000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).toBe(false); // 700 ms read time + 3 s explain
    await vi.advanceTimersByTimeAsync(3000);
    await h2;
    expect(done).toBe(true);

    p.setPaused(true);
    const h3 = p.hold();
    p.stop();
    await vi.advanceTimersByTimeAsync(10);
    expect(await h3).toBe(false);
  });
});

describe('mock flows are routed by goal, then by the console URL', () => {
  it('picks the flow', () => {
    expect(flowFor('Launch an EC2 instance')).toBe('ec2');
    expect(flowFor('Create a DynamoDB table')).toBe('dynamodb');
    expect(flowFor('Make me a Lambda function')).toBe('lambda');
    expect(flowFor('Create an S3 bucket')).toBe('s3');
    expect(flowFor('do the thing', 'https://us-west-2.console.aws.amazon.com/dynamodbv2/home#tables')).toBe('dynamodb');
    expect(flowFor('help me here', 'https://us-west-2.console.aws.amazon.com/lambda/home')).toBe('lambda');
    expect(flowFor('help me here', 'https://us-west-2.console.aws.amazon.com/iam/home')).toBeUndefined();
    expect(flowFor('serverless', '')).toBe('lambda');
  });
});
