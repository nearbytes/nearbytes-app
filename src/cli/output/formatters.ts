import type { Hash } from 'nearbytes-crypto';

export type OutputFormat = 'json' | 'table' | 'plain';

/**
 * Formats event list as JSON
 */
export function formatEventsAsJson(events: Hash[]): string {
  return JSON.stringify(
    {
      events: events.map((hash) => ({ hash })),
      count: events.length,
    },
    null,
    2
  );
}

/**
 * Formats event list as a table
 */
export function formatEventsAsTable(events: Hash[]): string {
  if (events.length === 0) {
    return 'No events found.';
  }

  const header = 'Event Hash';
  const separator = '-'.repeat(64);
  const rows = events.map((hash) => hash);

  return [header, separator, ...rows].join('\n');
}

/**
 * Formats event list as plain text
 */
export function formatEventsAsPlain(events: Hash[]): string {
  return events.join('\n');
}

/**
 * Formats a single event hash
 */
export function formatEventHash(hash: Hash): string {
  return hash;
}

/**
 * Formats operation result
 */
export function formatResult(result: Record<string, unknown>): string {
  return JSON.stringify(result, null, 2);
}

