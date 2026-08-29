# MCP Server Plan for Hypertasks

## Overview

Create a Model Context Protocol (MCP) server that enables AI assistants (external like Claude, and internal like Hyper AI, Task Writer, AI Chat) to interact with Hypertasks via the existing REST API.

## Key Requirements

- **API-based**: Calls existing REST API endpoints (no direct DB access)
- **Internal AI integration**: Available to Hyper AI, Task Writer, AI Chat features
- **Development environment**: Staging server
- **Authentication**: API key per user

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Claude/AI      │────▶│   MCP Server    │────▶│  Hypertasks API │
│  Assistants     │     │  (API Client)   │     │  /api/*         │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
┌─────────────────┐            │
│  Hyper AI       │────────────┘
│  Task Writer    │  (can call MCP tools directly
│  AI Chat        │   or use shared client lib)
└─────────────────┘
```

## Package Structure

```
/mcp-server/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                # MCP stdio entry point
│   ├── server.ts               # Tool registration
│   ├── client/
│   │   ├── api-client.ts       # HTTP client for Hypertasks API
│   │   └── auth.ts             # API key handling
│   ├── tools/
│   │   ├── index.ts            # Tool registry
│   │   ├── tasks.ts            # Task tools
│   │   ├── projects.ts         # Project tools
│   │   ├── comments.ts         # Comment tools
│   │   └── labels.ts           # Label tools
│   └── types/
│       └── index.ts            # Shared types
└── README.md
```

## API Key System

### New Prisma Model

Add to `src/prisma/schema.prisma`:

```prisma
model ApiKey {
  id          String    @id @default(uuid())
  keyHash     String    @unique
  keyPrefix   String
  name        String
  userId      Int
  user        User      @relation(fields: [userId], references: [id])
  createdAt   DateTime  @default(now())
  lastUsedAt  DateTime?
  expiresAt   DateTime?
  revokedAt   DateTime?
  scopes      String[]  @default(["read", "write"])

  @@index([keyHash])
  @@index([userId])
}
```

### New API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/settings/api-keys/generate` | POST | Generate new API key |
| `/api/settings/api-keys` | GET | List user's keys |
| `/api/settings/api-keys/[id]` | DELETE | Revoke key |
| `/api/settings/api-keys/validate` | POST | Validate key, return user context |

## API Client Approach

The MCP server calls existing API endpoints via HTTP:

```typescript
// mcp-server/src/client/api-client.ts
class HypertasksClient {
  constructor(
    private baseUrl: string,  // e.g., https://staging.hypertasks.ai
    private apiKey: string
  ) {}

  async createTask(params: CreateTaskParams) {
    return this.post('/api/tasks/create', params);
  }

  async listTasks(projectId: number) {
    return this.get(`/api/tasks/getAll?projectId=${projectId}`);
  }

  private async post(path: string, body: any) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });
    return res.json();
  }
}
```

## API Authentication Middleware

Add to existing API routes to support API key auth:

```typescript
// src/utils/api-auth.ts
export async function getAuthenticatedUser(req: NextApiRequest) {
  // Try cookie auth first (existing)
  const cookieUser = req.cookies?.nookies_user;
  if (cookieUser) {
    return JSON.parse(cookieUser);
  }

  // Try API key auth
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const apiKey = authHeader.slice(7);
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const record = await prisma.apiKey.findUnique({
      where: { keyHash },
      include: { user: true }
    });

    if (record && !record.revokedAt && (!record.expiresAt || record.expiresAt > new Date())) {
      await prisma.apiKey.update({
        where: { id: record.id },
        data: { lastUsedAt: new Date() }
      });
      return record.user;
    }
  }

  return null;
}
```

## MCP Tools

### Task Tools
| Tool | API Endpoint |
|------|--------------|
| `hypertasks_list_tasks` | GET `/api/tasks/getAll` |
| `hypertasks_get_task` | GET `/api/tasks/getTask` |
| `hypertasks_create_task` | POST `/api/tasks/create` |
| `hypertasks_update_task` | PUT `/api/tasks/single` |
| `hypertasks_move_task` | POST `/api/tasks/moveTask` |
| `hypertasks_delete_task` | DELETE `/api/tasks/single` |
| `hypertasks_search_tasks` | GET `/api/tasks/searchByParam` |
| `hypertasks_set_due_date` | POST `/api/tasks/setDueDate` |
| `hypertasks_set_priority` | POST `/api/priority/setPriority` |
| `hypertasks_set_estimate` | POST `/api/estimate/setEstimate` |

### Project Tools
| Tool | API Endpoint |
|------|--------------|
| `hypertasks_list_projects` | GET `/api/projects/getAll` |
| `hypertasks_get_project` | GET `/api/projects/detail` |

### Comment Tools
| Tool | API Endpoint |
|------|--------------|
| `hypertasks_list_comments` | GET `/api/comments/getByTask` |
| `hypertasks_create_comment` | POST `/api/comments/create` |

### Label Tools
| Tool | API Endpoint |
|------|--------------|
| `hypertasks_list_labels` | GET `/api/labels/getByProject` |
| `hypertasks_assign_label` | POST `/api/labels/assignLabel` |

### Assignee Tools
| Tool | API Endpoint |
|------|--------------|
| `hypertasks_assign_user` | POST `/api/assignees/assign` |

## Internal AI Integration

For Hyper AI, Task Writer, AI Chat - they can either:

**Option A**: Import the API client directly
```typescript
// In existing AI features
import { HypertasksClient } from '@/mcp-server/src/client/api-client';

const client = new HypertasksClient(process.env.API_URL, userApiKey);
await client.createTask({ projectId, sectionId, title });
```

**Option B**: Use MCP SDK to call tools programmatically
```typescript
import { Client } from '@modelcontextprotocol/sdk/client';
// Call MCP tools from internal features
```

## Files to Create

| File | Purpose |
|------|---------|
| `mcp-server/package.json` | Dependencies |
| `mcp-server/src/index.ts` | MCP entry point |
| `mcp-server/src/server.ts` | Tool registration |
| `mcp-server/src/client/api-client.ts` | HTTP client for API calls |
| `mcp-server/src/tools/*.ts` | Tool implementations |
| `src/pages/api/settings/api-keys/generate.ts` | Key generation |
| `src/pages/api/settings/api-keys/index.ts` | List keys |
| `src/pages/api/settings/api-keys/[id].ts` | Revoke key |
| `src/utils/api-auth.ts` | API key auth middleware |

## Files to Modify

| File | Change |
|------|--------|
| `src/prisma/schema.prisma` | Add ApiKey model |
| Existing API routes | Add API key auth support via middleware |

## Implementation Order

1. **API Key infrastructure**
   - Add Prisma model
   - Create key generation/management endpoints
   - Create auth middleware utility

2. **Update existing API routes**
   - Add Bearer token auth support to key routes (tasks, projects, comments, etc.)

3. **MCP Server package**
   - Set up package structure
   - Implement API client
   - Implement tools

4. **Internal AI integration**
   - Export client for use by Hyper AI, Task Writer, AI Chat

## Staging Server Development

- Base URL: `https://staging.hypertasks.ai` (or your staging URL)
- All development and testing on staging
- Environment variable: `HYPERTASKS_API_URL`

## Verification

1. Deploy API key endpoints to staging
2. Generate test API key
3. Test API calls with Bearer auth via curl/Postman
4. Build and test MCP server with MCP Inspector
5. Test integration with Claude Desktop pointing to staging

## Example Tool Implementation

```typescript
// mcp-server/src/tools/tasks.ts
import { HypertasksClient } from '../client/api-client';

export const taskTools = {
  hypertasks_create_task: {
    description: 'Create a new task in a project section',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'integer' },
        section_id: { type: 'integer' },
        title: { type: 'string' },
        description: { type: 'string' }
      },
      required: ['project_id', 'section_id', 'title']
    },
    handler: async (params: any, client: HypertasksClient) => {
      return client.createTask({
        projectId: params.project_id,
        sectionId: params.section_id,
        title: params.title,
        description: params.description || ''
      });
    }
  }
};
```

## Claude Desktop Config (for testing)

```json
{
  "mcpServers": {
    "hypertasks": {
      "command": "node",
      "args": ["/path/to/hypertasks/mcp-server/dist/index.js"],
      "env": {
        "HYPERTASKS_API_KEY": "ht_xxxxxxxxxxxx",
        "HYPERTASKS_API_URL": "https://staging.hypertasks.ai"
      }
    }
  }
}
```
