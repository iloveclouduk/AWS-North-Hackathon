// @vitest-environment jsdom
// The React cards and the ticker, rendered for real: what a player sees, and what the keyboard does.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The portraits read the character sheets Phaser loads; the cards only need a stand-in here.
vi.mock('@/ui/Portrait', () => ({ Portrait: () => <span data-testid="portrait" /> }));

const { useCity } = await import('@/state/store');
const { demoHealth, demoNews } = await import('@/backend/mockAccount');
const { IncidentCard } = await import('@/ui/IncidentCard');
const { ChoiceCard } = await import('@/ui/ChoiceCard');
const { NewsTicker } = await import('@/ui/NewsTicker');
const { ErrorBoundary } = await import('@/ui/ErrorBoundary');
const { choiceById } = await import('@/world/content');
const { Flashcards } = await import('@/ui/Flashcards');

const bahrain = () => useCity.getState().health!.incidents.find((i) => i.region === 'me-south-1')!;

beforeEach(() => {
  useCity.setState({ health: demoHealth(new Date('2026-10-11T12:00:00Z')), news: demoNews(), incidentOpen: undefined, choiceOpen: undefined });
});
afterEach(() => cleanup());

describe('the AWS status ticker', () => {
  it("leads with the worst open incident in this city's Region, and tapping it opens the card", () => {
    useCity.setState({ cityRegion: 'me-central-1' });
    render(<NewsTicker />);
    const line = screen.getByRole('button', { name: /AWS Health: .*disrupted/ });
    fireEvent.click(line);
    expect(useCity.getState().incidentOpen).toBeTruthy();
  });

  it('elsewhere, a weeks-old outage waits behind fresh AWS news', () => {
    useCity.setState({ cityRegion: 'us-west-2' });
    render(<NewsTicker />);
    expect(screen.getByRole('button', { name: /^AWS news: / })).toBeTruthy();
  });

  it('says nothing when there is nothing to say', () => {
    useCity.setState({ health: undefined, news: undefined });
    const { container } = render(<NewsTicker />);
    expect(container.innerHTML).toBe('');
  });
});

describe('an incident card', () => {
  it('is a labelled dialog: focus on Close, AWS’s words, the lesson, and Escape closes it', () => {
    const openTab = vi.fn();
    act(() => useCity.getState().openIncident(bahrain().id));
    render(<IncidentCard openTab={openTab} />);
    const dialog = screen.getByRole('dialog', { name: /Increased Error Rates/ });
    expect(dialog).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByText(/Why a second Region matters/)).toBeTruthy();
    expect(dialog.textContent).toMatch(/Affected Availability Zone ID: mes1-az2/);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useCity.getState().incidentOpen).toBeUndefined();
  });

  it('Try the drill opens the Region-down puzzle', () => {
    const openTab = vi.fn();
    act(() => useCity.getState().openIncident(bahrain().id));
    render(<IncidentCard openTab={openTab} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try the drill' }));
    expect(openTab).toHaveBeenCalledWith('arch');
    expect(useCity.getState().focusPuzzle).toBe('region-down');
    expect(useCity.getState().incidentOpen).toBeUndefined();
  });

  it('keeps Tab inside the card', () => {
    act(() => useCity.getState().openIncident(bahrain().id));
    render(<IncidentCard openTab={() => {}} />);
    const buttons = screen.getByRole('dialog').querySelectorAll<HTMLElement>('button');
    buttons[buttons.length - 1].focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(buttons[0]);
  });
});

describe('a quest question', () => {
  it('a wrong answer explains and stays open; the right one completes the step', () => {
    const { quest } = choiceById('ec2-spot')!;
    const at = quest.steps.findIndex((s) => s.kind === 'choose' && s.id === 'ec2-spot');
    const p = useCity.getState().progress;
    act(() => useCity.setState({ progress: { ...p, quests: { ...p.quests, [quest.id]: { status: 'active', step: at, count: 0 } } } }));
    act(() => useCity.getState().openChoice('ec2-spot'));
    render(<ChoiceCard />);
    fireEvent.click(screen.getByRole('button', { name: /Dedicated Hosts/ }));
    expect(screen.getByText(/Not quite/)).toBeTruthy();
    expect(useCity.getState().progress.quests![quest.id].step).toBe(at);
    fireEvent.click(screen.getByRole('button', { name: /Spot Instances/ }));
    expect(screen.getByText(/Right!/)).toBeTruthy();
    expect(useCity.getState().progress.quests![quest.id].step).toBe(at + 1);
  });
});

describe('the error boundary', () => {
  it('shows a plain sentence instead of a blank panel, and Try again redraws', () => {
    let broken = true;
    const Flaky = () => {
      if (broken) throw new Error('boom');
      return <p>All good</p>;
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary what="This tab">
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/This tab hit a snag/);
    expect(screen.queryByText(/boom/)).toBeNull();
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('All good')).toBeTruthy();
    spy.mockRestore();
  });
});

describe('explain it back', () => {
  it('asks one question, waits for a few words, then shows the key ideas used and the agent’s reply', async () => {
    const { ExplainBack } = await import('@/ui/ExplainBack');
    const { QUESTS } = await import('@/world/content');
    const q = QUESTS[0];
    render(<ExplainBack quest={q} />);
    fireEvent.click(screen.getByRole('button', { name: /Explain it back/ }));
    const box = screen.getByRole('textbox', { name: /In your own words/ });
    fireEvent.change(box, { target: { value: 'a bucket' } });
    expect(screen.getByRole('button', { name: /more words/ })).toHaveProperty('disabled', true);
    fireEvent.change(box, { target: { value: 'S3 keeps each file as an object in a bucket so it is safe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check my answer' }));
    expect(screen.getByText(/You used: .*bucket/)).toBeTruthy();
  });
});

describe('flashcard keys', () => {
  const flipped = (c: HTMLElement) => !!c.querySelector('.flash.back');

  it('F flips the card in the city, but not while a mini-game is open (its keys are its own)', () => {
    const p = useCity.getState().progress;
    useCity.setState({ progress: { ...p, landmarks: { ...p.landmarks, s3: { discovered: true, xp: 0 } } }, selected: 's3', view: { name: 'game', game: 'fishing' } as never });
    const { container } = render(<Flashcards />);
    fireEvent.keyDown(window, { key: 'f' });
    expect(flipped(container)).toBe(false);
    act(() => useCity.setState({ view: { name: 'city' } }));
    fireEvent.keyDown(window, { key: 'f' });
    expect(flipped(container)).toBe(true);
  });
});
