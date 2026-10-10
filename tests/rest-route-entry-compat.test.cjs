const assert = require('node:assert/strict');
const test = require('node:test');
const { NextRequest } = require('next/server');
const { load } = require('./task-route-loader.cjs');

const key = 'htpr-6924-rest-compat';
const now = '2026-10-06T08:00:00.000Z';
const agentId = '00000000-0000-4000-8000-000000000001';
const session = { id: 'session-1', userId: 985, title: 'Chat', taskId: 50, messages: [], agentId: null };
const field = { id: 'field-1', projectId: 15, name: 'Field', type: 'Text', ranking: 'A', options: null };
const operations = {
  taskSessions: ['ai-chat/task-sessions', 'GET'],
  updateSession: ['ai-chat/update-session', 'POST', { sessionId: session.id, title: 'Renamed' }],
  addMessage: ['ai-chat/add-message', 'POST', { sessionId: session.id, message: { role: 'assistant', content: 'Hello', attachments: [{ fileName: 'a.txt', url: 'data:text/plain;base64,SGVsbG8=' }] } }],
  deleteSession: ['ai-chat/delete-session', 'DELETE'],
  calendarAccess: ['calendar/access', 'GET'],
  calendarRead: ['calendar/read-model', 'GET'],
  connections: ['connections/list', 'GET'],
  revoke: ['connections/revoke', 'POST', { client_id: 'client-1', agent_id: agentId }],
  revokeAll: ['connections/revoke-all', 'POST'],
  fields: ['customFields', 'GET'],
  createField: ['customFields', 'POST', { projectId: 15, name: 'Field', type: 'Text' }],
  patchField: ['customFields', 'PATCH', { fieldId: field.id, name: 'Renamed', showInRail: false }],
  deleteField: ['customFields', 'DELETE'],
  reorder: ['customFields/reorder', 'POST', { projectId: 15, orderedFieldIds: [field.id] }],
  fieldValue: ['customFields/value', 'POST', { fieldId: field.id, taskId: 50, value: 'Value' }],
  cliCode: ['cli/generate-code', 'POST'],
  velocity: ['reports/velocity', 'GET'],
  getPreferences: ['users/preferences', 'GET'],
  preferences: ['users/preferences', 'POST', { playGifs: false }],
  patchPreferences: ['users/preferences', 'PATCH', { playGifs: false }],
  bindAgent: ['oauth/authorization-code/agent', 'POST', { code: 'pending', agentId }],
  createSession: ['ai-chat/create-session', 'POST', { taskId: 50 }],
  allSessions: ['ai-chat/all-sessions', 'GET'],
};
const preferenceOperations = ['getPreferences', 'preferences', 'patchPreferences'];
const profileOperations = Object.keys(operations).filter((op) => !['createSession', 'allSessions'].includes(op));

async function run(operation, mode = 'OFF', options = {}) {
  const [suffix, method, defaultBody] = operations[operation];
  const calls = [], probes = [], limits = [], readers = [];
  const profileId = options.profileId ?? 985;
  const userId = options.userId ?? 985;
  const actor = { id: profileId, displayName: 'Actor', email: 'actor@fixture.invalid' };
  const record = (name, args, result) => { calls.push([name, args]); return result; };
  const fn = (name, result) => async (...args) => record(name, args, typeof result === 'function' ? result(...args) : result);
  const missing = options.denied;
  class CustomFieldValidationError extends Error {}
  const prisma = {
    chatSession: {
      findMany: fn('sessions', options.emptyHistory ? [] : [session]), findFirst: fn('session', missing ? null : session),
      update: fn('sessionUpdate', session), create: fn('sessionCreate', session), upsert: fn('sessionUpsert', session),
      delete: fn('sessionDelete', session), deleteMany: fn('sessionDeleteMany', { count: 2 }), count: fn('sessionCount', options.lastSession ? 0 : 1),
    },
    chatMessage: { create: fn('messageCreate', { id: 'message-1', content: 'Hello', attachments: [{ id: 'attachment-1' }] }) },
    attachment: { findMany: fn('attachments', [{ id: 'attachment-1', fileSource: 'own-file' }]), deleteMany: fn('attachmentDelete', { count: 1 }) },
    project: { findFirst: fn('project', missing ? null : { id: 15, staleWarnDays: 7, staleHotDays: 14, section: [], owner: actor, members: [] }) },
    task: { findUnique: fn('task', { projectId: 15 }), findMany: fn('tasks', []) },
    comment: { groupBy: fn('comments', []) },
    oAuthClient: { findUnique: fn('client', { client_id: 'client-1' }) },
    oAuthAuthorizationCode: {
      findUnique: fn('authCode', { code: 'pending', user_id: missing ? 7 : profileId, used: false, expires_at: new Date('2027-01-01') }),
      findMany: fn('authCodes', [{ client_id: 'client-1', createdAt: new Date(now), agent_id: agentId, agent: { displayName: 'Agent' }, client: { client_name: 'Client', owner_id: profileId, createdAt: new Date(now), enabled: true } }]),
      deleteMany: fn('authCodesDelete', { count: 2 }), update: fn('authCodeUpdate', {}),
    },
    oAuthClientGrant: { deleteMany: fn('grantDelete', { count: 1 }) },
    user: { update: fn('userUpdate', actor) }, revokedToken: { upsert: fn('tokenRevoke', {}) },
    userSetting: { update: fn('preferencesUpdate', { playGifs: false }), findUnique: fn('preferencesFind', null) },
    agent: { findFirst: fn('agent', { id: agentId, userId, displayName: 'Agent' }) },
    $transaction: fn('transaction', async (promises) => Promise.all(promises)),
  };
  const cookieValue = options.badCookie ? '{' : JSON.stringify(actor);
  const mocks = {
    'next/headers': { cookies: async () => ({ get: (name) => name === 'nookies_user' ? options.noProfile ? undefined : { value: cookieValue } : options.tokenCookie ? { value: 'token' } : undefined }) },
    '@/utils/edgeHelpers': { isValidUser: (value) => {
      try { return { isValid: Boolean(value) && !options.invalidProfile, user: options.invalidProfile ? null : value ? JSON.parse(value) : null }; }
      catch { return { isValid: false, user: null }; }
    } },
    '@/lib/auth/getSessionUser': { getSessionUser: async (headers) => {
      probes.push(['user', headers]);
      if (mode === 'USER_FAILURE') throw new Error('user lookup failed');
      return mode === 'NO_SESSION' ? null : { userId };
    } },
    '@/lib/flags': { HTPR_6924_REST_COMPAT_FLAG: key, SHARED_AGENT_CHAT_FLAG: 'shared-agent-chat', isFeatureEnabled: async (...args) => {
      if (args[0] === 'htpr-7038-reset-saved-model-choices') return false;
      probes.push(['flag', ...args]);
      if (mode === 'FLAG_FAILURE') throw new Error('flag lookup failed');
      return mode === 'ON';
    } },
    '@/lib/api/rateLimit': { checkRestRateLimit: async (...args) => { limits.push(args); return options.limited ? new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again shortly.' }), { status: 429, headers: { 'content-type': 'application/json', 'Retry-After': '17' } }) : null; } },
    '@/lib/prisma': { default: prisma },
    '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: (id) => record('scope', [id], { OR: [{ ownerId: id }, { members: { some: { userId: id, agentId: null } } }] }) },
    '@/utils/controllers/customFields': {
      CustomFieldValidationError,
      getCustomFieldsForProject: fn('fields', [field]), createCustomField: fn('fieldCreate', field),
      getCustomFieldById: fn('field', field), updateCustomField: fn('fieldUpdate', field),
      deleteCustomField: fn('fieldDelete', { deletedValues: 2 }), reorderCustomFields: fn('fieldReorder', [field]),
      getCustomFieldForProjectById: fn('projectField', field), upsertCustomFieldValue: fn('valueUpsert', { id: 'value-1', value: 'Value' }),
    },
    '@prisma/client': { CustomFieldType: { Text: 'Text' }, DisplayAvatar: {}, MentionPreference: {}, ScrollSetting: {} },
    '@/utils/controllers/tasks/calendarReadModel': {
      getCalendarAccessibleProjectIds: fn('calendarProjects', [15]),
      getCalendarReadModel: fn('calendarRead', { tasks: [], projects: [], authorizationRevision: '15' }),
    },
    '@/utils/controllers/users/fetch_preferences': { fetchUserPreferenceController: fn('preferencesGet', { res: { playGifs: true }, status: 200 }), invalidateUserPreferenceCache: fn('preferencesInvalidate', undefined) },
    '@/lib/aiModelPreferences': {}, '@/lib/aiModelOptions': {},
    '@/utils/helperFunctions/sanitizeRichHtml': {}, '@/lib/dictationProvider': {}, '@/lib/configs/allTasks.config': {}, '@/models/Calendar/model': {},
    '@/lib/storage/uploadTaskAttachmentToS3': {
      resolveOwnAiChatAttachmentKey: () => null, getHypertasksObjectSize: fn('objectSize', 5),
      uploadAiChatAttachmentToS3: fn('upload', 'own-file'), deleteTaskAttachmentFromS3: fn('storageDelete', undefined),
    },
    '@/utils/controllers/comments/linkifyTicketRefs': { linkifyTicketRefs: fn('linkify', 'Hello') },
    '@/lib/redis': { getRedis: async () => ({ set: fn('redisSet', 'OK') }) },
    crypto: { default: { randomBytes: () => Buffer.from('fixture-code') } },
    jsonwebtoken: { default: { decode: () => ({ jti: 'fixture-jti', exp: 1800000000 }) } },
    '@/lib/agents/visibility': { accessibleAgentWhere: () => ({ userId }) },
    '@/utils/controllers/agents/boardMembers': { getAgentTeamIds: async () => new Map() },
    '@/lib/agents/chatAccess': { ensureChatParticipant: fn('participant', undefined), loadUserAgentChatSession: async () => ({ ok: true }), userTeamIds: async () => [] },
    ...options.mocks,
  };
  const reader = load('src/lib/mcp/readJsonBody.ts', {});
  mocks['@/lib/mcp/readJsonBody'] ??= { readJsonBody: async (request, callbacks) => { readers.push(callbacks); return reader.readJsonBody(request, callbacks); } };
  const url = new URL(`https://fixture.invalid/api/${suffix}?taskId=50&projectId=15&fieldId=${field.id}&delete=${session.id}&range=week&rangeStart=2026-10-05&rangeEndExclusive=2026-10-12&start=2026-10-05T00:00:00.000Z&endExclusive=2026-10-12T00:00:00.000Z&timezone=UTC&compat=htpr-6924&userId=6`);
  for (const [name, value] of Object.entries(options.query ?? {})) value === null ? url.searchParams.delete(name) : url.searchParams.set(name, value);
  const raw = Object.hasOwn(options, 'raw') ? options.raw : JSON.stringify(defaultBody ?? {});
  const request = new NextRequest(url, { method, headers: { cookie: 'fixture', 'content-type': 'application/json', 'x-user-id': '6', 'x-feature-flag': key }, ...(['GET', 'DELETE'].includes(method) ? {} : { body: raw }) });
  let jsonReads = 0;
  const originalJson = request.json.bind(request);
  request.json = async () => { jsonReads++; return originalJson(); };
  const RealDate = global.Date;
  global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return new RealDate(now).getTime(); } };
  const originalError = console.error, originalLog = console.log;
  console.error = console.log = () => {};
  try {
    const route = load(`src/app/api/${suffix}/route.ts`, mocks);
    const response = await route[method](request);
    return { status: response.status, text: await response.text(), headers: [...response.headers], calls: JSON.parse(JSON.stringify(calls)), probes, limits, readers, jsonReads, requestHeaders: request.headers };
  } finally { global.Date = RealDate; console.error = originalError; console.log = originalLog; }
}
const contract = ({ status, text, headers, calls }) => ({ status, text, headers, calls });

// Frozen before PR 2 edits; no Git or runtime baseline rewrite in CI.
const baseline = {
  "taskSessions": {
    "status": 200,
    "text": "{\"success\":true,\"sessions\":[{\"id\":\"session-1\",\"userId\":985,\"title\":\"Chat\",\"taskId\":50,\"messages\":[],\"agentId\":null}]}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "sessions",
        [
          {
            "where": {
              "userId": 985,
              "taskId": 50,
              "messages": {
                "some": {}
              }
            },
            "select": {
              "id": true,
              "title": true,
              "updatedAt": true
            },
            "orderBy": {
              "updatedAt": "desc"
            },
            "take": 3
          }
        ]
      ]
    ]
  },
  "taskSessions:unauthorized": {
    "status": 401,
    "text": "{\"error\":\"Unauthorized\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": []
  },
  "updateSession": {
    "status": 200,
    "text": "{\"success\":true,\"session\":{\"id\":\"session-1\",\"userId\":985,\"title\":\"Chat\",\"taskId\":50,\"messages\":[],\"agentId\":null}}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "session",
        [
          {
            "where": {
              "id": "session-1",
              "userId": 985
            },
            "select": {
              "id": true
            }
          }
        ]
      ],
      [
        "sessionUpdate",
        [
          {
            "where": {
              "id": "session-1"
            },
            "data": {
              "title": "Renamed",
              "updatedAt": "2026-10-06T08:00:00.000Z"
            }
          }
        ]
      ]
    ]
  },
  "updateSession:unauthorized": {
    "status": 401,
    "text": "{\"error\":\"Unauthorized\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": []
  },
  "addMessage": {
    "status": 200,
    "text": "{\"message\":{\"id\":\"message-1\",\"content\":\"Hello\",\"attachments\":[{\"id\":\"attachment-1\"}]}}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "session",
        [
          {
            "where": {
              "id": "session-1",
              "userId": 985
            },
            "select": {
              "id": true,
              "agentId": true
            }
          }
        ]
      ],
      [
        "upload",
        [
          {
            "type": "Buffer",
            "data": [
              72,
              101,
              108,
              108,
              111
            ]
          },
          "a.txt",
          "text/plain",
          "session-1"
        ]
      ],
      [
        "linkify",
        [
          "Hello",
          985
        ]
      ],
      [
        "sessionUpdate",
        [
          {
            "where": {
              "id": "session-1"
            },
            "data": {
              "updatedAt": "2026-10-06T08:00:00.000Z"
            }
          }
        ]
      ],
      [
        "messageCreate",
        [
          {
            "data": {
              "sessionId": "session-1",
              "content": "Hello",
              "role": "assistant",
              "isDelivered": true,
              "authorUserId": null,
              "authorAgentId": null,
              "attachments": {
                "create": [
                  {
                    "fileType": "text/plain",
                    "fileSource": "own-file",
                    "fileName": "a.txt",
                    "fileSize": "5"
                  }
                ]
              }
            },
            "include": {
              "attachments": true
            }
          }
        ]
      ],
      [
        "transaction",
        [
          [
            {},
            {}
          ]
        ]
      ]
    ]
  },
  "addMessage:unauthorized": {
    "status": 401,
    "text": "{\"error\":\"Unauthorized\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": []
  },
  "deleteSession": {
    "status": 200,
    "text": "{\"message\":\"Session session-1 deleted successfully\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "attachments",
        [
          {
            "where": {
              "chatMessage": {
                "sessionId": {
                  "in": [
                    "session-1"
                  ]
                }
              }
            },
            "select": {
              "id": true,
              "fileSource": true
            }
          }
        ]
      ],
      [
        "storageDelete",
        [
          "own-file"
        ]
      ],
      [
        "attachmentDelete",
        [
          {
            "where": {
              "id": {
                "in": [
                  "attachment-1"
                ]
              }
            }
          }
        ]
      ],
      [
        "sessionDelete",
        [
          {
            "where": {
              "id": "session-1",
              "userId": 985
            }
          }
        ]
      ],
      [
        "sessionCount",
        [
          {
            "where": {
              "userId": 985
            }
          }
        ]
      ]
    ]
  },
  "deleteSession:unauthorized": {
    "status": 401,
    "text": "{\"error\":\"Unauthorized\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": []
  },
  "calendarAccess": {
    "status": 200,
    "text": "{\"success\":true,\"accountId\":985,\"projectIds\":[15],\"authorizationRevision\":\"15\"}",
    "headers": [
      [
        "cache-control",
        "private, no-store"
      ],
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "calendarProjects",
        [
          985
        ]
      ]
    ]
  },
  "calendarAccess:unauthorized": {
    "status": 401,
    "text": "{\"success\":false,\"error\":\"Unauthorized\"}",
    "headers": [
      [
        "cache-control",
        "private, no-store"
      ],
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": []
  },
  "calendarRead": {
    "status": 200,
    "text": "{\"success\":true,\"payload\":{\"rangeStart\":\"2026-10-05\",\"rangeEndExclusive\":\"2026-10-12\",\"startIso\":\"2026-10-05T00:00:00.000Z\",\"endExclusiveIso\":\"2026-10-12T00:00:00.000Z\",\"timezone\":\"UTC\",\"accountId\":985,\"authorizationRevision\":\"15\",\"retrievedAt\":\"2026-10-06T08:00:00.000Z\",\"tasks\":[],\"projects\":[]}}",
    "headers": [
      [
        "cache-control",
        "private, no-store"
      ],
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "calendarRead",
        [
          {
            "userId": 985,
            "start": "2026-10-05T00:00:00.000Z",
            "endExclusive": "2026-10-12T00:00:00.000Z"
          }
        ]
      ]
    ]
  },
  "calendarRead:unauthorized": {
    "status": 401,
    "text": "{\"success\":false,\"error\":\"Unauthorized\"}",
    "headers": [
      [
        "cache-control",
        "private, no-store"
      ],
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": []
  },
  "connections": {
    "status": 200,
    "text": "{\"success\":true,\"connections\":[{\"client_id\":\"client-1\",\"client_name\":\"Client\",\"createdAt\":\"2026-10-06T08:00:00.000Z\",\"lastAuthorized\":\"2026-10-06T08:00:00.000Z\",\"enabled\":true,\"is_owner\":true,\"connected_via_agent\":true,\"agent_display_name\":\"Agent\"}]}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "authCodes",
        [
          {
            "where": {
              "user_id": 985,
              "used": true
            },
            "include": {
              "client": true,
              "agent": {
                "select": {
                  "displayName": true
                }
              }
            },
            "orderBy": {
              "createdAt": "desc"
            }
          }
        ]
      ]
    ]
  },
  "connections:unauthorized": {
    "status": 401,
    "text": "{\"success\":false,\"error\":\"Unauthorized\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": []
  },
  "revoke": {
    "status": 200,
    "text": "{\"success\":true,\"message\":\"Connection revoked successfully\",\"tokenRevoked\":false}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "client",
        [
          {
            "where": {
              "client_id": "client-1"
            }
          }
        ]
      ],
      [
        "authCodesDelete",
        [
          {
            "where": {
              "user_id": 985,
              "client_id": "client-1",
              "agent_id": "00000000-0000-4000-8000-000000000001"
            }
          }
        ]
      ],
      [
        "grantDelete",
        [
          {
            "where": {
              "user_id": 985,
              "client_id": "client-1"
            }
          }
        ]
      ],
      [
        "userUpdate",
        [
          {
            "where": {
              "id": 985
            },
            "data": {
              "mcpTokensRevokedAt": "2026-10-06T08:00:00.000Z"
            }
          }
        ]
      ]
    ]
  },
  "revoke:unauthorized": {
    "status": 401,
    "text": "{\"success\":false,\"error\":\"Unauthorized\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": []
  },
  "revokeAll": {
    "status": 200,
    "text": "{\"success\":true,\"message\":\"Revoked 2 OAuth connection(s) successfully\",\"oauthCount\":2,\"tokenRevoked\":false}",
    "headers": [
      [
        "content-type",
        "application/json"
      ],
      [
        "set-cookie",
        "mcp_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
      ],
      [
        "x-middleware-set-cookie",
        "mcp_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
      ]
    ],
    "calls": [
      [
        "authCodesDelete",
        [
          {
            "where": {
              "user_id": 985
            }
          }
        ]
      ],
      [
        "grantDelete",
        [
          {
            "where": {
              "user_id": 985
            }
          }
        ]
      ],
      [
        "userUpdate",
        [
          {
            "where": {
              "id": 985
            },
            "data": {
              "mcpTokensRevokedAt": "2026-10-06T08:00:00.000Z"
            }
          }
        ]
      ]
    ]
  },
  "revokeAll:unauthorized": {
    "status": 401,
    "text": "{\"success\":false,\"error\":\"Unauthorized\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": []
  },
  "fields": {
    "status": 200,
    "text": "[{\"id\":\"field-1\",\"projectId\":15,\"name\":\"Field\",\"type\":\"Text\",\"ranking\":\"A\",\"options\":null}]",
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
          985
        ]
      ],
      [
        "project",
        [
          {
            "where": {
              "id": 15,
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
        ]
      ],
      [
        "fields",
        [
          15
        ]
      ]
    ]
  },
  "fields:unauthorized": {
    "status": 401,
    "text": "{\"error\":\"Unauthorized\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": []
  },
  "fields:denied": {
    "status": 403,
    "text": "{\"error\":\"Forbidden\"}",
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
          985
        ]
      ],
      [
        "project",
        [
          {
            "where": {
              "id": 15,
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
        ]
      ]
    ]
  },
  "createField": {
    "status": 201,
    "text": "{\"id\":\"field-1\",\"projectId\":15,\"name\":\"Field\",\"type\":\"Text\",\"ranking\":\"A\",\"options\":null}",
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
          985
        ]
      ],
      [
        "project",
        [
          {
            "where": {
              "id": 15,
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
        ]
      ],
      [
        "fieldCreate",
        [
          15,
          "Field",
          "Text",
          null
        ]
      ]
    ]
  },
  "createField:unauthorized": {
    "status": 401,
    "text": "{\"error\":\"Unauthorized\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": []
  },
  "createField:denied": {
    "status": 403,
    "text": "{\"error\":\"Forbidden\"}",
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
          985
        ]
      ],
      [
        "project",
        [
          {
            "where": {
              "id": 15,
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
        ]
      ]
    ]
  },
  "patchField": {
    "status": 200,
    "text": "{\"id\":\"field-1\",\"projectId\":15,\"name\":\"Field\",\"type\":\"Text\",\"ranking\":\"A\",\"options\":null}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "field",
        [
          "field-1"
        ]
      ],
      [
        "scope",
        [
          985
        ]
      ],
      [
        "project",
        [
          {
            "where": {
              "id": 15,
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
        ]
      ],
      [
        "fieldUpdate",
        [
          "field-1",
          {
            "name": "Renamed",
            "showInRail": false
          }
        ]
      ]
    ]
  },
  "patchField:unauthorized": {
    "status": 401,
    "text": "{\"error\":\"Unauthorized\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": []
  },
  "patchField:denied": {
    "status": 403,
    "text": "{\"error\":\"Forbidden\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "field",
        [
          "field-1"
        ]
      ],
      [
        "scope",
        [
          985
        ]
      ],
      [
        "project",
        [
          {
            "where": {
              "id": 15,
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
        ]
      ]
    ]
  },
  "deleteField": {
    "status": 200,
    "text": "{\"success\":true,\"deletedValues\":2}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "field",
        [
          "field-1"
        ]
      ],
      [
        "scope",
        [
          985
        ]
      ],
      [
        "project",
        [
          {
            "where": {
              "id": 15,
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
        ]
      ],
      [
        "fieldDelete",
        [
          "field-1"
        ]
      ]
    ]
  },
  "deleteField:unauthorized": {
    "status": 401,
    "text": "{\"error\":\"Unauthorized\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": []
  },
  "deleteField:denied": {
    "status": 403,
    "text": "{\"error\":\"Forbidden\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "field",
        [
          "field-1"
        ]
      ],
      [
        "scope",
        [
          985
        ]
      ],
      [
        "project",
        [
          {
            "where": {
              "id": 15,
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
        ]
      ]
    ]
  },
  "reorder": {
    "status": 200,
    "text": "[{\"id\":\"field-1\",\"projectId\":15,\"name\":\"Field\",\"type\":\"Text\",\"ranking\":\"A\",\"options\":null}]",
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
          985
        ]
      ],
      [
        "project",
        [
          {
            "where": {
              "id": 15,
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
        ]
      ],
      [
        "fieldReorder",
        [
          15,
          [
            "field-1"
          ]
        ]
      ]
    ]
  },
  "reorder:unauthorized": {
    "status": 401,
    "text": "{\"error\":\"Unauthorized\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": []
  },
  "reorder:denied": {
    "status": 403,
    "text": "{\"error\":\"Forbidden\"}",
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
          985
        ]
      ],
      [
        "project",
        [
          {
            "where": {
              "id": 15,
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
        ]
      ]
    ]
  },
  "fieldValue": {
    "status": 200,
    "text": "{\"id\":\"value-1\",\"value\":\"Value\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "task",
        [
          {
            "where": {
              "id": 50
            },
            "select": {
              "projectId": true
            }
          }
        ]
      ],
      [
        "scope",
        [
          985
        ]
      ],
      [
        "project",
        [
          {
            "where": {
              "id": 15,
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
        ]
      ],
      [
        "projectField",
        [
          15,
          "field-1"
        ]
      ],
      [
        "valueUpsert",
        [
          "field-1",
          50,
          "Value"
        ]
      ]
    ]
  },
  "fieldValue:unauthorized": {
    "status": 401,
    "text": "{\"error\":\"Unauthorized\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": []
  },
  "fieldValue:denied": {
    "status": 403,
    "text": "{\"error\":\"Forbidden\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "task",
        [
          {
            "where": {
              "id": 50
            },
            "select": {
              "projectId": true
            }
          }
        ]
      ],
      [
        "scope",
        [
          985
        ]
      ],
      [
        "project",
        [
          {
            "where": {
              "id": 15,
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
        ]
      ]
    ]
  },
  "cliCode": {
    "status": 200,
    "text": "{\"code\":\"666978747572652d636f6465\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "redisSet",
        [
          "cli_auth:666978747572652d636f6465",
          "{\"userId\":985,\"email\":\"actor@fixture.invalid\"}",
          "EX",
          120
        ]
      ]
    ]
  },
  "cliCode:unauthorized": {
    "status": 401,
    "text": "{\"error\":\"Unauthorized\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": []
  },
  "velocity": {
    "status": 200,
    "text": "{\"generatedAt\":\"2026-10-06T08:00:00.000Z\",\"range\":{\"key\":\"30d\",\"days\":30,\"label\":\"30 days\",\"periodLabel\":\"the last 30 days\"},\"granularity\":\"day\",\"buckets\":[{\"start\":\"2026-09-07T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-08T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-09T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-10T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-11T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-12T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-13T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-14T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-15T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-16T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-17T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-18T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-19T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-20T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-21T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-22T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-23T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-24T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-25T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-26T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-27T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-28T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-29T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-09-30T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-10-01T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-10-02T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-10-03T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-10-04T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-10-05T00:00:00.000Z\",\"created\":0,\"completed\":0},{\"start\":\"2026-10-06T00:00:00.000Z\",\"created\":0,\"completed\":0}],\"totals\":{\"created\":0,\"completed\":0,\"net\":0},\"speed\":{\"medianLeadTimeDays\":null,\"priorMedianLeadTimeDays\":null,\"completedInRange\":0,\"priorCompletedInRange\":0,\"completedPerDay\":0,\"oldestOpenDays\":null},\"now\":{\"openTotal\":0,\"staleTotal\":0,\"columns\":[]},\"people\":[{\"userId\":985,\"displayName\":\"Actor\",\"completed\":0,\"comments\":0,\"lastActiveAt\":null}]}",
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
          985
        ]
      ],
      [
        "project",
        [
          {
            "where": {
              "id": 15,
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
              "staleWarnDays": true,
              "staleHotDays": true,
              "section": {
                "where": {
                  "deleted": false
                },
                "select": {
                  "section_title": true,
                  "isDone": true
                }
              },
              "owner": {
                "select": {
                  "id": true,
                  "displayName": true,
                  "email": true
                }
              },
              "members": {
                "where": {
                  "agentId": null
                },
                "select": {
                  "user": {
                    "select": {
                      "id": true,
                      "displayName": true,
                      "email": true
                    }
                  }
                }
              }
            }
          }
        ]
      ],
      [
        "tasks",
        [
          {
            "where": {
              "projectId": 15,
              "deletedAt": null,
              "status": {
                "not": "Deleted"
              },
              "OR": [
                {
                  "status": "Normal"
                },
                {
                  "updatedAt": {
                    "gte": "2026-08-08T16:00:00.000Z"
                  }
                },
                {
                  "sectionChangedAt": {
                    "gte": "2026-08-08T16:00:00.000Z"
                  }
                }
              ]
            },
            "select": {
              "id": true,
              "createdAt": true,
              "updatedAt": true,
              "sectionChangedAt": true,
              "lastCommentAt": true,
              "section": true,
              "status": true,
              "assignees": {
                "select": {
                  "userId": true
                }
              }
            }
          }
        ]
      ],
      [
        "comments",
        [
          {
            "by": [
              "creatorId"
            ],
            "where": {
              "createdAt": {
                "gte": "2026-09-07T00:00:00.000Z",
                "lte": "2026-10-06T08:00:00.000Z"
              },
              "task": {
                "projectId": 15
              }
            },
            "_count": {
              "_all": true
            },
            "_max": {
              "createdAt": true
            }
          }
        ]
      ]
    ]
  },
  "velocity:unauthorized": {
    "status": 401,
    "text": "{\"error\":\"Unauthorized\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": []
  },
  "getPreferences": {
    "status": 200,
    "text": "{\"success\":true,\"settings\":{\"playGifs\":true}}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "preferencesGet",
        [
          985
        ]
      ]
    ]
  },
  "getPreferences:unauthorized": {
    "status": 401,
    "text": "{\"success\":false,\"error\":\"Unauthorized\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": []
  },
  "preferences": {
    "status": 200,
    "text": "{\"success\":true,\"settings\":{\"playGifs\":false}}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "preferencesUpdate",
        [
          {
            "where": {
              "userId": 985
            },
            "data": {
              "playGifs": false
            },
            "select": {
              "displayAvatar": true,
              "commentsStacked": true,
              "shareReadReceipts": true,
              "scrollSetting": true,
              "notification": true,
              "notificationPreference": true,
              "aiModelPreferences": true,
              "snippets": true,
              "muteAnnouncements": true,
              "playGifs": true,
              "autoDescriptionSuggestions": true,
              "dictationLanguage": true,
              "inboxAdvanceOnSend": true,
              "emojiFrequency": true,
              "calendarViews": true,
              "allTasksDateRange": true
            }
          }
        ]
      ],
      [
        "preferencesInvalidate",
        [
          985
        ]
      ]
    ]
  },
  "preferences:unauthorized": {
    "status": 401,
    "text": "{\"success\":false,\"error\":\"Unauthorized\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": []
  },
  "patchPreferences": {
    "status": 200,
    "text": "{\"success\":true,\"settings\":{\"playGifs\":false}}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "preferencesUpdate",
        [
          {
            "where": {
              "userId": 985
            },
            "data": {
              "playGifs": false
            },
            "select": {
              "displayAvatar": true,
              "commentsStacked": true,
              "shareReadReceipts": true,
              "scrollSetting": true,
              "notification": true,
              "notificationPreference": true,
              "aiModelPreferences": true,
              "snippets": true,
              "muteAnnouncements": true,
              "playGifs": true,
              "autoDescriptionSuggestions": true,
              "dictationLanguage": true,
              "inboxAdvanceOnSend": true,
              "emojiFrequency": true,
              "calendarViews": true,
              "allTasksDateRange": true
            }
          }
        ]
      ],
      [
        "preferencesInvalidate",
        [
          985
        ]
      ]
    ]
  },
  "patchPreferences:unauthorized": {
    "status": 401,
    "text": "{\"success\":false,\"error\":\"Unauthorized\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": []
  },
  "bindAgent": {
    "status": 200,
    "text": "{\"success\":true,\"agentId\":\"00000000-0000-4000-8000-000000000001\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "authCode",
        [
          {
            "where": {
              "code": "pending"
            }
          }
        ]
      ],
      [
        "agent",
        [
          {
            "where": {
              "id": "00000000-0000-4000-8000-000000000001",
              "userId": 985,
              "revokedAt": null
            },
            "select": {
              "id": true
            }
          }
        ]
      ],
      [
        "authCodeUpdate",
        [
          {
            "where": {
              "code": "pending"
            },
            "data": {
              "agent_id": "00000000-0000-4000-8000-000000000001"
            }
          }
        ]
      ]
    ]
  },
  "bindAgent:unauthorized": {
    "status": 401,
    "text": "{\"success\":false,\"error\":\"Unauthorized\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": []
  },
  "bindAgent:denied": {
    "status": 403,
    "text": "{\"success\":false,\"error\":\"Forbidden\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "authCode",
        [
          {
            "where": {
              "code": "pending"
            }
          }
        ]
      ]
    ]
  },
  "createSession": {
    "status": 200,
    "text": "{\"success\":true,\"session\":{\"id\":\"session-1\",\"userId\":985,\"title\":\"Chat\",\"taskId\":50,\"messages\":[],\"agentId\":null}}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "sessionCreate",
        [
          {
            "data": {
              "userId": 985,
              "taskId": 50
            },
            "include": {
              "messages": {
                "orderBy": {
                  "createdAt": "asc"
                }
              }
            }
          }
        ]
      ]
    ]
  },
  "createSession:unauthorized": {
    "status": 200,
    "text": "{\"success\":true,\"session\":{\"id\":\"session-1\",\"userId\":985,\"title\":\"Chat\",\"taskId\":50,\"messages\":[],\"agentId\":null}}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "sessionCreate",
        [
          {
            "data": {
              "userId": 985,
              "taskId": 50
            },
            "include": {
              "messages": {
                "orderBy": {
                  "createdAt": "asc"
                }
              }
            }
          }
        ]
      ]
    ]
  },
  "allSessions": {
    "status": 200,
    "text": "{\"success\":true,\"sessions\":[{\"id\":\"session-1\",\"userId\":985,\"title\":\"Chat\",\"taskId\":50,\"messages\":[],\"agentId\":null}]}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": [
      [
        "sessions",
        [
          {
            "relationLoadStrategy": "join",
            "where": {
              "userId": 985,
              "OR": [
                {
                  "agentId": null
                },
                {
                  "agent": {
                    "runtimeType": {
                      "not": "EXTERNAL"
                    }
                  }
                }
              ]
            },
            "include": {
              "messages": {
                "orderBy": {
                  "createdAt": "asc"
                },
                "include": {
                  "attachments": true,
                  "authorAgent": {
                    "select": {
                      "displayName": true
                    }
                  }
                }
              }
            },
            "orderBy": {
              "updatedAt": "desc"
            }
          }
        ]
      ]
    ]
  },
  "allSessions:unauthorized": {
    "status": 401,
    "text": "{\"error\":\"Unauthorized\"}",
    "headers": [
      [
        "content-type",
        "application/json"
      ]
    ],
    "calls": []
  }
};

if (require.main === module) {
  for (const operation of profileOperations) {
    test(`${operation}: ON/OFF and failed probes preserve frozen success bytes, scope, actors and side effects`, async () => {
      for (const mode of ['ON', 'OFF', 'FLAG_FAILURE', 'USER_FAILURE', 'NO_SESSION']) {
        const result = await run(operation, mode);
        assert.deepEqual(contract(result), baseline[operation]);
        assert.equal(result.probes.filter(([kind]) => kind === 'user').length, 1);
        assert.deepEqual(result.probes.filter(([kind]) => kind === 'flag'), ['ON', 'OFF', 'FLAG_FAILURE'].includes(mode) ? [['flag', key, 985]] : []);
        assert.equal(result.probes[0][1], result.requestHeaders);
      }
    });
    if (preferenceOperations.includes(operation)) continue;
    test(`${operation}: missing/invalid profile returns original 401 before JSON and writes`, async () => {
      for (const mode of ['ON', 'OFF']) for (const options of [{ noProfile: true }, { badCookie: true }]) {
        const result = await run(operation, mode, { ...options, raw: '{' });
        assert.deepEqual(contract(result), baseline[`${operation}:unauthorized`]);
        assert.equal(result.jsonReads, 0);
        assert.deepEqual(result.limits, []);
        assert.deepEqual(result.probes.filter(([kind]) => kind === 'flag'), []);
      }
    });
    test(`${operation}: unsigned/mismatched profile cannot enable new path; direct-handler legacy remains intact`, async () => {
      for (const mode of ['ON', 'OFF', 'NO_SESSION']) {
        const result = await run(operation, mode, { profileId: 7 });
        assert.deepEqual(contract(result), contract(await run(operation, 'OFF', { profileId: 7 })));
        assert.deepEqual(result.probes.filter(([kind]) => kind === 'flag'), []);
        assert.deepEqual(result.limits, []);
        assert.deepEqual(result.readers, []);
      }
    });
  }
  // HTPR-7068: preferences identify the user from the signed session alone when the REST compat flag is on.
  for (const operation of preferenceOperations) {
    test(`${operation}: flag ON acts as the signed session user when the profile cookie is missing, invalid or mismatched`, async () => {
      for (const options of [{ noProfile: true }, { badCookie: true }, { profileId: 7 }]) {
        const result = await run(operation, 'ON', { ...options, raw: JSON.stringify(operations[operation][2] ?? {}) });
        assert.deepEqual(contract(result), baseline[operation]);
        assert.deepEqual(result.probes.filter(([kind]) => kind === 'flag'), [['flag', key, 985]]);
        assert.ok(!result.calls.some(([, args]) => args.includes(7)), 'must never act as the cookie user 7');
      }
    });
    test(`${operation}: flag OFF keeps the legacy 401 for a missing or invalid profile and the legacy cookie user for a mismatched one`, async () => {
      for (const options of [{ noProfile: true }, { badCookie: true }]) {
        const result = await run(operation, 'OFF', { ...options, raw: '{' });
        assert.deepEqual(contract(result), baseline[`${operation}:unauthorized`]);
        assert.equal(result.jsonReads, 0);
        assert.deepEqual(result.limits, []);
        assert.deepEqual(result.probes.filter(([kind]) => kind === 'flag'), [['flag', key, 985]]);
      }
      const legacy = await run(operation, 'OFF', { profileId: 7 });
      assert.deepEqual(legacy.probes.filter(([kind]) => kind === 'flag'), [['flag', key, 985]]);
      assert.equal(legacy.status, 200);
      assert.ok(legacy.calls.some(([, args]) => args.includes(7)), 'flag OFF stays on the legacy cookie user');
      assert.deepEqual(legacy.readers, []);
    });
    test(`${operation}: without a session the legacy path is unchanged and no flag is probed`, async () => {
      for (const options of [{ noProfile: true }, { badCookie: true }]) {
        const result = await run(operation, 'NO_SESSION', { ...options, raw: '{' });
        assert.deepEqual(contract(result), baseline[`${operation}:unauthorized`]);
        assert.equal(result.jsonReads, 0);
        assert.deepEqual(result.probes.filter(([kind]) => kind === 'flag'), []);
      }
      const result = await run(operation, 'NO_SESSION', { profileId: 7 });
      assert.deepEqual(contract(result), contract(await run(operation, 'OFF', { profileId: 7 })));
      assert.deepEqual(result.probes.filter(([kind]) => kind === 'flag'), []);
      assert.deepEqual(result.limits, []);
      assert.deepEqual(result.readers, []);
    });
  }
  for (const operation of ['fields', 'createField', 'patchField', 'deleteField', 'reorder', 'fieldValue', 'bindAgent']) {
    test(`${operation}: inaccessible scope keeps original 403 without business writes`, async () => {
      for (const mode of ['ON', 'OFF']) {
        const result = await run(operation, mode, { denied: true });
        assert.deepEqual(contract(result), baseline[`${operation}:denied`]);
        assert.equal(result.status, 403);
        assert.ok(!result.calls.some(([name]) => /Create|Update|Delete|Upsert|Reorder|upload/.test(name)));
      }
    });
  }
}
if (require.main === module) {
  test('all remaining profile methods retain signed account-switch precedence and reuse the resolved actor', async () => {
    const saved = process.env.BETTER_AUTH_ENABLED;
    process.env.BETTER_AUTH_ENABLED = '1';
    try {
      for (const operation of profileOperations) {
        let sessionReads = 0;
        const { getSessionUser } = load('src/lib/auth/getSessionUser.ts', {
          '@/lib/auth/session': { SESSION_COOKIE: 'ht_session', verifySession: () => ({ id: 985 }) },
          '@/lib/auth/betterAuth': { auth: { api: { getSession: async () => { sessionReads++; return { user: { id: '6' } }; } } } },
        });
        const result = await run(operation, 'ON', { mocks: { '@/lib/auth/getSessionUser': { getSessionUser } } });
        assert.deepEqual(contract(result), baseline[operation]);
        assert.deepEqual(result.probes, [['flag', key, 985]]);
        assert.equal(sessionReads, process.env.AUTH_LEGACY_FAST_PATH === '1' ? 0 : 1);
      }
    } finally {
      if (saved === undefined) delete process.env.BETTER_AUTH_ENABLED;
      else process.env.BETTER_AUTH_ENABLED = saved;
    }
  });
  test('real proxy rejects forged/mismatched profiles for every remaining human entry URL in both modes', async () => {
    const identity = load('src/lib/auth/cookieIdentity.ts', {
      '@/lib/auth/sessionEdge': { verifySessionEdge: async (token) => token === 'signed-985' ? { id: 985 } : null },
    });
    const { default: proxy } = load('src/proxy.ts', {
      './utils/edgeHelpers': { isValidUser: () => ({ isValid: false, user: null }) },
      './utils/serverActions': {}, './utils/helperFunctions/helperFunctions': {},
      '@/lib/auth/cookieIdentity': identity, '@/lib/auth/sessionEdge': {},
    });
    for (const mode of ['ON', 'OFF']) for (const operation of profileOperations) {
      const [suffix, method] = operations[operation];
      for (const cookie of ['nookies_user={"id":985}', 'nookies_user={"id":6}; ht_session=signed-985', 'nookies_user=broken; ht_session=signed-985']) {
        const response = await proxy(new NextRequest(`https://fixture.invalid/api/${suffix}?compat=htpr-6924&userId=6`, { method, headers: { cookie, 'x-feature-flag': mode } }));
        assert.equal(response.status, 401);
        assert.equal(await response.text(), '{"error":"Unauthorized","code":"SESSION_REQUIRED"}');
        assert.deepEqual([...response.headers], [['content-type', 'application/json']]);
      }
    }
  });
  test('remaining routes obey real Owner + QA/OFF/Everyone audience decisions, ignoring forged request opt-in', async () => {
    for (const mode of [null, 'OFF', 'EVERYONE']) for (const id of [6, 985, 7]) {
      const flags = load('src/lib/flags.ts', {
        '@/lib/prisma': { default: { user: { findUnique: async () => ({ email: id === 6 ? 'valentin.yeo@gmail.com' : id === 985 ? 'valentin@hypertask.ai' : 'ordinary@fixture.invalid' }) }, featureFlag: { findUnique: async () => mode === null ? null : { mode } } } },
        '@/lib/auth/getSessionUser': {},
        '@/lib/agentRuns/model': { AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG: 'htpr-6154-chat-stop-and-timeout' },
      });
      for (const operation of profileOperations) {
        const result = await run(operation, 'ON', { userId: id, profileId: id, mocks: { '@/lib/flags': flags } });
        assert.deepEqual(contract(result), contract(await run(operation, 'OFF', { userId: id, profileId: id })));
        const enabled = mode === 'EVERYONE' || (mode === null && id !== 7);
        if (['taskSessions', 'updateSession', 'addMessage', 'deleteSession'].includes(operation)) assert.equal(result.limits.length, enabled ? 1 : 0);
        if (['preferences', 'patchPreferences', 'bindAgent', 'updateSession', 'addMessage', 'revoke', 'createField', 'patchField', 'reorder', 'fieldValue'].includes(operation)) assert.equal(result.readers.length, enabled ? 1 : 0);
      }
    }
  });
}
if (require.main === module) {
  test('frozen route oracle rejects response field ordering and status drift (positive mutation controls)', async () => {
    const { NextResponse } = require('next/server');
    for (const json of [
      (body, init) => NextResponse.json({ sessions: body.sessions, success: body.success }, init),
      (body, init) => NextResponse.json(body, { ...init, status: 201 }),
    ]) {
      const mutated = await run('taskSessions', 'OFF', { mocks: { 'next/server': { NextResponse: { json } } } });
      assert.throws(() => assert.deepEqual(contract(mutated), baseline.taskSessions));
    }
  });
}
module.exports = { run, contract, baseline, operations, profileOperations, key };
