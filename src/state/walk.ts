import { bus } from './bus';
import { useCity } from './store';

/**
 * Kai walks to a landmark and a quest's visit step counts when he gets there (CityScene's `walkTo`). When the city
 * can't walk him (asleep behind a game or an HQ), the visit counts at once, so a quest never waits on a scene that
 * isn't running.
 */
export function walkTo(id: string) {
  let taken = false;
  bus.emit('walkTo', { id, accept: () => (taken = true) });
  if (taken) return;
  useCity.getState().select(id);
  useCity.getState().arrive(id);
}
