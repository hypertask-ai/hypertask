# Announcements admin API

## How a customer reaches it

The rocket-digest agent (agent-fleet `workers/rocket-digest`) reads and posts the in-app announcements through three admin routes: `GET /api/admin/announcements/getAnnouncements`, `POST /api/admin/announcements/updateAnnouncement` and `POST /api/admin/postAnnouncement`. It authenticates with the owner announcements credential; admins in the app use a Firebase ID token with the `admin` claim. Users then see the announcements in the sidebar.

## How to drive it

Without any login, call each route with its method against https://app.hypertask.ai. Each must answer JSON `{"error":"Unauthorized"}` with status 401, never Vercel's HTML 500 page (`x-matched-path: /500`). Also send `Authorization: Bearer not-a-real-firebase-token` to `postAnnouncement`: 401 JSON proves the Firebase Admin path loads. Never use the owner credential for writes from QA; the agent's next scheduled run (cron `23 7 */2 * *`) is the end-to-end proof.

Locally, `node --no-experimental-require-module -e "require('firebase-admin/auth')"` reproduces Vercel's module loading: it must not throw `ERR_REQUIRE_ESM`.

## What usually breaks

- A dependency upgrade makes firebase-admin load an ESM-only package through `require()` (HTPR-7126: jwks-rsa 4 with jose 6). Vercel then crashes the function before the handler runs, so even requests without a login get the 500 page. Local Node hides it.
- Loading Firebase Admin at the top of the auth guard, so the owner credential path depends on it.

## What proof to collect

Checklist written before QA; the three no-login responses with status and body (text plus a rendered screenshot); the bogus Firebase token response. Doctor: merge SHA production deployment success and /my-tasks signed in with a QA account. Record the account id, never credentials. Publish a self-contained HTML report on the ticket and attach proof and key screenshots.

## Cleanup

None: the checks are read-only and write nothing.
