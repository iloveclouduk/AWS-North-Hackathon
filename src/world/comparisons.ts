// "Which one should I pick?" cards for services people mix up (shared/comparisons.json): plain words first, a pick-it-when
// line per service and a small side-by-side table, with the AWS decision guide or docs page it comes from.
import comparisonsJson from '../../shared/comparisons.json' with { type: 'json' };

export interface Comparison {
  id: string;
  title: string;
  simple: string;
  options: { serviceId: string; pick: string }[];
  rows: { label: string; values: Record<string, string> }[];
  source: string;
}

export const COMPARISONS = (comparisonsJson as unknown as { comparisons: Comparison[] }).comparisons;
export const comparisonById = (id: string) => COMPARISONS.find((c) => c.id === id);
/** The comparisons a service is part of (its Place card offers them). */
export const comparisonsFor = (serviceId: string) => COMPARISONS.filter((c) => c.options.some((o) => o.serviceId === serviceId));
