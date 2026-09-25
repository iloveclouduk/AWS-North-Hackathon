import { useEffect, useRef, type ReactNode } from 'react';
import { bus } from '@/state/bus';
import { agentName, useCity, type FeedItem, type TaskView } from '@/state/store';

const TASK_LABEL = { routing: 'Finding an agent…', running: 'Working…', done: 'Done', failed: 'Didn’t work' } as const;
const STEP_ICON = { pending: '○', running: '▶', done: '✓', failed: '✗', skipped: '⤼' } as const;

function TaskCard({ task }: { task: TaskView }) {
  return (
    <div className={`task ${task.status}`}>
      <div className="task-head">
        <b>{task.agentId ? agentName(task.agentId) : 'Connie the Concierge'}</b>
        <span className="muted">{TASK_LABEL[task.status]}</span>
      </div>
      <div className="task-prompt">“{task.prompt}”</div>
      {task.steps.length > 0 && (
        <ol className="steps">
          {task.steps.map((s, i) => (
            <li key={i} className={s.status}>
              <span className="ico">{STEP_ICON[s.status]}</span> {s.text}
            </li>
          ))}
        </ol>
      )}
      {task.result && <div className="task-result">{task.result}</div>}
    </div>
  );
}

function Line({ item }: { item: FeedItem }) {
  const who = item.from ? agentName(item.from) : '';
  const target = item.from && item.from !== 'user' ? (item.from === 'concierge' ? 'plaza' : item.from) : undefined;
  // Rows that fly the camera to their agent are real buttons (keyboard reachable).
  const row = (cls: string, body: ReactNode) =>
    target ? (
      <li>
        <button type="button" className={`line ${cls}`} onClick={() => bus.emit('flyTo', { id: target })} title={`Show ${who} in the city`}>
          {body}
        </button>
      </li>
    ) : (
      <li className={`line ${cls}`}>{body}</li>
    );
  switch (item.kind) {
    case 'user':
      return <li className="line user">🧑 {item.text}</li>;
    case 'message':
      return row(
        'msg',
        <>
          <b>{who}</b>
          {item.to && item.to !== 'user' ? <span className="muted"> → {agentName(item.to)}</span> : null}: {item.text}
        </>,
      );
    case 'state':
      return row(
        'state',
        <>
          ⚙️ <b>{who}</b> <code>{item.text}</code>
        </>,
      );
    case 'step':
      return row(
        'step',
        <>
          ▶ <b>{who}</b>: {item.text}
        </>,
      );
    default:
      return <li className="line sys">{item.text}</li>;
  }
}

export function ActivityFeed() {
  const feed = useCity((s) => s.feed);
  const latest = useCity((s) => (s.taskOrder[0] ? s.tasks[s.taskOrder[0]] : undefined));
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [feed.length]);
  return (
    <div className="feed">
      {latest && <TaskCard task={latest} />}
      {!latest && feed.length === 0 && <p className="empty">Nothing happening yet — ask the city to do something below, or open an AWS console page.</p>}
      <ul className="lines">
        {feed.map((f) => (
          <Line key={f.id} item={f} />
        ))}
        <li ref={end} />
      </ul>
    </div>
  );
}
