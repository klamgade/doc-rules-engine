import type { AppliesTo } from './types.ts';

const MODE_LABELS: Record<string, string> = {
  SEA: 'Sea',
  AIR: 'Air',
  ROAD: 'Road',
  RAIL: 'Rail',
  POST: 'Post',
  COURIER: 'Courier',
};

const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

/**
 * Short label for the "Applies to" chip shown next to each document, e.g.
 * "Sea · Import · FCL/LCL" or "All shipments".
 */
export function describeAppliesTo(a: AppliesTo): string {
  const parts: string[] = [];
  if (a.modes) parts.push(a.modes.map((m) => MODE_LABELS[m] ?? m).join('/'));
  if (a.directions) parts.push(a.directions.map(title).join('/'));
  if (a.loadTypes) parts.push(a.loadTypes.join('/'));
  if (a.originCountries) parts.push(`from ${a.originCountries.join('/')}`);
  if (a.destinationCountries) parts.push(`to ${a.destinationCountries.join('/')}`);
  if (a.onlyWhenPreferenceClaimed) parts.push('if preference claimed');
  return parts.length ? parts.join(' · ') : 'All shipments';
}
