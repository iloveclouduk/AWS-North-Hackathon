import { startQuest as notifyQuest, submitPrompt } from '@/app/runtime';
import { agentName, useCity } from '@/state/store';
import { QUESTS } from '@/world/content';
import { PLACES, placeFor, TIER_NAMES } from '@/world/places';
import { bus } from '@/state/bus';
import { isDiscovered } from '@/state/selectors';
import type { Progress } from '@/backend/contract';
import { districtById, FEATURED_REQUESTS as REQUESTS } from '@/world/taxonomy';
import { ActivityFeed, TaskCard } from './ActivityFeed';
import { feel } from './feedback';
import { districtStyle, offlineReason, readPref, writePref } from './logic';
import { useEffect } from 'react';
import { Portrait } from './Portrait';
import { CityCare } from './FindingCard';
import { CityHealth } from './CityHealth';
import { runQuestStep, Segments, type OpenTab } from './QuestLog';
import { Plain } from './Term';
import { useLadder } from './useLadder';
import { questsDone } from '@/state/ladder';
import { currentStreak, dayKey, todayGoals, type TodayGoal } from '@/state/progress';
import { CERTS, certProgress } from '@/world/culture';

const first = (name: string) => name.split(' the ')[0];

/** The big "Start here" card shows once; after that (or once a quest has started) it's one line, so City care fits above the fold. */
const SEEN_KEY = 'awscity.startSeen';
const seenBefore = readPref(SEEN_KEY) === '1';

/**
 * The one thing to do next, said by a character: the current quest step, or (first visit) an offer of a
 * first quest. It's the only primary button on Home.
 */
function NextStep({ openTab }: { openTab: OpenTab }) {
  const quests = useCity((s) => s.progress.quests);
  const start = useCity((s) => s.startQuest);
  const lastDone = useCity((s) => s.taskOrder.map((id) => s.tasks[id]).find((t) => t?.status === 'done')?.agentId);
  const active = QUESTS.find((q) => quests?.[q.id]?.status === 'active');
  const compact = seenBefore || Object.keys(quests ?? {}).length > 0;
  useEffect(() => writePref(SEEN_KEY, '1'), []);

  if (active) {
    const st = quests![active.id]!;
    const step = active.steps[st.step];
    if (!step) return null;
    const giver = active.steps.find((x) => x.kind === 'visit')?.serviceId ?? active.serviceIds[0];
    if (compact)
      return (
        <section className="next compact" style={districtStyle(districtById(active.districtId)?.color)} aria-label="Your next step">
          <Portrait id={giver} size={24} />
          <span className="next-line" title={step.text}>
            <b>{active.title}:</b> <Plain text={step.text} />
            {step.kind === 'cards' ? ` (${st.count ?? 0}/${step.count})` : ''}
          </span>
          <button
            className="btn primary tiny"
            onClick={() => {
              feel.tap();
              runQuestStep(step, openTab);
            }}
          >
            Go →
          </button>
        </section>
      );
    return (
      <section className="next" style={districtStyle(districtById(active.districtId)?.color)} aria-label="Your next step">
        <div className="next-head">
          <span className="eyebrow">{active.title}</span>
          <Segments total={active.steps.length} at={st.step} />
        </div>
        <div className="next-body">
          <Portrait id={giver} size={40} />
          <p className="say">
            <b>{agentName(giver)}</b>
            {/* A character pointing at themselves speaks in the first person. */}
            <Plain text={step.kind === 'visit' && step.serviceId === giver ? `Come and find me at ${placeFor(giver)?.place ?? 'my place'}. I’ll show you around.` : step.text} />
            {step.kind === 'cards' ? ` (${st.count ?? 0}/${step.count})` : ''}
          </p>
        </div>
        <button
          className="btn primary wide"
          onClick={() => {
            feel.tap();
            runQuestStep(step, openTab);
          }}
        >
          Go →
        </button>
      </section>
    );
  }

  const fresh = QUESTS.find((q) => !quests?.[q.id]);
  const firstTime = !Object.keys(quests ?? {}).length;
  if (!fresh) return null;
  // React to what just happened: after a task finishes, credit the agent and offer the quest as the follow-up.
  const helped = lastDone && agentName(lastDone);
  if (compact)
    return (
      <section className="next compact" aria-label="Your next step">
        <Portrait id="concierge" size={24} />
        <span className="next-line">
          <b>Next quest:</b> “{fresh.title}”
        </span>
        <button
          className="btn primary tiny"
          onClick={() => {
            feel.questStart();
            start(fresh.id);
            notifyQuest(fresh.id);
          }}
        >
          Start
        </button>
      </section>
    );
  return (
    <section className="next" aria-label="Your next step">
      <div className="next-head">
        <span className="eyebrow">{firstTime ? (helped ? 'Nice work' : 'Start here') : 'Next quest'}</span>
      </div>
      <div className="next-body">
        <Portrait id="concierge" size={40} />
        <p className="say">
          <b>Connie</b>
          {firstTime
            ? helped
              ? `${helped} sorted that for you. Want to learn how it works? “${fresh.title}” walks you through it in about five minutes.`
              : `New in town? “${fresh.title}” takes about five minutes and shows you how the city works.`
            : `Ready for more? “${fresh.title}” is next.`}
        </p>
      </div>
      <button
        className="btn primary wide"
        onClick={() => {
          feel.questStart();
          start(fresh.id);
          notifyQuest(fresh.id);
        }}
      >
        Start the quest
      </button>
    </section>
  );
}

export function Home({ openTab }: { openTab: OpenTab }) {
  const asked = useCity((s) => s.taskOrder.length > 0);
  const latest = useCity((s) => (s.taskOrder[0] ? s.tasks[s.taskOrder[0]] : undefined));
  const offline = useCity((s) => offlineReason(s.backendKind, s.backendStatus));
  // Health and city care wait until care unlocks (src/state/ladder.ts), like the findings themselves.
  const ladderCare = useLadder().care;
  const released = useCity((s) => s.careReleased);
  const care = ladderCare || released;
  const r = REQUESTS[0];
  const progress = useCity((s) => s.progress);
  // On a first run's world map the only thing to do is pick a Region (WorldIntro): Home waits until the city opens.
  const choosing = useCity((s) => s.view.name === 'world' && !s.prefs.region);
  if (choosing)
    return (
      <div className="home">
        <p className="home-wait">
          <span aria-hidden="true">🌍</span> Pick a glowing dot on the map to start your city. Your first job will be waiting here.
        </p>
      </div>
    );
  return (
    <div className="home">
      <NextStep openTab={openTab} />
      <Today openTab={openTab} care={care} />
      {latest && <TaskCard key={latest.taskId} task={latest} />}
      {care && <CityHealth />}
      {care && (
        <details className="care-fold">
          <summary className="label">🩺 City care</summary>
          <CityCare />
        </details>
      )}
      {/* A second way to play (ask an agent) shows once the first quest has taught the basics: one goal at a time. */}
      {!asked && r && questsDone(progress) > 0 && (
        <section className="try" aria-label="An agent who can help">
          <h4 className="label">Or let an agent help</h4>
          <button
            className="request"
            disabled={!!offline}
            title={offline ?? `Ask: “${r.prompt}”`}
            onClick={() => {
              feel.send();
              submitPrompt(r.prompt);
            }}
          >
            <Portrait id={r.agent} size={30} />
            <span className="request-text">
              <b>{first(placeFor(r.agent)?.agentName ?? r.agent)}</b>
              {r.ask}
            </span>
            <span className="btn tiny request-go">Yes please</span>
          </button>
        </section>
      )}
      <details className="around">
        <summary className="label">Around town</summary>
        <ActivityFeed />
      </details>
    </div>
  );
}

const GOAL_TAB: Record<Exclude<TodayGoal['id'], 'games'>, Parameters<OpenTab>[0]> = { cards: 'learn', puzzles: 'arch', fixes: 'feed' };

/** The discovered building in this city whose game was played least (the Today game goal takes you there). */
export function gameBuilding(p: Progress, region: string | undefined) {
  const open = PLACES.filter((pl) => pl.game && isDiscovered(p, pl.serviceId, region));
  return open.sort((a, b) => (p.games?.[a.game!]?.plays ?? 0) - (p.games?.[b.game!]?.plays ?? 0))[0]?.serviceId;
}

/**
 * Today, in one small row under the next step (never a second big button): a few cards, a puzzle, a fix. Done ones get
 * a tick; each learning day keeps the streak alive (src/state/progress.ts).
 */
function Today({ openTab, care }: { openTab: OpenTab; care: boolean }) {
  const ladder = useLadder();
  const log = useCity((s) => s.today);
  const certGoal = useCity((s) => s.prefs.certGoal);
  const progress = useCity((s) => s.progress);
  const streak = useCity((s) => s.progress.streak);
  const region = useCity((s) => s.cityRegion);
  const day = dayKey();
  const game = gameBuilding(progress, region);
  const goals = todayGoals(log, day, { learn: ladder.tabs.has('learn'), puzzles: ladder.learnBuild, care, games: !!game });
  const cert = CERTS.certifications.find((c) => c.id === certGoal);
  if (!goals.length && !cert) return null;
  const steps = cert ? certProgress(progress, cert) : [];
  const days = currentStreak(streak, day);
  const done = goals.filter((g) => g.have >= g.goal).length;
  return (
    <section className="today" aria-label="Today">
      <div className="today-head">
        <span className="label">Today</span>
        <span className="muted">
          {done}/{goals.length} done{days ? ` · 🔥 ${days}-day streak` : ''}
        </span>
      </div>
      <ul className="today-goals">
        {goals.map((g) => {
          const ok = g.have >= g.goal;
          return (
            <li key={g.id}>
              <button
                className={`today-goal ${ok ? 'done' : ''}`}
                onClick={() => {
                  feel.tap();
                  if (g.id !== 'games') return openTab(GOAL_TAB[g.id]);
                  // a game starts from its building's card: fly there and open it
                  bus.emit('flyTo', { id: game! });
                  useCity.getState().select(game!);
                }}
              >
                <span aria-hidden="true">{ok ? '✅' : '◻️'}</span>
                <span>{g.label}</span>
                {g.goal > 1 && !ok && <span className="muted">{g.have}/{g.goal}</span>}
                <span className="sr-only">{ok ? ', done' : ''}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {cert && (
        <p className="today-goal-cert">
          🎯 <b>{cert.name.replace(/^AWS Certified /, '')}</b>:{' '}
          {steps.every((x) => x.done)
            ? 'trophy lit! 🏆'
            : steps.map((x) => `${districtById(x.districtId)?.name} ${x.done ? '✅' : `${TIER_NAMES[x.tier]} → ${TIER_NAMES[x.need]}`}`).join(' · ')}
        </p>
      )}
    </section>
  );
}
