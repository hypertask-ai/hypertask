## Server feature-flag coverage (YPER4-713)

Server changes under `src/lib/mcp/`, `src/lib/mcp-server/`, `src/lib/api/`,
`src/app/api/`, `src/pages/api/` and `src/utils/controllers/` also enter the
feature-flag gate. Non-exempt changes need a ticket-specific `isFeatureEnabled`
call on an added or modified server line controlling runtime behavior. A client
`useFlag` call cannot satisfy server coverage. Re-export routes and their gated
operations need no duplicate reads. UI coverage stays independent. Existing title, label, registry
and refactor exemptions remain unchanged. Passing server features reuse the
`feature-gated-ui` owner-review routing token; no auto-merge route changes.
This bounded syntax check supplements review; it does not prove authorization or
cover every server service directory.
