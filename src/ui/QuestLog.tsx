import { planDeploy, releaseCare, startQuest as notifyQuest, submitPrompt } from '@/app/runtime';
import type { Unlock } from '@/state/ladder';
import { bus } from '@/state/bus';
import { useCity } from '@/state/store';
import { QUESTS, type Quest, type QuestStep } from '@/world/content';
import { districtById } from '@/world/taxonomy';
import { feel } from './feedback';
import { districtStyle } from './logic';
import { Portrait } from './Portrait';
import { Plain } from './Term';
import { addOpened, useLocked } from './useLadder';

const KIND: Record<QuestStep['kind'], string> = { visit: 'Visit', cards: 'Flashcards', puzzle: 'Architecture', ask: 'Ask the agents', deploy: 'Deploy', choose: 'Your call' };

export type OpenTab = (t: 'learn' | 'arch' | 'deploy' | 'feed' | 'quests' | 'map') => void;

/** What "Go →" does for a quest step (shared by the Quests tab and the tracker strip). */
export function runQuestStep(step: QuestStep, openTab: OpenTab) {
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
      useCity.getState().setFocusPuzzle(step.puzzleId);
      openTab('arch');
      break;
    case 'ask':
      submitPrompt(step.prompt);
      openTab('feed');
      break;
    case 'deploy':
      if (!useCity.getState().account.linked) openTab('deploy');
      else planDeploy(step.templateId);
      break;
    case 'choose':
      useCity.getState().openChoice(step.id);
      break;
  }
}

/** A locked area opens now and stays open (src/state/ladder.ts `opened`): a quest's "Go →", a building tap. */
export function openArea(area: Unlock['area'], openTab: OpenTab) {
  addOpened(area);
  switch (area) {
    case 'learn':
      return openTab('learn');
    case 'learnBuild':
      return openTab('arch');
    case 'deploy':
      return openTab('deploy');
    case 'care':
      releaseCare();
      return openTab('feed');
    case 'map':
    case 'day1':
    case 'worldList':
      return openTab('map');
    case 'news':
      return;
  }
}

/**
 * Quest lines: the active quest (open), one "Up next" card, the rest folded as titles, finished ones folded.
 * Below them, one line saying what unlocks next.
 */
export function QuestLog({ openTab }: { openTab: OpenTab }) {
  const quests = useCity((s) => s.progress.quests) ?? NONE;
  const start = useCity((s) => s.startQuest);
  const locked = useLocked();
  const act = (step: QuestStep) => runQuestStep(step, openTab);

  const active = QUESTS.filter((q) => quests[q.id]?.status === 'active');
  const fresh = QUESTS.filter((q) => !quests[q.id]);
  const done = QUESTS.filter((q) => quests[q.id]?.status === 'done');
  const [upNext, ...later] = fresh;

  const head = (q: Quest) => {
    const st = quests[q.id];
    const giver = q.steps.find((x) => x.kind === 'visit')?.serviceId ?? q.serviceIds[0];
    return (
      <div className="quest-head">
        <Portrait id={giver} size={32} />
        <div className="quest-title">
          <div className="qt-row">
            <b>{q.title}</b>
            <span className="xp-chip">+{q.rewardXp} ⭐</span>
          </div>
          {st && <Segments total={q.steps.length} at={st.status === 'done' ? q.steps.length : st.step} />}
        </div>
      </div>
    );
  };
  const color = (q: Quest) => districtStyle(districtById(q.districtId)?.color);

  return (
    <div className="quests">
      {active.map((q) => {
        const st = quests[q.id]!;
        return (
          <section key={q.id} className="quest edge active" style={color(q)}>
            {head(q)}
            <p className="quest-intro">
              <Plain text={q.intro} />
            </p>
            <QuestSteps steps={q.steps} at={st.step} count={st.count} onGo={act} />
          </section>
        );
      })}
      {upNext && (
        <>
          <h4 className="up-next-label">Up next</h4>
          <section className="quest edge new" style={color(upNext)}>
            {head(upNext)}
            <p className="quest-intro">
              <Plain text={upNext.intro} />
            </p>
            {/* One filled button per screen: the active step's Go, else this. */}
            <button
              className={`btn ${active.length ? '' : 'primary'}`}
              onClick={() => {
                feel.questStart();
                start(upNext.id);
                notifyQuest(upNext.id);
              }}
            >
              Start quest
            </button>
          </section>
        </>
      )}
      {later.length > 0 && (
        <details className="quest-later">
          <summary>
            {later.length} more quest{later.length === 1 ? '' : 's'} later
          </summary>
          <ul>
            {later.map((q) => (
              <li key={q.id}>{q.title}</li>
            ))}
          </ul>
        </details>
      )}
      {/* Finished quests fold to one line with a stamp. */}
      {done.map((q) => (
        <details key={q.id} className="quest edge done" style={color(q)}>
          <summary>
            {head(q)}
            <span className="stamp" aria-label="Quest complete">
              🏆
            </span>
          </summary>
          <QuestSteps steps={q.steps} at={q.steps.length} />
        </details>
      ))}
      {/* Only the next unlock, as a hint (no buttons: everything else comes in its own time, or via ⋯ → Peek at everything). */}
      {locked[0] && (
        <p className="coming-next" aria-label="Coming up next">
          <span aria-hidden="true">🔓</span> <b>Coming up next: {locked[0].label}.</b> {locked[0].how}.
        </p>
      )}
    </div>
  );
}

/** One pixel segment per step: done, now (blinking), to do. */
export function Segments({ total, at }: { total: number; at: number }) {
  return (
    <span className="segs-row">
      <span className="segs" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <i key={i} className={i < at ? 'done' : i === at ? 'now' : ''} />
        ))}
      </span>
      <span className="segs-count">
        {Math.min(at, total)}/{total}
      </span>
    </span>
  );
}

function QuestSteps({ steps, at, count, onGo }: { steps: QuestStep[]; at: number; count?: number; onGo?: (s: QuestStep) => void }) {
  return (
    <ol className="steps quest-steps">
      {steps.map((s, i) => {
        const state = i < at ? 'done' : i === at ? 'running' : 'pending';
        return (
          <li key={i} className={state}>
            <span className={`ico n ${state}`} title={KIND[s.kind]}>
              {state === 'done' ? '✓' : i + 1}
            </span>
            <span className="step-text">
              <Plain text={s.text} />
              {s.kind === 'cards' && state === 'running' ? ` (${count ?? 0}/${s.count})` : ''}
            </span>
            {state === 'running' && onGo && (
              <button className="btn tiny primary" onClick={() => onGo(s)}>
                Go →
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const NONE: Record<string, { status: 'active' | 'done'; step: number; count?: number }> = {};
