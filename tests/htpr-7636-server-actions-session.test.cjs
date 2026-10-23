const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./task-route-loader.cjs');

const userId = 985;
const uploadProps = {
  AI_Custom_Instructions_id: 7,
  S3URL: 'https://example.invalid/attachment',
  type: 'text/plain',
  name: 'instruction.txt',
  fileSize: 12,
};
const userActions = [
  ['getTeamInviteUrl', [userId, 'team']],
  ['updateUserSettingOnboarding', [userId, false]],
  ['updateUserSettingTutorial', [userId, false]],
  ['updateUserSettingTrial', [userId, false]],
  ['checkIfUserIsNew', [userId]],
];
const actions = [
  ...userActions,
  ['getTeamById', ['team']],
  ['taskWriterFetch', ['Draft a task']],
  ['uploadAttachmentToAICustomInstruction', [uploadProps]],
];

function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some((condition) => matches(row, condition));
    if (key === 'some') return row.some((item) => matches(item, value));
    if (key === 'is') return row != null && matches(row, value);
    if (value !== null && typeof value === 'object') return row[key] != null && matches(row[key], value);
    return row[key] === value;
  });
}

function fixture(options = {}) {
  const calls = [], sessionHeaders = [];
  const requestHeaders = new Headers({ cookie: 'session=fixture' });
  const team = {
    id: 'team',
    googleAccount: { userId: options.ownerId ?? userId },
    members: options.members ?? [],
    team_activity: { id: 'activity' },
  };
  const project = {
    id: 42,
    teamId: 'team',
    status: 'Normal',
    ownerId: options.projectOwnerId ?? userId,
    members: options.projectMembers ?? [],
  };
  const record = (name, run) => async (args) => {
    calls.push([name, args]);
    return run(args);
  };
  const db = {
    team: {
      findUnique: record('team.findUnique', ({ where }) => where.id === team.id ? team : null),
      findFirst: record('team.findFirst', ({ where }) => matches(team, where) ? team : null),
      count: record('team.count', () => options.teamsOwned ?? 0),
    },
    project: { findFirst: record('project.findFirst', ({ where }) => matches(project, where) ? project : null) },
    userSetting: { update: record('userSetting.update', ({ where, data }) => ({ ...where, ...data })) },
    member_Team: { count: record('member_Team.count', () => options.memberships ?? 0) },
    attachment: { create: record('attachment.create', ({ data }) => ({ id: 9, ...data })) },
    aI_Custom_Instructions: {
      findFirst: record('instruction.findFirst', ({ where }) =>
        where.id === 7 && matches(project, where.project) ? { id: 7 } : null),
    },
  };
  const mocks = {
    '../prisma': { default: db },
    '@/lib/prisma': { default: db },
    '@/lib/auth/getSessionUser': { getSessionUser: async (headers) => {
      sessionHeaders.push(headers);
      return Object.hasOwn(options, 'session') ? options.session : { userId };
    } },
    'next/headers': {
      headers: async () => requestHeaders,
      cookies: async () => {
        calls.push(['cookies']);
        return { toString: () => 'session=fixture' };
      },
    },
    '@/lib/constants/APIRouteConstants': { taskWriterRoute: '/api/ai/task-writer' },
    '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: (viewerId) => ({ ownerId: viewerId }) },
    '@/utils/api/invite/generatePublicInviteController': {
      getInviteFromProjectId: async (...args) => {
        calls.push(['invite', ...args]);
        return 'https://example.invalid/invite';
      },
    },
  };
  return {
    actions: load('src/lib/serverActions/index.ts', mocks),
    plainUpload: load('src/lib/serverActions/uploadAttachmentToAICustomInstruction.ts', mocks).uploadAttachmentToAICustomInstruction,
    calls, sessionHeaders, requestHeaders, team, project,
  };
}

test('session coverage includes every exported server action', () => {
  const f = fixture();
  assert.deepEqual(Object.keys(f.actions).sort(), actions.map(([name]) => name).sort());
});

for (const [name, args] of userActions) {
  test(`now refused: ${name} with an account that is not the session account`, async () => {
    const f = fixture({ session: { userId: 986 } });
    await assert.rejects(f.actions[name](...args), { name: 'Error', message: 'Forbidden' });
    assert.deepEqual(f.calls, []);
    assert.equal(f.sessionHeaders.length, 1);
  });

  test(`${name} binds an omitted account argument to the session account`, async () => {
    const matching = fixture(), omitted = fixture();
    const expected = await matching.actions[name](...args);
    const result = await omitted.actions[name](undefined, ...args.slice(1));
    assert.deepEqual(result, expected);
    assert.deepEqual(omitted.calls, matching.calls);
    assert.equal(omitted.sessionHeaders.length, 1);
  });
}

for (const [label, session] of [['signed-out', null], ['agent', { userId, agentId: 'agent-1' }]]) {
  for (const [name, args] of actions) {
    test(`${name} requires a signed-in human session (${label})`, async (t) => {
      const f = fixture({ session });
      t.mock.method(globalThis, 'fetch', async () => {
        f.calls.push(['fetch']);
        return new Response('result');
      });
      await assert.rejects(f.actions[name](...args), { name: 'Error', message: 'Forbidden' });
      assert.deepEqual(f.calls, []);
      assert.equal(f.sessionHeaders.length, 1);
    });
  }
}

test('the invite action uses the matching session account and board', async () => {
  const f = fixture();
  assert.deepEqual(await f.actions.getTeamInviteUrl(userId, 'team'), {
    inviteURL: 'https://example.invalid/invite', projectFirst: f.project,
  });
  assert.deepEqual(f.calls.map(([name]) => name), ['team.findUnique', 'project.findFirst', 'invite']);
  assert.deepEqual(f.calls[1][1], {
    where: {
      status: 'Normal', teamId: 'team',
      OR: [{ ownerId: userId }, { members: { some: { userId, agentId: null } } }],
    },
    orderBy: { createdAt: 'asc' },
  });
  assert.deepEqual(f.calls[2], ['invite', f.project.id, userId]);
  assert.ok(f.sessionHeaders[0] instanceof Headers);
  assert.notEqual(f.sessionHeaders[0], f.requestHeaders);
  assert.equal(f.sessionHeaders[0].get('cookie'), 'session=fixture');
});

test('an authorized human board member can still obtain its invite', async () => {
  const f = fixture({ projectOwnerId: 986, projectMembers: [{ userId, agentId: null }] });
  assert.equal((await f.actions.getTeamInviteUrl(userId, 'team')).inviteURL, 'https://example.invalid/invite');
});

test('invite action retains Error for missing team or authorized board', async () => {
  for (const teamId of [undefined, 'missing']) {
    const f = fixture();
    assert.equal(await f.actions.getTeamInviteUrl(userId, teamId), 'Error');
    assert.equal(f.calls.some(([name]) => name === 'invite'), false);
  }
  for (const projectMembers of [[], [{ userId, agentId: 'agent-1' }]]) {
    const f = fixture({ projectOwnerId: 986, projectMembers });
    assert.equal(await f.actions.getTeamInviteUrl(userId, 'team'), 'Error');
    assert.equal(f.calls.some(([name]) => name === 'invite'), false);
  }
});

for (const [name, expected] of [
  ['updateUserSettingOnboarding', (state) => ({ onboardingTourStatus: state, onboardingTutorialStatus: true })],
  ['updateUserSettingTutorial', (state) => ({ onboardingTutorialStatus: state, onboardingTourStatus: state })],
  ['updateUserSettingTrial', (state) => ({ trialStatus: state })],
]) {
  test(`${name} preserves updates for the signed-in account`, async () => {
    for (const state of [true, false]) {
      const f = fixture();
      assert.deepEqual(await f.actions[name](userId, state), { userId, ...expected(state) });
      assert.deepEqual(f.calls, [['userSetting.update', { where: { userId }, data: expected(state) }]]);
    }
  });
}

test('new-user checks retain owned-team and membership behavior for the session account', async () => {
  for (const [teamsOwned, memberships, expected] of [[0, 0, true], [1, 0, false], [0, 1, false]]) {
    const f = fixture({ teamsOwned, memberships });
    assert.equal(await f.actions.checkIfUserIsNew(userId), expected);
    assert.deepEqual(f.calls, [
      ['team.count', { where: { googleAccount: { userId } } }],
      ['member_Team.count', { where: { userId } }],
    ]);
  }
});

for (const [label, options] of [
  ['owner', {}],
  ['accepted member', { ownerId: 986, members: [{ userId, status: 'Accepted' }] }],
]) {
  test(`team reads allow the signed-in ${label}`, async () => {
    const f = fixture(options);
    assert.deepEqual(await f.actions.getTeamById('team'), f.team);
    assert.deepEqual(f.calls, [['team.findFirst', {
      where: {
        id: 'team',
        OR: [
          { googleAccount: { is: { userId } } },
          { members: { some: { userId, status: 'Accepted' } } },
        ],
      },
      include: { team_activity: true },
    }]]);
  });
}

for (const [label, members] of [
  ['no membership', []],
  ['pending membership', [{ userId, status: 'Pending' }]],
  ['different account membership', [{ userId: 986, status: 'Accepted' }]],
]) {
  test(`team reads require accepted membership for the session account (${label})`, async () => {
    const f = fixture({ ownerId: 986, members });
    assert.equal(await f.actions.getTeamById('team'), null);
    assert.equal(f.calls.length, 1);
  });
}

test('team reads retain null for a missing team', async () => {
  const f = fixture();
  assert.equal(await f.actions.getTeamById('missing'), null);
});

test('still allowed: attachment creation on the caller\'s own board preserves the upload result', async () => {
  const f = fixture();
  const data = {
    fileType: 'text/plain', fileSource: uploadProps.S3URL, fileName: 'instruction.txt',
    fileSize: '12', AI_Custom_Instructions_id: 7,
  };
  assert.deepEqual(await f.actions.uploadAttachmentToAICustomInstruction(uploadProps), {
    status: 200, data: { id: 9, ...data }, text: 'success',
  });
  assert.deepEqual(f.calls.map(([name]) => name), ['instruction.findFirst', 'attachment.create']);
  assert.deepEqual(f.calls[1], ['attachment.create', { data }]);
  assert.equal(f.sessionHeaders.length, 1);
});

test('attachment creation is refused for an instruction on a board the caller cannot open', async () => {
  const f = fixture({ projectOwnerId: 986 });
  await assert.rejects(f.actions.uploadAttachmentToAICustomInstruction(uploadProps), { name: 'Error', message: 'Forbidden' });
  assert.deepEqual(f.calls.map(([name]) => name), ['instruction.findFirst']);
});

test('the plain attachment implementation remains independent of request sessions', async () => {
  const f = fixture({ session: null });
  const result = await f.plainUpload(uploadProps);
  assert.equal(result.status, 200);
  assert.equal(result.data.AI_Custom_Instructions_id, 7);
  assert.deepEqual(f.sessionHeaders, []);
  assert.equal(f.calls[0][0], 'attachment.create');
});

test('task writer retains the authenticated request and response', async (t) => {
  const f = fixture();
  const response = new Response('result');
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (...args) => {
    requests.push(args);
    return response;
  });
  assert.equal(await f.actions.taskWriterFetch('Draft a task'), response);
  assert.equal(f.sessionHeaders.length, 1);
  assert.deepEqual(f.calls, [['cookies']]);
  assert.equal(requests.length, 1);
  const [url, request] = requests[0];
  assert.ok(url.endsWith('/api/ai/task-writer'));
  assert.equal(request.method, 'POST');
  assert.equal(request.headers.Cookie, 'session=fixture');
  assert.equal(request.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(request.body), {
    projectId: 15,
    teamId: '08f79efd-770e-4e32-9728-65e6d29ec893',
    PROMPT: 'Draft a task',
  });
});
