const assert = require('node:assert/strict');
const test = require('node:test');
const { run, contract } = require('./rest-route-entry-compat.test.cjs');
const preferenceOperations = new Set(['preferences', 'patchPreferences']);
const operations = ['preferences', 'patchPreferences', 'bindAgent', 'createSession', 'updateSession', 'addMessage', 'revoke', 'createField', 'patchField', 'reorder', 'fieldValue'];
const inputs = ['', '{', 'null', 'true', 'false', '1', '"text"', '[]', '[{}]', '{}'];
// Frozen pre-PR-2 handler results, including legacy errors and create-session fallback.
const baseline = {
  "preferences": {
    "1": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"Invalid preferences\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"Invalid JSON\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "{": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"Invalid JSON\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "null": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"Invalid preferences\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "true": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"Invalid preferences\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "false": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"Invalid preferences\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "\"text\"": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"Invalid preferences\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "[]": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"Invalid preferences\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "[{}]": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"Invalid preferences\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "{}": {
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
              "data": {},
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
    }
  },
  "patchPreferences": {
    "1": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"Invalid preferences\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"Invalid JSON\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "{": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"Invalid JSON\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "null": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"Invalid preferences\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "true": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"Invalid preferences\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "false": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"Invalid preferences\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "\"text\"": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"Invalid preferences\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "[]": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"Invalid preferences\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "[{}]": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"Invalid preferences\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "{}": {
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
              "data": {},
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
    }
  },
  "bindAgent": {
    "1": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"code is required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "": {
      "status": 500,
      "text": "{\"success\":false,\"error\":\"Internal server error\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "{": {
      "status": 500,
      "text": "{\"success\":false,\"error\":\"Internal server error\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "null": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"code is required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "true": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"code is required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "false": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"code is required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "\"text\"": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"code is required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "[]": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"code is required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "[{}]": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"code is required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "{}": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"code is required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    }
  },
  "createSession": {
    "1": {
      "status": 400,
      "text": "{\"error\":\"Invalid task ID\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "": {
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
                "userId": 985
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
    "{": {
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
                "userId": 985
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
    "null": {
      "status": 400,
      "text": "{\"error\":\"Invalid task ID\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "true": {
      "status": 400,
      "text": "{\"error\":\"Invalid task ID\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "false": {
      "status": 400,
      "text": "{\"error\":\"Invalid task ID\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "\"text\"": {
      "status": 400,
      "text": "{\"error\":\"Invalid task ID\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "[]": {
      "status": 400,
      "text": "{\"error\":\"Invalid task ID\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "[{}]": {
      "status": 400,
      "text": "{\"error\":\"Invalid task ID\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "{}": {
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
                "userId": 985
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
    }
  },
  "updateSession": {
    "1": {
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
              "where": {},
              "data": {
                "updatedAt": "2026-10-06T08:00:00.000Z"
              }
            }
          ]
        ]
      ]
    },
    "": {
      "status": 500,
      "text": "{\"success\":false,\"error\":\"Unexpected end of JSON input\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "{": {
      "status": 500,
      "text": "{\"success\":false,\"error\":\"Expected property name or '}' in JSON at position 1 (line 1 column 2)\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "null": {
      "status": 500,
      "text": "{\"success\":false,\"error\":\"Cannot destructure property 'sessionId' of 'body' as it is null.\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "true": {
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
              "where": {},
              "data": {
                "updatedAt": "2026-10-06T08:00:00.000Z"
              }
            }
          ]
        ]
      ]
    },
    "false": {
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
              "where": {},
              "data": {
                "updatedAt": "2026-10-06T08:00:00.000Z"
              }
            }
          ]
        ]
      ]
    },
    "\"text\"": {
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
              "where": {},
              "data": {
                "updatedAt": "2026-10-06T08:00:00.000Z"
              }
            }
          ]
        ]
      ]
    },
    "[]": {
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
              "where": {},
              "data": {
                "updatedAt": "2026-10-06T08:00:00.000Z"
              }
            }
          ]
        ]
      ]
    },
    "[{}]": {
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
              "where": {},
              "data": {
                "updatedAt": "2026-10-06T08:00:00.000Z"
              }
            }
          ]
        ]
      ]
    },
    "{}": {
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
              "where": {},
              "data": {
                "updatedAt": "2026-10-06T08:00:00.000Z"
              }
            }
          ]
        ]
      ]
    }
  },
  "addMessage": {
    "1": {
      "status": 500,
      "text": "{\"success\":false,\"error\":\"Cannot read properties of undefined (reading 'role')\"}",
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
                "userId": 985
              },
              "select": {
                "id": true,
                "agentId": true
              }
            }
          ]
        ]
      ]
    },
    "": {
      "status": 500,
      "text": "{\"success\":false,\"error\":\"Unexpected end of JSON input\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "{": {
      "status": 500,
      "text": "{\"success\":false,\"error\":\"Expected property name or '}' in JSON at position 1 (line 1 column 2)\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "null": {
      "status": 500,
      "text": "{\"success\":false,\"error\":\"Cannot destructure property 'sessionId' of 'body' as it is null.\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "true": {
      "status": 500,
      "text": "{\"success\":false,\"error\":\"Cannot read properties of undefined (reading 'role')\"}",
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
                "userId": 985
              },
              "select": {
                "id": true,
                "agentId": true
              }
            }
          ]
        ]
      ]
    },
    "false": {
      "status": 500,
      "text": "{\"success\":false,\"error\":\"Cannot read properties of undefined (reading 'role')\"}",
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
                "userId": 985
              },
              "select": {
                "id": true,
                "agentId": true
              }
            }
          ]
        ]
      ]
    },
    "\"text\"": {
      "status": 500,
      "text": "{\"success\":false,\"error\":\"Cannot read properties of undefined (reading 'role')\"}",
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
                "userId": 985
              },
              "select": {
                "id": true,
                "agentId": true
              }
            }
          ]
        ]
      ]
    },
    "[]": {
      "status": 500,
      "text": "{\"success\":false,\"error\":\"Cannot read properties of undefined (reading 'role')\"}",
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
                "userId": 985
              },
              "select": {
                "id": true,
                "agentId": true
              }
            }
          ]
        ]
      ]
    },
    "[{}]": {
      "status": 500,
      "text": "{\"success\":false,\"error\":\"Cannot read properties of undefined (reading 'role')\"}",
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
                "userId": 985
              },
              "select": {
                "id": true,
                "agentId": true
              }
            }
          ]
        ]
      ]
    },
    "{}": {
      "status": 500,
      "text": "{\"success\":false,\"error\":\"Cannot read properties of undefined (reading 'role')\"}",
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
                "userId": 985
              },
              "select": {
                "id": true,
                "agentId": true
              }
            }
          ]
        ]
      ]
    }
  },
  "revoke": {
    "1": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"client_id is required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "": {
      "status": 500,
      "text": "{\"success\":false,\"error\":\"Internal server error\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "{": {
      "status": 500,
      "text": "{\"success\":false,\"error\":\"Internal server error\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "null": {
      "status": 500,
      "text": "{\"success\":false,\"error\":\"Internal server error\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "true": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"client_id is required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "false": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"client_id is required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "\"text\"": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"client_id is required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "[]": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"client_id is required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "[{}]": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"client_id is required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "{}": {
      "status": 400,
      "text": "{\"success\":false,\"error\":\"client_id is required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    }
  },
  "createField": {
    "1": {
      "status": 400,
      "text": "{\"error\":\"projectId, name, and type are required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "": {
      "status": 500,
      "text": "{\"error\":\"Internal server error\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "{": {
      "status": 500,
      "text": "{\"error\":\"Internal server error\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "null": {
      "status": 500,
      "text": "{\"error\":\"Internal server error\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "true": {
      "status": 400,
      "text": "{\"error\":\"projectId, name, and type are required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "false": {
      "status": 400,
      "text": "{\"error\":\"projectId, name, and type are required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "\"text\"": {
      "status": 400,
      "text": "{\"error\":\"projectId, name, and type are required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "[]": {
      "status": 400,
      "text": "{\"error\":\"projectId, name, and type are required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "[{}]": {
      "status": 400,
      "text": "{\"error\":\"projectId, name, and type are required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "{}": {
      "status": 400,
      "text": "{\"error\":\"projectId, name, and type are required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    }
  },
  "patchField": {
    "1": {
      "status": 400,
      "text": "{\"error\":\"fieldId required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "": {
      "status": 500,
      "text": "{\"error\":\"Internal server error\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "{": {
      "status": 500,
      "text": "{\"error\":\"Internal server error\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "null": {
      "status": 500,
      "text": "{\"error\":\"Internal server error\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "true": {
      "status": 400,
      "text": "{\"error\":\"fieldId required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "false": {
      "status": 400,
      "text": "{\"error\":\"fieldId required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "\"text\"": {
      "status": 400,
      "text": "{\"error\":\"fieldId required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "[]": {
      "status": 400,
      "text": "{\"error\":\"fieldId required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "[{}]": {
      "status": 400,
      "text": "{\"error\":\"fieldId required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "{}": {
      "status": 400,
      "text": "{\"error\":\"fieldId required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    }
  },
  "reorder": {
    "1": {
      "status": 400,
      "text": "{\"error\":\"projectId and orderedFieldIds are required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "": {
      "status": 500,
      "text": "{\"error\":\"Internal server error\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "{": {
      "status": 500,
      "text": "{\"error\":\"Internal server error\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "null": {
      "status": 500,
      "text": "{\"error\":\"Internal server error\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "true": {
      "status": 400,
      "text": "{\"error\":\"projectId and orderedFieldIds are required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "false": {
      "status": 400,
      "text": "{\"error\":\"projectId and orderedFieldIds are required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "\"text\"": {
      "status": 400,
      "text": "{\"error\":\"projectId and orderedFieldIds are required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "[]": {
      "status": 400,
      "text": "{\"error\":\"projectId and orderedFieldIds are required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "[{}]": {
      "status": 400,
      "text": "{\"error\":\"projectId and orderedFieldIds are required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "{}": {
      "status": 400,
      "text": "{\"error\":\"projectId and orderedFieldIds are required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    }
  },
  "fieldValue": {
    "1": {
      "status": 400,
      "text": "{\"error\":\"fieldId and taskId are required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "": {
      "status": 500,
      "text": "{\"error\":\"Internal server error\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "{": {
      "status": 500,
      "text": "{\"error\":\"Internal server error\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "null": {
      "status": 500,
      "text": "{\"error\":\"Internal server error\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "true": {
      "status": 400,
      "text": "{\"error\":\"fieldId and taskId are required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "false": {
      "status": 400,
      "text": "{\"error\":\"fieldId and taskId are required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "\"text\"": {
      "status": 400,
      "text": "{\"error\":\"fieldId and taskId are required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "[]": {
      "status": 400,
      "text": "{\"error\":\"fieldId and taskId are required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "[{}]": {
      "status": 400,
      "text": "{\"error\":\"fieldId and taskId are required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    },
    "{}": {
      "status": 400,
      "text": "{\"error\":\"fieldId and taskId are required\"}",
      "headers": [
        [
          "content-type",
          "application/json"
        ]
      ],
      "calls": []
    }
  }
};
for (const operation of operations) {
  test(`${operation}: JSON object reader ON preserves malformed, empty, scalar, array and object legacy responses`, async () => {
    for (const mode of ['ON', 'OFF', 'FLAG_FAILURE']) for (const raw of inputs) {
      const result = await run(operation, mode, { raw });
      assert.deepEqual(contract(result), baseline[operation][raw]);
      assert.equal(result.readers.length, mode === 'ON' ? 1 : 0);
      assert.equal(result.jsonReads, 1, 'body parsing must not be duplicated for legacy fallbacks');
    }
  });
  test(`${operation}: unauthorized body is not parsed and reader cannot run`, async () => {
    // HTPR-7073: with the flag ON a signed session no longer needs the profile cookie, so only OFF stays unauthorized.
    for (const mode of ['OFF']) {
      // create-session is signed-session-only, unlike the profile-required routes.
      // HTPR-7068: preferences accept the signed session alone when the flag is on.
      const signedSessionOnly = operation === 'createSession' || (mode === 'ON' && preferenceOperations.has(operation));
      const result = await run(operation, signedSessionOnly ? 'NO_SESSION' : mode, { raw: '{', noProfile: true });
      assert.equal(result.status, 401);
      assert.equal(result.jsonReads, 0);
      assert.deepEqual(result.readers, []);
      assert.deepEqual(result.calls, []);
    }
  });
}
test('HTPR-7068: malformed preferences from a signed session without the legacy profile are parsed when the flag is on', async () => {
  for (const operation of preferenceOperations) {
    const result = await run(operation, 'ON', { raw: '{', noProfile: true });
    assert.equal(result.status, 400);
    assert.equal(result.jsonReads, 1);
  }
});
test('Malformed create-session retains blank-session creation in both modes (no new JSON 400 in PR 2)', async () => {
  for (const mode of ['ON', 'OFF']) {
    const result = await run('createSession', mode, { raw: '{' });
    assert.equal(result.status, 200);
    assert.ok(result.calls.some(([name]) => name === 'sessionCreate'));
  }
});
