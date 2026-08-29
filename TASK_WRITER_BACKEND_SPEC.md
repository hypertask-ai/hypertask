# Task Writer API – Backend Specification (FastAPI)

Specification for the Task Writer endpoint to generate structured output for **Task creation only** (`aiMode === "AiTaskWriter"`).

---

## 1. Request Format

The frontend sends `POST` to `/taskWriter` (or equivalent) with JSON body:

```json
{
  "projectId": 15,
  "teamId": "08f79efd-770e-4e32-9728-65e6d29ec893",
  "PROMPT": "<see below>",
  "customInstructions": "",
  "sourceSelected": "xai",
  "modelSelected": "grok-4",
  "aiMode": "AiTaskWriter",
  "images64": [],
  "pdfs64": [],
  "docx64": [],
  "webSearchQuery": null,
  "enableWebSearch": false,
  "taskIds": [],
  "taskTitle": "",
  "taskDescription": ""
}
```

### `PROMPT` structure (when `aiMode === "AiTaskWriter"`)

The frontend preprends instructions and context to `PROMPT` before sending. It will look like:

```
Output format: Use HTML elements with these IDs for structured data (omit if not specified):
- h1#ai-generated-task-title: task title
- span#ai-generated-task-priority: priority_index 0-4 (0=None, 1=Urgent, 2=High, 3=Medium, 4=Low)
- span#ai-generated-task-estimate: estimate_index 0-7 (0=None, 2=XS, 3=S, 4=M, 5=L, 6=XL)
- span#ai-generated-task-tags: comma-separated label IDs when user specifies tags
- span#ai-generated-task-status: section_id (number) when user specifies status/column

Available tags for this project (use these exact IDs in ai-generated-task-tags): [{id: "uuid-1", value: "frontend"}, {id: "uuid-2", value: "bug"}]

Available status/columns for this project (use these exact id values in ai-generated-task-status): [{id: 101, section_title: "Todo"}, {id: 102, section_title: "In Progress"}]

Original Description: <existing description or empty>

<User prompt, e.g. "Create a bug task for the login form, tag: frontend, size: small, priority: high">
```

---

## 2. Expected Output Format (HTML)

The response must be valid HTML. For **structured properties**, use elements with the IDs below. All except `ai-generated-task-title` are optional.

### Required

| Element | ID | Content |
|--------|-----|---------|
| `<h1>` | `ai-generated-task-title` | Task title (plain text) |

### Optional (omit entirely if not inferred or specified)

| Element | ID | Content |
|--------|-----|---------|
| `<span>` (hidden) | `ai-generated-task-priority` | Integer 0–4 (see mapping) |
| `<span>` (hidden) | `ai-generated-task-estimate` | Integer 0–7 (see mapping) |
| `<span>` (hidden) | `ai-generated-task-tags` | Comma-separated label IDs (UUIDs from the provided tags list) |
| `<span>` (hidden) | `ai-generated-task-status` | Section ID (integer) – column/status the task should go in |

### Priority mapping (index → label)

| Index | Value |
|-------|--------|
| 0 | No Priority |
| 1 | Urgent |
| 2 | High |
| 3 | Medium |
| 4 | Low |

### Estimate / size mapping (index → label)

| Index | Value |
|-------|--------|
| 0 | No size |
| 2 | XS (Extra small) |
| 3 | S (Small) |
| 4 | M (Medium) |
| 5 | L (Large) |
| 6 | XL (Extra large) |

---

## 3. Example Output

### Input prompt

```
Create a bug task for the login form timeout issue. Put in In Progress, tag: frontend, size: small, priority: high.
```

### Expected HTML response (streaming)

```html
<h1 id="ai-generated-task-title">Fix Login Form Timeout for Long Sessions</h1>
<span id="ai-generated-task-status" style="display:none">102</span>
<span id="ai-generated-task-priority" style="display:none">2</span>
<span id="ai-generated-task-estimate" style="display:none">3</span>
<span id="ai-generated-task-tags" style="display:none">abc-123-uuid-frontend</span>

<p>Users are experiencing session timeouts when the login form is left idle for extended periods. The form should:</p>
<ul>
  <li>Display a warning before session expiry</li>
  <li>Allow silent token refresh where possible</li>
  <li>Preserve form data on redirect to re-login</li>
</ul>
<p><strong>Acceptance criteria:</strong> No unexpected logouts for idle times under 30 minutes.</p>
```

### Minimal output (no properties specified)

```html
<h1 id="ai-generated-task-title">Add user profile settings page</h1>

<p>Create a new settings page where users can update their display name, avatar, and notification preferences.</p>
```

---

## 4. Extraction Flow (Frontend)

The frontend will:

1. Parse the HTML
2. Read each element by ID
3. Remove these elements before showing description
4. Use `ai-generated-task-tags` to look up labels by ID
5. Use `ai-generated-task-status` to look up section by ID (for column/status)
6. Map priority/estimate indices to the constants above

---

## 5. Implementation Notes

### Model instructions (suggested)

Add system or user instructions when `aiMode === "AiTaskWriter"` along the lines of:

> When generating task content, include HTML elements with these IDs when the user specifies or you can infer:
> - `h1#ai-generated-task-title` – always include the task title
> - `span#ai-generated-task-priority` – integer 0–4 when priority is given
> - `span#ai-generated-task-estimate` – integer 0–7 when size is given
> - `span#ai-generated-task-tags` – comma-separated label IDs when tags are given (use only IDs from the provided list)
> - `span#ai-generated-task-status` – section ID (integer) when status/column is given (use only IDs from the provided status/columns list)
>
> Place these elements at the start of the response, before the main description. Use `display:none` for the span elements if desired. Do not include any of these spans if the user did not specify the corresponding property.

### Parsing user intent

Examples of how to map user wording to structured output:

- "priority: high" / "high priority" → `2`
- "size: small" / "small task" → `3`
- "tag: frontend" / "tags: frontend, bug" → resolve to IDs from the provided tags list
- "status: In Progress" / "put in Doing" / "column: Todo" → resolve to section ID from the provided status/columns list

### Response type

- Response must be streamed (SSE or chunked) as in the current integration
- Content-Type: `text/html` or `text/plain` (frontend treats it as HTML)
- The frontend does not expect JSON for the main response; it expects HTML with the above structure

---

## 6. Scope

This spec applies **only** when `aiMode === "AiTaskWriter"` (task creation). For `aiMode === "WriteWithAI"` (task detail / edit), keep existing behavior without structured properties.
