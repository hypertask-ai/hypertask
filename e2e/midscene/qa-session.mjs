import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const QA_USER_ID = 2343;
export const APP_ORIGIN = 'https://app.hypertask.ai';
export const QA_BOARD_TITLE = 'QA Sandbox';

export async function api(page, route, method = 'GET', body, { retryNetworkErrors = false, confirmAbsent } = {}) {
  if (new URL(page.url()).origin !== APP_ORIGIN || !route.startsWith('/api/')) {
    throw new Error('QA API requests must stay on the production app origin');
  }
  // Omit query strings and bodies: upload grants and auth responses can contain secrets.
  const request = `${method} ${APP_ORIGIN}${route.split('?')[0]}`;
  const attempts = retryNetworkErrors ? 3 : 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response;
    try {
      response = await page.evaluate(async ({ route, method, body }) => {
        let res;
        try {
          res = await fetch(route, {
            method,
            headers: { 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        } catch (err) {
          // Chromium's fetch rejection is distinct from evaluation/application errors.
          if (err instanceof TypeError && err.message === 'Failed to fetch') {
            return { networkError: err.message };
          }
          throw err;
        }
        return { status: res.status, body: await res.json().catch(() => null) };
      }, { route, method, body });
    } catch (err) {
      console.warn(`${request} failed: status unavailable (evaluation error)`);
      throw err;
    }
    if (response.networkError) {
      const message = `${request} failed: status unavailable (${response.networkError}), attempt ${attempt}/${attempts}`;
      console.warn(message);
      // A lost response may follow a successful delete; do not delete again or mask HTTP errors.
      if (retryNetworkErrors && confirmAbsent && await confirmAbsent()) return;
      if (attempt === attempts) throw new Error(message);
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      const message = `${request} failed: HTTP ${response.status}`;
      console.warn(message);
      throw new Error(message);
    }
    return response.body;
  }
}

export function assertQaBoard(identity, project, members) {
  if (identity !== QA_USER_ID) throw new Error('Storage state is not the plain QA account (2343)');
  if (project.title !== QA_BOARD_TITLE || members.owner?.id !== QA_USER_ID ||
      !Array.isArray(members.members) || members.members.some((m) => m.user?.id !== QA_USER_ID)) {
    throw new Error('Refusing mutations outside the QA account\'s private QA Sandbox board');
  }
}

export async function signIn(page) {
  const statePath = process.env.MIDSCENE_STORAGE_STATE || path.join(homedir(), '.config/hypertask-videos/storageState-qa-normal.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  // Never import Google cookies, MCP tokens, or persisted account-switcher state.
  const cookies = state.cookies.filter((c) =>
    ['app.hypertask.ai', '.hypertask.ai'].includes(c.domain) && c.name !== 'mcp_token');
  await page.setCookie(...cookies);
  // A static same-origin page lets us validate identity before the app can create chat sessions.
  await page.goto(`${APP_ORIGIN}/favicon.ico`, { waitUntil: 'load', timeout: 60_000 });
  const bootstrap = await api(page, '/api/app-shell/bootstrap', 'POST');
  if (bootstrap.accountId !== QA_USER_ID) throw new Error('Storage state is not the plain QA account (2343)');
  // The bootstrap's teams slice may time out. Use the app's normal fallback.
  const teams = bootstrap.slices?.teams?.ok
    ? bootstrap.slices.teams.data
    : await api(page, '/api/teams/getAll', 'POST');
  const project = teams.flatMap((t) => t.projects || []).find((p) => p.title === QA_BOARD_TITLE);
  if (!project) throw new Error('QA Sandbox board is missing from the plain QA account');
  const members = await api(page, `/api/members/getAllForAssignees?projectId=${project.id}`);
  assertQaBoard(bootstrap.accountId, project, members);
  return project;
}

export async function prepareQa(page, flow) {
  const project = await signIn(page);
  const runId = randomUUID().slice(0, 8);
  const title = `QA ${flow.id.replace('signed-in-', '')} ${runId}`;
  const fixture = { project, title, tasks: [], uploads: [], pending: [], sessions: [], sessionId: null };
  fixture.values = {
    boardUrl: `${APP_ORIGIN}/project?id=${project.id}`,
    taskTitle: title,
    fileName: `qa-${runId}.txt`,
  };
  return fixture;
}

export async function createFixtureTask(page, fixture) {
  const body = await api(page, '/api/tasks/create', 'POST', {
    title: fixture.title, projectId: fixture.project.id, userId: QA_USER_ID, fullScreenTask: true,
  });
  const task = body.newTask?.newTask ?? body.newTask ?? body;
  if (!task?.id || !task.uniqueIndex) throw new Error('Fixture create returned no task id/ticket number');
  fixture.tasks.push(task.id);
  fixture.values.taskUrl = `${APP_ORIGIN}/detail/project-${fixture.project.id}/${task.uniqueIndex}`;
}

export async function findCreatedTask(page, fixture) {
  const board = await api(page, '/api/projects/boardTasks', 'POST', { projectId: fixture.project.id });
  const matches = board.tasks.filter((t) => t.title === fixture.title);
  for (const task of matches) if (!fixture.tasks.includes(task.id)) fixture.tasks.push(task.id);
  return matches;
}

export async function cleanupQa(page, fixture) {
  const pending = await Promise.allSettled(fixture.pending);
  const errors = pending.filter((r) => r.status === 'rejected').map(() => 'Could not capture upload cleanup grant');
  const members = await api(page, `/api/members/getAllForAssignees?projectId=${fixture.project.id}`);
  assertQaBoard(QA_USER_ID, fixture.project, members);
  // Exact run-unique title recovers creates whose HTTP response was lost.
  const matches = await findCreatedTask(page, fixture);
  if (fixture.tasks.some((id) => !matches.some((task) => task.id === id))) {
    throw new Error('Refusing cleanup of a task not matching this run on the private QA board');
  }
  for (const id of fixture.tasks) {
    try {
      await api(page, '/api/queues/tasks/taskDeleteReminder', 'POST', { taskId: id }, { retryNetworkErrors: true });
    } catch (err) { errors.push(err.message); }
    try {
      await api(page, `/api/tasks/deleteTask?taskId=${id}`, 'DELETE', undefined, {
        retryNetworkErrors: true,
        // The board excludes soft-deleted tasks, so query the owned id directly.
        confirmAbsent: async () => await api(page, '/api/tasks/getTaskMinimal', 'POST', { id }) === null,
      });
    } catch (err) { errors.push(err.message); }
  }
  // Permanent task deletion clears attachment rows but not storage objects.
  for (const upload of fixture.uploads) {
    try {
      await api(page, '/api/tasks/uploadFinalize', 'POST', { grant: upload.grant, discard: upload.keys }, { retryNetworkErrors: true });
      for (const url of upload.urls || []) {
        const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        if (response.status !== 404) throw new Error(`QA storage cleanup could not be confirmed: HTTP ${response.status}`);
      }
    } catch (err) { errors.push(err.message); }
  }
  for (const id of new Set([...(fixture.sessions || []), fixture.sessionId].filter(Boolean))) {
    try {
      await api(page, `/api/ai-chat/delete-session?delete=${encodeURIComponent(id)}`, 'DELETE', undefined, {
        retryNetworkErrors: true,
        confirmAbsent: async () => !(await api(page, '/api/ai-chat/all-sessions')).sessions.some((session) => session.id === id),
      });
    } catch (err) { errors.push(err.message); }
  }
  if (fixture.filePath) await unlink(fixture.filePath).catch((err) => errors.push(err.message));
  if ((await findCreatedTask(page, fixture)).length) errors.push('QA fixture task still exists');
  const reminders = await api(page, '/api/reminders/getAll');
  if (reminders.some((r) => fixture.tasks.includes(r.taskId))) errors.push('QA fixture reminder still exists');
  if (errors.length) throw new Error(`QA cleanup failed: ${errors.join('; ')}`);
}

export async function cleanupQaAfterFlow(page, fixture, stopObserving) {
  const errors = [];
  let cleanupPage = page;
  try {
    await page.goto(`${APP_ORIGIN}/favicon.ico`, { waitUntil: 'load', timeout: 30_000 });
  } catch (err) {
    errors.push(err.message);
    // Closing React prevents deletion of a chat from creating its replacement.
    const context = page.browserContext();
    await page.close().catch((closeError) => errors.push(closeError.message));
    try {
      cleanupPage = await context.newPage();
      await cleanupPage.goto(`${APP_ORIGIN}/favicon.ico`, { waitUntil: 'load', timeout: 30_000 });
    } catch (retryError) { errors.push(retryError.message); }
  }
  stopObserving?.();
  await cleanupQa(cleanupPage, fixture).catch((err) => errors.push(err.message));
  if (cleanupPage !== page) await cleanupPage.close().catch((err) => errors.push(err.message));
  if (errors.length) throw new Error(errors.join('; '));
}

export function observeFixtures(page, fixture) {
  const listener = (response) => {
    const route = new URL(response.url()).pathname;
    if (!['/api/tasks/uploadUrl', '/api/ai-chat/create-session'].includes(route) || !response.ok()) return;
    const pending = response.json().then((body) => {
      if (body.grant && body.uploads?.length) {
        fixture.uploads.push({ grant: body.grant, keys: body.uploads.map((u) => u.key), urls: body.uploads.map((u) => u.fileUrl) });
      }
      if (route === '/api/ai-chat/create-session' && body.session?.id) {
        const request = JSON.parse(response.request().postData() || '{}');
        // Agent create-session is an upsert, not necessarily a new session we own.
        if (!request.agentId) fixture.sessions.push(body.session.id);
      }
    });
    // Handle rejection now, but retain it so cleanup still fails closed.
    pending.catch(() => {});
    fixture.pending.push(pending);
  };
  page.on('response', listener);
  return () => page.off('response', listener);
}

export async function uploadFixture(page, fixture, selector) {
  // The buffered fallback has no discard grant and would leave an unremovable QA object.
  const session = await page.createCDPSession();
  await session.send('Network.enable');
  await session.send('Network.setBlockedURLs', { urls: [`${APP_ORIGIN}/api/tasks/n8nUpload*`] });
  await mkdir('midscene_run/fixtures', { recursive: true });
  fixture.filePath = path.resolve('midscene_run/fixtures', fixture.values.fileName);
  await writeFile(fixture.filePath, `Nightly QA upload: ${fixture.title}\n`);
  await page.waitForSelector(selector, { timeout: 30_000 });
  const input = await page.$(selector);
  await input.uploadFile(fixture.filePath);
}

export function resolveStep(step, values) {
  return Object.fromEntries(Object.entries(step).map(([key, value]) => [key,
    typeof value === 'string' ? value.replace(/\{\{(\w+)\}\}/g, (_match, name) => {
      if (!values[name]) throw new Error(`Missing QA fixture value: ${name}`);
      return values[name];
    }) : value,
  ]));
}
