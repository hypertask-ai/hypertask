# MCP time entries

Both endpoints use authenticated `POST` requests with JSON bodies and return
`{ "success": true, "entry": ... }`. Existing access and agent-scope rules apply.

## Create: `/api/mcp/time/log`

- `task` (required string): task ID, unique index, or ticket ID.
- `minutes` (required integer): 1–1440.
- `note` (optional string or null): trimmed to 500 characters; blank/null clears it.
- `date` (optional string): a valid calendar day in `YYYY-MM-DD` format.
- `timezone_offset_minutes` (optional integer): minutes west of UTC, like
  JavaScript `getTimezoneOffset()`; applied when `date` is supplied.

Without `date`, the entry ends now and starts `minutes` earlier, as before.
With `date`, it starts at local noon on that day and ends `minutes` later.
Omitted, non-integer, or out-of-range timezone offsets (outside -840–840) use UTC,
matching update behavior. The MCP `time` tool's `action: "log"` accepts these same
optional fields (its schema requires a valid integer timezone offset).

```json
{ "task": "HTPR-6870", "minutes": 30, "note": "x", "date": "2026-09-30", "timezone_offset_minutes": -120 }
```

## Update: `/api/mcp/time/update`

- `entry_id` (required positive integer; numeric strings also accepted).
- `minutes` (optional integer, 1–1440; numeric strings also accepted).
- `note`, `date`, `timezone_offset_minutes`: same names and semantics as create.

At least one of `minutes`, `date`, or `note` is required; timezone alone is not a
change. Note-only updates leave the timestamps unchanged. Date-only updates move
the entry to local noon on the selected day and preserve its exact duration,
including partial minutes. Supplied minutes replace the duration. Omitted note
keeps the existing note; null or blank clears it. Invalid minutes/date/note and
empty updates return `400` with an explanatory error.

```json
{ "entry_id": 17, "note": "corrected", "date": "2026-09-30" }
```
