import { readFile } from 'node:fs/promises';

export const name = 'fixture';

export async function fetch({ since, until, env }) {
  if (!env.ERROR_COLLECTOR_FIXTURE) throw new Error('fixture path is required');
  const events = JSON.parse(await readFile(env.ERROR_COLLECTOR_FIXTURE, 'utf8'));
  if (!Array.isArray(events)) throw new Error('fixture must be an array');
  // The collector validates and filters too; sources may return boundary events.
  return events.filter(event => !Number.isFinite(Date.parse(event.ts)) || (Date.parse(event.ts) > Date.parse(since) && Date.parse(event.ts) <= Date.parse(until)));
}
