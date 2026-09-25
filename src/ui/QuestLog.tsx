import { planDeploy, startQuest as notifyQuest, submitPrompt } from '@/app/runtime';
import { bus } from '@/state/bus';
import { useCity } from '@/state/store';
import { QUESTS, type QuestStep } from '@/world/content';
import { districtById, hexColor } from '@/world/taxonomy';

const ICON: Record<QuestStep['kind'], string> = { visit: '🚶', cards: '🃏', puzzle: '🧩', ask: '💬', deploy: '🚀' };

/** Quest lines: learn → cards → build → (deploy). Agents narrate; the city reacts. */
export function QuestLog({ openTab }: { openTab: (t: 'learn' | 'arch' | 'deploy') => void }) {
  const quests = useCity((s) => s.progress.quests) ?? NONE;
  const account = useCity((s) => s.account);
  const start = useCity((s) => s.startQuest);

  const act = (step: QuestStep) => {
    switch (step.kind) {
      case 'visit':
        bus.emit('flyTo', { id: step.serviceId });
        useCity.getState().select(step.serviceId);
        break;
      case 'cards':
        useCity.getState().select(step.serviceId);
        openTab('learn');
        break;
      case 'puzzle':
        openTab('arch');
        break;
      case 'ask':
        submitPrompt(step.prompt);
        break;
      case 'deploy':
        if (!account.linked) openTab('deploy');
        else planDeploy(step.templateId);
        break;
    }
  };

  const sorted = [...QUESTS].sort((a, b) => rank(quests[a.id]?.status) - rank(quests[b.id]?.status));
  return (
    <div className="quests">
      {sorted.map((q) => {
        const st = quests[q.id];
        const d = districtById(q.districtId);
        return (
          <section key={q.id} className={`quest ${st?.status ?? 'new'}`} style={{ borderColor: d ? hexColor(d.color) : undefined }}>
            <div className="quest-head">
              <b>
                {st?.status === 'done' ? '🏆 ' : '📜 '}
                {q.title}
              </b>
              <span className="muted">+{q.rewardXp} XP</span>
            </div>
            <div className="muted">{q.intro}</div>
            {!st && (
              <button
                className="btn primary"
                onClick={() => {
                  start(q.id);
                  notifyQuest(q.id);
                }}
              >
                Start quest
              </button>
            )}
            {st && (
              <ol className="steps">
                {q.steps.map((s, i) => {
                  const state = st.status === 'done' || i < st.step ? 'done' : i === st.step ? 'running' : 'pending';
                  return (
                    <li key={i} className={state}>
                      <span className="ico">{state === 'done' ? '✓' : ICON[s.kind]}</span> {s.text}
                      {s.kind === 'cards' && state === 'running' ? ` (${st.count ?? 0}/${s.count})` : ''}
                      {state === 'running' && (
                        <button className="btn tiny" onClick={() => act(s)}>
                          Go →
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}

const NONE: Record<string, { status: 'active' | 'done'; step: number; count?: number }> = {};
const rank = (s?: string) => (s === 'active' ? 0 : s === undefined ? 1 : 2);
