import { useEffect, useRef } from 'react';
import { bus } from '@/state/bus';
import { agentName, useCity, type FeedItem, type TaskView } from '@/state/store';

const STEP_ICON = { pending: '○', running: '▶', done: '✓', failed: '✗' } as const;

function TaskCard({ task }: { task: TaskView }) {
  return (
    <div className={`task ${task.status}`}>
      <div className="task-head">
        <b>{task.agentId ? agentName(task.agentId) : 'Connie the Concierge'}</b>
        <span className="muted">{task.status === 'routing' ? 'routing…' : task.status}</span>
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
  const focus = () => item.from && item.from !== 'user' && bus.emit('flyTo', { id: item.from === 'concierge' ? 'plaza' : item.from });
  switch (item.kind) {
    case 'user':
      return <li className="line user">🧑 {item.text}</li>;
    case 'message':
      return (
        <li className="line msg" onClick={focus}>
          <b>{who}</b>
          {item.to && item.to !== 'user' ? <span className="muted"> → {agentName(item.to)}</span> : null}: {item.text}
        </li>
      );
    case 'state':
      return (
        <li className="line state" onClick={focus}>
          ⚙️ <b>{who}</b> <code>{item.text}</code>
        </li>
      );
    case 'step':
      return (
        <li className="line step" onClick={focus}>
          ▶ <b>{who}</b>: {item.text}
        </li>
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
      <ul className="lines">
        {feed.map((f) => (
          <Line key={f.id} item={f} />
        ))}
        <li ref={end} />
      </ul>
    </div>
  );
}
