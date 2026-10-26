import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correlate, incidentOf, relatedTicket, taskIncident } from './incident.mjs';

const ts = '2026-10-26T08:55:00Z';
const event = (field = 'updatedAt', route = '/api/mcp/projects', operation = 'findMany') => ({ route, ts, message: `PrismaClientValidationError: Invalid \`prisma.project.${operation}()\` invocation: Unknown argument \`${field}\`.` });
const wrapper = { route: '/mcp', ts, message: 'Failed to list projects | Internal server error' };
const group = { incident: incidentOf(event()), firstSeen: ts };
const feedback = { id: 8017, ticketNumber: 'HTPR-8017', status: 'Normal', section: 'Bugs', description: `<p>Tool: hypertask_projects</p><p>HTTP status: 500</p><p>Last seen: ${ts}</p>` };

test('model and unknown field group count and findMany, never another field, model or route', () => {
  const key = incidentOf(event()).key;
  assert.equal(key, incidentOf(event('updatedAt', '/api/mcp/projects', 'count')).key);
  assert.notEqual(key, incidentOf(event('other')).key);
  assert.notEqual(key, incidentOf({ ...event(), message: event().message.replace('project.', 'task.') }).key);
  assert.notEqual(key, incidentOf(event('updatedAt', '/api/projects')).key);
  assert.equal(incidentOf({ ...event(), message: 'database unavailable' }), undefined);
});

test('wrapper correlation needs one nearby root, independent of input order', () => {
  for (const events of [[wrapper, event()], [event(), wrapper]]) {
    assert.deepEqual(correlate(events).map(row => row.incident.key), [group.incident.key, group.incident.key]);
  }
  assert.equal(correlate([wrapper, event(), event('other')])[0].incident, undefined);
  assert.equal(correlate([{ ...wrapper, ts: '2026-10-26T07:00:00Z' }, event()])[0].incident, undefined);
  assert.equal(correlate([{ ...wrapper, message: 'Other failure' }, event()])[0].incident, undefined);
});

test('only one nearby open MCP failure is adopted; a distinct root blocks guesses', () => {
  assert.equal(taskIncident(feedback).route, '/api/mcp/projects');
  assert.deepEqual(relatedTicket(group, [feedback]), { ticket: 'HTPR-8017', deleted: false, prior: ts });
  for (const change of [{ status: 'Archive' }, { status: 'Deleted' }, { section: 'Done' }, { isDone: true }, { description: feedback.description.replace(ts, '2026-10-25T08:55:00Z') }, { description: feedback.description.replace('500', '403') }, { description: feedback.description.replace('hypertask_projects', 'hypertask_tasks') }]) {
    assert.equal(relatedTicket(group, [{ ...feedback, ...change }]), undefined);
  }
  assert.equal(relatedTicket(group, [feedback, { ...feedback, id: 8018, ticketNumber: 'HTPR-8018' }]), undefined);
  const other = { ...feedback, id: 2, description: `<p>Routes: /api/mcp/projects</p><p>First seen: ${ts}</p><p>${event('other').message}</p>` };
  assert.equal(relatedTicket(group, [feedback, other]), undefined);
});

test('route display redaction never makes distinct endpoints share identity', () => {
  const first = incidentOf(event('updatedAt', '/api/integrations/posthog/error-alert'));
  const second = incidentOf(event('updatedAt', '/api/integrations/slack/installations'));
  assert.notEqual(first.key, second.key);
  assert.equal(first.route, '/api/integrations/posthog/error-alert');
  assert.equal(second.route, '/api/integrations/slack/installations');
  const hidden = incidentOf(event('updatedAt', '/api/person%40example.invalid/sk-abcdefghijklmnopqrstuv'));
  assert.doesNotMatch(JSON.stringify(hidden), /person|%40example|sk-abcdefghijkl/);
  assert.notEqual(incidentOf(event('updatedAt', '/api/' + 'a'.repeat(40))).key, incidentOf(event('updatedAt', '/api/' + 'b'.repeat(40))).key);
});
