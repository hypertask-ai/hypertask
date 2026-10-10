const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./task-route-loader.cjs');

const key = 'htpr-6924-rest-compat';
const operations = {
  create: ['create', 'POST', { task_id: 50, parent_page_id: 61, title: 'New', content: '<p>new</p>' }],
  list: ['list', 'GET'],
  search: ['search', 'GET'],
  get: ['[publicId]', 'GET'],
  patch: ['[publicId]', 'PATCH', { title: 'New', content: '<p>new</p>', if_version: 3, note: 'Note' }],
  archive: ['[publicId]/archive', 'POST'],
  versions: ['[publicId]/versions', 'GET'],
  restore: ['[publicId]/restore', 'POST', { version_id: 91 }],
};
const page = {
  publicId: 'opaque-001/slug', id: 60, title: 'Page', contentHtml: '<p>original</p>',
  version: 3, taskId: 50, subPages: [], parentPageId: null, updatedAt: '2026-10-01T00:00:00.000Z',
};
const headers = [['content-type', 'application/json']];
const modes = ['ON', 'OFF', 'FLAG_FAILURE', 'USER_FAILURE', 'NO_SESSION'];

async function run(operation, mode = 'OFF', options = {}) {
  const calls = [];
  const probes = [];
  const lookups = [];
  const [suffix, method, defaultBody] = operations[operation];
  const userId = options.userId ?? 985;
  const profileId = options.profileId ?? userId;
  const record = (name, value) => calls.push([name, value]);
  class PageConflictError extends Error {
    currentVersion = 4;
    currentContent = { html: '<p>fresh</p>' };
  }
  const service = {
    PageConflictError,
    createPage: async (args) => { record('create', args); return page; },
    listPages: async (args) => { record('list', args); return [page]; },
    searchPages: async (args) => { record('search', args); return [{ ...page, contentText: 'x'.repeat(220) }]; },
    getPage: async (args) => { record('get', args); return options.missing ? null : page; },
    updatePage: async (args) => {
      record('update', args);
      if (options.conflict) throw new PageConflictError();
      return { ...page, version: 4 };
    },
    archivePage: async (args) => { record('archive', args); },
    listPageVersions: async (args) => {
      record('versions', args);
      return [{ id: 91, version: 2, note: null, authorId: userId, agentId: null, createdAt: page.updatedAt, contentHtml: 'private' }];
    },
    restorePageVersion: async (args) => {
      record('restore', args);
      if (options.versionMissing) throw new Error('Version not found');
      return { ...page, version: 4 };
    },
  };
  const mocks = {
    'next/headers': { cookies: async () => ({ get: () => options.noProfile ? undefined : { value: 'profile' } }) },
    '@/utils/edgeHelpers': { isValidUser: (value) => ({ isValid: Boolean(value) && !options.invalidProfile, user: value && !options.invalidProfile ? { id: profileId, displayName: 'Actor' } : null }) },
    '@/lib/auth/getSessionUser': { getSessionUser: async (requestHeaders) => {
      probes.push(['user', requestHeaders]);
      if (mode === 'USER_FAILURE') throw new Error('user lookup failed');
      return mode === 'NO_SESSION' ? null : { userId };
    } },
    '@/lib/flags': { HTPR_6924_REST_COMPAT_FLAG: key, isFeatureEnabled: async (...args) => {
      probes.push(['flag', ...args]);
      if (mode === 'FLAG_FAILURE') throw new Error('flag lookup failed');
      return mode === 'ON';
    } },
    '@/lib/prisma': { default: {
      task: { findFirst: async (args) => { record('task', args); return options.missing ? null : { id: 50 }; } },
      project: { findMany: async (args) => { record('projects', args); return [{ id: 15 }]; } },
      page: { update: async (args) => { record('title', args); return page; } },
      user: { findUnique: async (args) => { lookups.push(args); return options.noUserRow ? null : { id: args.where.id, displayName: 'Actor', email: 'actor@fixture.invalid', UserSetting: null, userPicture: null }; } },
    } },
    '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: (...args) => {
      record('scope', args); return { OR: [{ ownerId: args[0] }, { members: { some: { userId: args[0], agentId: null } } }] };
    } },
    '@/utils/controllers/pages/pageService': service,
    ...options.mocks,
  };
  const route = load(`src/app/api/pages/${suffix}/route.ts`, mocks);
  const url = new URL(`https://fixture.invalid/api/pages/${suffix}?task_id=50&q=hello&compat=htpr-6924&userId=6`);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value === null) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
  }
  const request = {
    headers: new Headers({ cookie: 'fixture', 'x-user-id': '6', 'x-feature-flag': key }),
    nextUrl: url,
    json: async () => {
      record('json', null);
      if (Object.hasOwn(options, 'raw')) return JSON.parse(options.raw);
      return Object.hasOwn(options, 'body') ? options.body : defaultBody;
    },
  };
  const response = await route[method](request, { params: Promise.resolve({ publicId: options.publicId ?? page.publicId }) });
  return { status: response.status, text: await response.text(), headers: [...response.headers], calls, probes, lookups, requestHeaders: request.headers };
}

function contract(result) {
  return JSON.parse(JSON.stringify({ status: result.status, text: result.text, headers: result.headers, calls: result.calls }));
}
function error(result, status, message) {
  assert.deepEqual({ status: result.status, text: result.text, headers: result.headers }, {
    status, text: JSON.stringify({ error: message }), headers,
  });
}

// Frozen synthetic contracts captured from fdb5e4e4c84d906dc061b51811b5a80179aa5192 before editing routes.
const baseline = {
  "create": {
    "status": 200,
    "text": "{\"page\":{\"publicId\":\"opaque-001/slug\",\"id\":60,\"title\":\"Page\",\"version\":3}}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "json",
        null
      ],
      [
        "scope",
        [
          985,
          null
        ]
      ],
      [
        "task",
        {
          "where": {
            "id": 50,
            "project": {
              "status": "Normal",
              "OR": [
                {
                  "ownerId": 985
                },
                {
                  "members": {
                    "some": {
                      "userId": 985,
                      "agentId": null
                    }
                  }
                }
              ]
            }
          },
          "select": {
            "id": true
          }
        }
      ],
      [
        "create",
        {
          "taskId": 50,
          "title": "New",
          "content": "<p>new</p>",
          "contentType": "html",
          "parentPageId": 61,
          "userId": 985,
          "agentId": null
        }
      ]
    ]
  },
  "list": {
    "status": 200,
    "text": "{\"pages\":[{\"publicId\":\"opaque-001/slug\",\"id\":60,\"title\":\"Page\",\"parentPageId\":null,\"updatedAt\":\"2026-10-01T00:00:00.000Z\"}]}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "scope",
        [
          985,
          null
        ]
      ],
      [
        "task",
        {
          "where": {
            "id": 50,
            "project": {
              "status": "Normal",
              "OR": [
                {
                  "ownerId": 985
                },
                {
                  "members": {
                    "some": {
                      "userId": 985,
                      "agentId": null
                    }
                  }
                }
              ]
            }
          },
          "select": {
            "id": true
          }
        }
      ],
      [
        "list",
        {
          "taskId": 50
        }
      ]
    ]
  },
  "search": {
    "status": 200,
    "text": "{\"pages\":[{\"publicId\":\"opaque-001/slug\",\"id\":60,\"title\":\"Page\",\"taskId\":50,\"snippet\":\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\",\"updatedAt\":\"2026-10-01T00:00:00.000Z\"}]}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "scope",
        [
          985,
          null
        ]
      ],
      [
        "projects",
        {
          "where": {
            "status": "Normal",
            "OR": [
              {
                "ownerId": 985
              },
              {
                "members": {
                  "some": {
                    "userId": 985,
                    "agentId": null
                  }
                }
              }
            ]
          },
          "select": {
            "id": true
          }
        }
      ],
      [
        "search",
        {
          "query": "hello",
          "projectIds": [
            15
          ]
        }
      ]
    ]
  },
  "get": {
    "status": 200,
    "text": "{\"page\":{\"publicId\":\"opaque-001/slug\",\"id\":60,\"title\":\"Page\",\"contentHtml\":\"<p>original</p>\",\"version\":3,\"taskId\":50,\"subPages\":[],\"updatedAt\":\"2026-10-01T00:00:00.000Z\"}}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "get",
        {
          "publicId": "opaque-001/slug",
          "userId": 985
        }
      ]
    ]
  },
  "patch": {
    "status": 200,
    "text": "{\"page\":{\"publicId\":\"opaque-001/slug\",\"id\":60,\"version\":4}}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "json",
        null
      ],
      [
        "get",
        {
          "publicId": "opaque-001/slug",
          "userId": 985
        }
      ],
      [
        "title",
        {
          "where": {
            "id": 60
          },
          "data": {
            "title": "New"
          },
          "select": {
            "publicId": true,
            "id": true,
            "version": true
          }
        }
      ],
      [
        "update",
        {
          "id": 60,
          "content": "<p>new</p>",
          "contentType": "html",
          "mode": "replace",
          "ifVersion": 3,
          "note": "Note",
          "userId": 985,
          "agentId": null
        }
      ]
    ]
  },
  "archive": {
    "status": 200,
    "text": "{\"ok\":true}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "get",
        {
          "publicId": "opaque-001/slug",
          "userId": 985
        }
      ],
      [
        "archive",
        {
          "id": 60,
          "userId": 985,
          "agentId": null
        }
      ]
    ]
  },
  "versions": {
    "status": 200,
    "text": "{\"versions\":[{\"id\":91,\"version\":2,\"note\":null,\"authorId\":985,\"agentId\":null,\"createdAt\":\"2026-10-01T00:00:00.000Z\"}]}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "get",
        {
          "publicId": "opaque-001/slug",
          "userId": 985
        }
      ],
      [
        "versions",
        {
          "pageId": 60
        }
      ]
    ]
  },
  "restore": {
    "status": 200,
    "text": "{\"page\":{\"publicId\":\"opaque-001/slug\",\"id\":60,\"version\":4}}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "json",
        null
      ],
      [
        "get",
        {
          "publicId": "opaque-001/slug",
          "userId": 985
        }
      ],
      [
        "restore",
        {
          "pageId": 60,
          "versionId": 91,
          "userId": 985,
          "agentId": null
        }
      ]
    ]
  }
};

if (require.main === module) {
  for (const operation of Object.keys(operations)) {
    test(`${operation}: ON/OFF/failure success bytes, scoped inputs, actor and ordering match production`, async () => {
      for (const mode of modes) {
        const result = await run(operation, mode);
        assert.deepEqual(contract(result), baseline[operation]);
        assert.equal(result.probes.filter(([kind]) => kind === 'user').length, 1);
        const expectedFlag = ['ON', 'OFF', 'FLAG_FAILURE'].includes(mode);
        assert.deepEqual(result.probes.filter(([kind]) => kind === 'flag'), expectedFlag ? [['flag', key, 985]] : []);
        assert.equal(result.probes[0][1], result.requestHeaders);
      }
    });
    // HTPR-7073: the signed session alone identifies the user when the REST compat flag is on.
    test(`${operation}: flag OFF keeps 401 for missing/invalid profiles before parsing and side effects`, async () => {
      for (const options of [{ noProfile: true }, { invalidProfile: true }]) {
        const result = await run(operation, 'OFF', { ...options, raw: '{' });
        error(result, 401, 'Unauthorized');
        assert.deepEqual(result.calls, []);
        assert.deepEqual(result.lookups, []);
        assert.equal(result.probes.filter(([kind]) => kind === 'flag').length, 1);
      }
    });
    test(`${operation}: flag ON loads the profile of the signed session user when the profile is missing, invalid or mismatched`, async () => {
      for (const options of [{ noProfile: true }, { invalidProfile: true }, { profileId: 7 }]) {
        const result = await run(operation, 'ON', options);
        assert.deepEqual(contract(result), baseline[operation]);
        assert.deepEqual(result.lookups, [{ where: { id: 985 }, include: { UserSetting: true, userPicture: true } }]);
      }
    });
    test(`${operation}: no session or no user row keeps 401; mismatched profiles stay legacy without the flag`, async () => {
      for (const options of [{ noProfile: true }, { invalidProfile: true }]) {
        const noSession = await run(operation, 'NO_SESSION', { ...options, raw: '{' });
        error(noSession, 401, 'Unauthorized');
        assert.deepEqual(noSession.lookups, []);
        const noRow = await run(operation, 'ON', { ...options, noUserRow: true, raw: '{' });
        error(noRow, 401, 'Unauthorized');
        assert.deepEqual(noRow.calls, []);
      }
      for (const mode of ['OFF', 'NO_SESSION']) {
        const result = await run(operation, mode, { profileId: 7 });
        const legacy = await run(operation, 'OFF', { profileId: 7 });
        assert.deepEqual(contract(result), contract(legacy));
        assert.deepEqual(result.lookups, []);
      }
    });
  }
  for (const operation of ['create', 'list', 'get', 'patch', 'archive', 'versions', 'restore']) {
    test(`${operation}: missing/inaccessible resources keep 404 in ON and OFF`, async () => {
      for (const mode of ['ON', 'OFF']) {
        const result = await run(operation, mode, { missing: true });
        error(result, 404, ['create', 'list'].includes(operation) ? 'Task not found' : 'Page not found');
        assert.ok(!result.calls.some(([name]) => ['create', 'title', 'update', 'archive', 'versions', 'restore', 'list'].includes(name)));
      }
    });
  }
  test('PATCH conflict and restore missing version keep exact response bytes and ordering', async () => {
    for (const mode of ['ON', 'OFF']) {
      const conflict = await run('patch', mode, { conflict: true });
      assert.equal(conflict.status, 409);
      assert.equal(conflict.text, '{"error":"version_conflict","current_version":4,"current_html":"<p>fresh</p>"}');
      assert.deepEqual(conflict.headers, headers);
      assert.deepEqual(conflict.calls.map(([name]) => name), ['json', 'get', 'title', 'update']);
      error(await run('restore', mode, { versionMissing: true }), 404, 'Version not found');
    }
  });
}
module.exports = { run, contract, error, operations, modes, key, baseline };
