import { createHash } from 'node:crypto';

export function plain(text) {
  return String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(?:x27|0?39);/gi, "'").replace(/&amp;/g, '&');
}

export function incidentOf({ message = '', stack = '', route = '' }) {
  const text = `${message}\n${stack}`;
  const model = /prisma\.(\w+)\.\w+\(/i.exec(text)?.[1]?.toLowerCase();
  const field = /Unknown argument [`'"]([\w.]+)[`'"]/i.exec(text)?.[1];
  let path;
  try { path = new URL(route, 'https://app.hypertask.ai').pathname; } catch { return; }
  if ((!path || path === '/' || path === '/mcp') && /(?:list(?:ing)? projects|hypertask_projects)/i.test(text)) path = '/api/mcp/projects';
  if (!path || path === '/' || path === '/mcp') return;
  const root = model && field && /PrismaClientValidationError/.test(text) ? `prisma-validation:${model}:unknown-argument:${field}` : undefined;
  const wrapper = /^(?:Failed to list projects\s*\|\s*Internal server error|HTTP 500 hypertask_projects)$/.test(message.trim());
  if (!root && !wrapper) return;
  return { route: path, root, ...(root ? { key: createHash('sha256').update(`${path}|${root}`).digest('hex').slice(0, 16) } : {}), wrapper };
}

export function taskIncident(task) {
  const text = plain(task.description);
  const routes = /Routes:\s*([^\n]*?)(?=\s+(?:Count in window|First seen):)/.exec(text)?.[1]?.split(',').map(value => value.trim()) ?? [];
  const route = routes.find(value => value.startsWith('/api/')) ?? routes[0] ?? '';
  const feedback = /Tool:\s*hypertask_projects\b/.test(text) && /HTTP status:\s*500\b/.test(text);
  const message = feedback ? 'HTTP 500 hypertask_projects' : /Sample message:\s*Failed to list projects\s*\|\s*Internal server error/.test(text) ? 'Failed to list projects | Internal server error' : text;
  const stored = /Error root:\s*(\/[^\s|]+)\s*\|\s*(prisma-validation:[\w]+:unknown-argument:[\w.]+)/.exec(text);
  const incident = stored ? { route: stored[1], root: stored[2], wrapper: false } : incidentOf({ message, route });
  if (!incident) return;
  const ts = /(?:First seen|Last seen):\s*(\d{4}-\d\d-\d\dT[\d:.]+Z)/.exec(text)?.[1];
  return { ...incident, ts, feedback };
}

export function correlate(events, known = []) {
  const roots = [...events.map(event => ({ ...incidentOf(event), ts: event.ts })), ...known].filter(item => item.root);
  return events.map(event => {
    let incident = incidentOf(event);
    if (incident?.wrapper) {
      const matches = roots.filter(root => root.route === incident.route && Math.abs(Date.parse(root.ts) - Date.parse(event.ts)) <= 10 * 60_000);
      const keys = new Set(matches.map(root => root.key));
      if (keys.size === 1) incident = matches[0];
    }
    return incident?.root ? { ...event, incident } : event;
  });
}

export function relatedTicket(group, tasks) {
  const candidates = tasks.filter(task => task.status === 'Normal' && task.isDone !== true && !/^Done$/i.test(task.section ?? '')).map(task => ({ task, incident: taskIncident(task) })).filter(item => item.incident?.route === group.incident.route);
  if (!group.incident.root) {
    const roots = candidates.filter(item => item.incident.root && Math.abs(Date.parse(item.incident.ts) - Date.parse(group.firstSeen)) <= 10 * 60_000);
    if (new Set(roots.map(item => item.incident.root)).size !== 1) return;
    roots.sort((a, b) => Number(a.task.id) - Number(b.task.id));
    return { ticket: roots[0].task.ticketNumber, deleted: false };
  }
  const exact = candidates.filter(item => item.incident.root === group.incident.root).sort((a, b) => Number(a.task.id) - Number(b.task.id));
  if (exact.length) return { ticket: exact[0].task.ticketNumber, deleted: false };
  const nearby = candidates.filter(item => Math.abs(Date.parse(item.incident.ts) - Date.parse(group.firstSeen)) <= 10 * 60_000);
  if (nearby.some(item => item.incident.root && item.incident.root !== group.incident.root)) return;
  const wrappers = nearby.filter(item => item.incident.wrapper);
  if (wrappers.length === 1) return { ticket: wrappers[0].task.ticketNumber, deleted: false, prior: wrappers[0].incident.feedback ? wrappers[0].incident.ts : undefined };
}
