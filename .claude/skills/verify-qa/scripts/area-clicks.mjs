import fs from "node:fs"
import path from "node:path"

const RAW = `
activation-analytics.md | none | src/lib/telemetry/activationAnalytics.ts | Server milestones are recorded in the background. There is no screen to click.
agent-chat-roster.md | screen | src/app/agents/chat/ | /agents/chat | title:Agent Chat
agent-rooms.md | screen | src/app/agents/chat/AgentRoomClient.tsx | /agents/chat?view=rooms | text:Board rooms
agent-runs.md | none | src/app/api/mcp/agents/runs/ | Agent runs are API calls. There is no screen to click.
agent-scope-guard.md | none | .github/scripts/agent-scope/ | The guard is a CI step. There is no screen to click.
agents-board-access.md | screen | src/app/agents/page.tsx | /agents | title:Agents
ai-feedback-reports.md | none | src/lib/aiFeedback/automatic.ts | Automatic feedback files a ticket from an agent call. There is no screen to click.
ai-usage.md | screen | src/lib/ai/dailyAiSpend.ts | /settings/ai-usage | title:Settings
announcements-admin-api.md | none | src/pages/api/admin/announcements/ | Announcement admin routes have no customer screen.
board-invites.md | screen | src/components/Modals/commands/inviteMember.tsx | /settings/members | title:Settings
board-member-list.md | screen | src/components/Modals/Settings/BoardMembersSection.tsx | /settings/board-members | title:Settings
board-skills.md | screen | src/components/Modals/Settings/BoardSkillsSection.tsx | /settings/board-skills | title:Settings
ci-runner-policy.md | none | .github/scripts/ci-runner-policy.cjs | Runner placement is a pull request check. There is no screen to click.
ci-server-feature-flags.md | none | .github/scripts/feature-flag-registry.mjs | The server flag check reads git blobs. There is no screen to click.
ci-settings.md | none | .github/workflows/required-check-settings.yml | Required check settings are a GitHub workflow. There is no screen to click.
ci-tests.md | none | .github/workflows/ci-tests.yml | CI tests are a GitHub workflow. There is no screen to click.
cli-install.md | screen | src/lib/onboarding/installCommands.ts | /settings/cli | title:Settings
command-palette.md | script | src/components/Modals/commands/HTC/ | ctrl-j-drive.mjs | ctrl-j drive ok
custom-instructions.md | screen | src/components/Modals/Settings/BoardAiSection.tsx | /settings/board-ai | title:Settings
demo-board.md | screen | src/app/(tutorial space)/demo/ | /demo | selector:.kanban-column-title
desktop-login.md | screen | src/app/cli-auth/ | /cli-auth | text:Authenticating HyperTask CLI
drag-and-drop.md | script | src/components/PageComponents/Kanban/KanbanTaskComponents/ | board-drive-live.mjs | board ok
feature-flag-and-ux-gates.md | none | .github/scripts/feature-flag-gate.mjs | These are pull request checks. There is no screen to click.
feature-flags-api.md | script | src/app/api/mcp/flags/ | flags-drive-live.mjs | flags ok
figma-connect.md | screen | src/components/Modals/Settings/AccountsSection.tsx | /settings/accounts | title:Settings
in-app-feedback.md | screen | src/components/Modals/Feedback/ | /settings/general | selector:button[aria-label="Send feedback"]
mcp-legacy-sse.md | none | src/app/sse/route.ts | Legacy MCP uses HTTP routes. There is no screen to click.
mcp-next-task.md | none | src/app/api/mcp/tasks/next/ | Next-task pick is an API. There is no screen to click.
mcp-project-list.md | none | src/app/api/mcp/projects/ | Project listing is an API. There is no screen to click.
mcp-task-lookup.md | none | src/app/mcp/route.ts | Task lookup is an API. There is no screen to click.
mcp-task-moves.md | none | src/app/api/mcp/tasks/update/ | Agent task moves use an API. There is no screen to click.
mcp-token-revoke.md | screen | src/app/api/mcp/token/route.ts | /settings/mcp | title:Settings
mobile.md | phone | src/hooks/General/useMobileVisualViewport.ts | /inbox | title:Inbox
model-canary.md | none | src/app/api/cron/ai-model-canary/route.ts | The model canary is an internal cron. There is no screen to click.
my-tasks.md | screen | src/app/my-tasks/ | /my-tasks | title:My Tasks
pages.md | screen | src/app/pages/ | /pages | title:Pages
pr-ticket-binding.md | none | .github/workflows/pr-guards-trusted.yml | Ticket binding is a pull request check. There is no screen to click.
public-sites.md | none | .claude/skills/verify-qa/reference/feature-map/public-sites.md | Public marketing pages are signed out and are outside this logged-in driver.
reports-agent-doors.md | screen | src/app/report/ | /report | title:Reports
search-and-filters.md | screen | src/pages/api/search/ | /search | title:Search
search.md | screen | src/app/search/ | /search | title:Search
slack-app.md | screen | src/app/add-to-slack/ | /add-to-slack | title:Add Hypertask to Slack
starred.md | screen | src/app/starred/ | /starred | title:Starred
task-share-links.md | screen | src/pages/api/share/ | /detail/project-{projectId}/{uniqueIndex} | selector:#title-input
task-templates.md | screen | src/components/Modals/Settings/BoardTaskTemplatesSection.tsx | /settings/board-task-templates | title:Settings
task-writer-quality-eval.md | none | .github/workflows/task-writer-eval.yml | The writer eval is a GitHub workflow. There is no screen to click.
team-credential-db-races.md | none | tests/htpr-7660-team-races-postgres.test.cjs | These are database tests. There is no screen to click.
themes.md | screen | src/components/Modals/Settings/AppearanceSection.tsx | /settings/appearance | title:Settings
trash-and-permanent-delete.md | screen | src/app/trash/ | /trash/{projectId} | text:Trash
webhooks.md | screen | src/app/api/settings/webhooks/ | /settings/webhooks | title:Settings
`.trim()

export function parseClickRow(line) {
  const [page, kind, prefix, a, b] = line.split(" | ")
  const prefixes = [prefix]
  if (kind === "none") return { page, kind, reason: a, prefixes }
  if (kind === "script") return { page, kind: "screen", script: a, expect: b, prefixes }
  const colon = b.indexOf(":")
  return {
    page,
    kind: "screen",
    path: a,
    how: b.slice(0, colon),
    ready: b.slice(colon + 1),
    prefixes,
    phone: kind === "phone",
  }
}

export const AREA_CLICKS = RAW.split("\n").filter(Boolean).map(parseClickRow)

export function planForPage(page, plans = AREA_CLICKS) {
  return plans.find((plan) => plan.page === page) || null
}

export function openedPath(url, planPath) {
  const target = new URL(planPath, "http://127.0.0.1")
  const actual = new URL(url, "http://127.0.0.1")
  if (actual.pathname !== target.pathname) return false
  for (const [key, value] of target.searchParams) {
    if (actual.searchParams.get(key) !== value) return false
  }
  return true
}

export function screenReady(actual, plan) {
  if (!plan || plan.kind !== "screen" || plan.script || !plan.path) return false
  if (!openedPath(actual.url, plan.path)) return false
  if (plan.how === "title") return String(actual.title || "").includes(plan.ready)
  if (plan.how === "text") return String(actual.text || "").includes(plan.ready)
  if (plan.how === "selector") return actual.selector === true
  return false
}

export function clickCoverage(pages, plans = AREA_CLICKS, smokePages = []) {
  const smoke = new Set(smokePages)
  const known = new Set(pages)
  const planned = new Set(plans.map((plan) => plan.page))
  return {
    missing: pages.filter((page) => page.endsWith(".md") && page !== "INDEX.md" && !smoke.has(page) && !planned.has(page)),
    stale: plans.filter((plan) => !known.has(plan.page)).map((plan) => plan.page),
  }
}

export function missingPrefixPaths(root, plans = AREA_CLICKS) {
  return plans.flatMap((plan) => (plan.prefixes || []).filter((prefix) => !fs.existsSync(path.join(root, prefix))).map((prefix) => `${plan.page} ${prefix}`))
}

export function matchClickPlans(files, plans = AREA_CLICKS) {
  const counts = new Map()
  for (const file of files) {
    if (typeof file !== "string" || file.length === 0) continue
    let winner = null
    for (const plan of plans) {
      for (const prefix of plan.prefixes || []) {
        const hit = prefix.endsWith("/") ? file.startsWith(prefix) : file === prefix
        if (!hit) continue
        if (!winner || prefix.length > winner.prefix.length) winner = { plan, prefix }
      }
    }
    if (!winner) continue
    counts.set(winner.plan.page, (counts.get(winner.plan.page) || 0) + 1)
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  if (ranked.length === 0) return null
  const top = ranked[0][1]
  const leaders = ranked.filter(([, count]) => count === top).map(([page]) => page)
  if (leaders.length !== 1) return { tie: leaders }
  return { plan: plans.find((plan) => plan.page === leaders[0]), counts: Object.fromEntries(ranked) }
}

export function clickExpect(plan) {
  return plan.expect || `${plan.page.replace(/\.md$/, "")} ok`
}
