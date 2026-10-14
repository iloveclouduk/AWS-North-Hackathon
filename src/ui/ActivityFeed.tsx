import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { bus } from '@/state/bus';
import { agentName, useCity, type FeedItem, type TaskView } from '@/state/store';
import { agentColor, Portrait } from './Portrait';
import { Plain } from './Term';

const TASK_LABEL = { routing: 'Finding an agent', running: 'Working', done: '✓ Done', failed: '✗ Didn’t work' } as const;
const STEP_ICON = { pending: '·', running: '▸', done: '✓', failed: '✗', skipped: '⤼' } as const;

/**
 * A task an agent ran for you: the result first, then what you asked. The steps show while it runs; the AWS API
 * calls (and the finished steps) wait behind "Details".
 */
export function TaskCard({ task }: { task: TaskView }) {
  const who = task.agentId ?? 'concierge';
  const finished = task.status === 'done' || task.status === 'failed';
  const [details, setDetails] = useState(false);
  const done = task.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const calls = task.calls ?? [];
  // Honest labels: the demo backend only pretends to call AWS.
  const demo = useCity((s) => s.backendKind === 'mock');
  const showSteps = task.steps.length > 0 && (!finished || details);
  const hasDetails = calls.length > 0 || (finished && task.steps.length > 0);
  return (
    <div className={`task ${task.status} ${showSteps ? '' : 'folded'}`}>
      <div className="task-head">
        <Portrait id={who} size={30} />
        <div className="task-who">
          <b>{agentName(who)}</b>
          <span className={`task-state ${task.status}`}>
            {task.status === 'routing' || task.status === 'running' ? <span className="spinner" aria-hidden="true" /> : null}
            {TASK_LABEL[task.status]}
            {task.steps.length > 0 ? ` · ${task.status === 'running' ? `${done}/` : ''}${task.steps.length} steps` : ''}
          </span>
        </div>
        {hasDetails && (
          <button className="btn ghost tiny" aria-expanded={details} onClick={() => setDetails((o) => !o)}>
            {details ? 'Hide' : 'Details'}
          </button>
        )}
      </div>
      {/* The plain answer first, then what you asked. */}
      {task.result && (
        <div className="task-result">
          <Plain text={task.result} />
        </div>
      )}
      <div className="task-prompt">“{task.prompt}”</div>
      {details && calls.length > 0 && (
        <div className="calls" aria-label="AWS API calls made">
          <span className="calls-label">{demo ? 'AWS calls (simulated)' : 'Real AWS calls'}</span>
          {calls.map((c) => (
            <code key={c} className="api">
              {c}
            </code>
          ))}
        </div>
      )}
      {showSteps && (
        <>
          <div className="segs" aria-hidden="true">
            {task.steps.map((s, i) => (
              <i key={i} className={s.status === 'done' || s.status === 'skipped' ? 'done' : s.status === 'running' ? 'now' : s.status === 'failed' ? 'fail' : ''} />
            ))}
          </div>
          <ol className="steps">
            {task.steps.map((s, i) => (
              <li key={i} className={s.status}>
                <span className="ico">{STEP_ICON[s.status]}</span> <Plain text={s.text} />
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

/** One feed row. A run of lines from the same speaker shows their portrait once. */
function Line({ item, prev }: { item: FeedItem; prev?: FeedItem }) {
  const who = item.from ? agentName(item.from) : '';
  const target = item.from && item.from !== 'user' ? (item.from === 'concierge' ? 'plaza' : item.from) : undefined;
  const sameSpeaker = !!item.from && prev?.from === item.from && prev.kind !== 'system' && prev.kind !== 'user';
  const tint = { '--district': item.from ? agentColor(item.from) : undefined } as CSSProperties;
  // Rows that fly the camera to their agent are real buttons (keyboard reachable).
  const row = (cls: string, body: ReactNode) => {
    const inner = (
      <>
        {item.from && !sameSpeaker ? <Portrait id={item.from} size={24} /> : <span className="portrait-gap" aria-hidden="true" />}
        <span className="line-body">{body}</span>
      </>
    );
    return target ? (
      <li className={sameSpeaker ? 'cont' : undefined}>
        <button type="button" className={`line ${cls}`} style={tint} onClick={() => bus.emit('flyTo', { id: target })} title={`Show ${who} in the city`}>
          {inner}
        </button>
      </li>
    ) : (
      <li className={`line ${cls} ${sameSpeaker ? 'cont' : ''}`} style={tint}>
        {inner}
      </li>
    );
  };
  const name = sameSpeaker ? null : <b className="who">{who}</b>;
  switch (item.kind) {
    case 'user':
      return (
        <li className="line user">
          <span className="line-body">{item.text}</span>
        </li>
      );
    case 'message': {
      const to = item.to && item.to !== 'user' ? <span className="to"> → {agentName(item.to)}</span> : null;
      return row(
        'msg',
        <>
          {name}
          {to}
          {name || to ? <br /> : null}
          <Plain text={item.text} still={!!target} />
        </>,
      );
    }
    case 'state':
      // What the agent is calling right now (the real AWS API): a quiet mono tag, not a message.
      return row(
        'state',
        <>
          {name} <code className="api">{item.text}</code>
        </>,
      );
    case 'step':
      return row(
        'step',
        <>
          {name}
          {name ? <br /> : null}▸ <Plain text={item.text} still={!!target} />
        </>,
      );
    default:
      return (
        <li className="line sys">
          <span className="line-body">
            <Plain text={item.text} />
          </span>
        </li>
      );
  }
}

/** "Around town": what the agents said and did, newest first. Ambient chatter (and API names) only with chatter on. */
export function ActivityFeed() {
  const all = useCity((s) => s.feed);
  const chatter = useCity((s) => s.prefs.chatter);
  // API calls live on their task card; the feed keeps the conversation (chatter shows everything).
  const feed = useMemo(() => (chatter ? all : all.filter((f) => !f.ambient && f.kind !== 'state')), [all, chatter]);
  const lines = useMemo(() => [...feed].reverse(), [feed]);
  return (
    <div className="feed">
      {feed.length === 0 && <p className="quiet">Nothing yet. What the agents do shows up here.</p>}
      <ul className="lines">
        {lines.map((f, i) => (
          <Line key={f.id} item={f} prev={lines[i - 1]} />
        ))}
      </ul>
    </div>
  );
}
