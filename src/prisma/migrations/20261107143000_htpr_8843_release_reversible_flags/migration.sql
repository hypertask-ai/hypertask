UPDATE "FeatureFlag" AS flag
SET mode = 'EVERYONE',
    "updatedAt" = NOW(),
    "releasedAt" = NOW()
WHERE flag.mode = 'OWNER_AND_QA'
  AND flag.key IN (
    'htpr-3533-google-calendar',
    'htpr-5908-local-writing-assistance',
    'htpr-6906-autocap-undo',
    'htpr-6921-slack-marketplace',
    'htpr-7363-chat-task-writer',
    'htpr-7509-agent-role-screen',
    'htpr-7509-write-agents-create-boards',
    'htpr-7529-mcp-act-as-agent',
    'htpr-7574-owned-unattached-agents',
    'htpr-7577-add-existing-agent',
    'htpr-7582-agent-access-request',
    'htpr-7622-ai-settings',
    'htpr-7663-scoped-agent-skills',
    'htpr-7686-free-plan-copy',
    'htpr-7799-project-entry',
    'htpr-7854-ai-thinking-opt-in',
    'htpr-7919-allowance-percent',
    'htpr-7977-short-task-writer',
    'htpr-8084-cross-team-agents',
    'htpr-8100-no-paid-fallback',
    'htpr-8143-quiet-agent-updates',
    'htpr-8215-agent-archive-delete',
    'htpr-8231-agent-archive-done',
    'htpr-8716-quick-entry-focus',
    'htpr-8804-visible-links-first',
    'htpr-8826-blocked-by-me-list',
    'htpr-8846-agent-lane-on-readable-board',
    'htpr-8881-board-view-filters',
    'yper4-651-self-follow-quiet'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "FeatureFlagChange" AS change
    WHERE change.key = flag.key
      AND change.reason LIKE 'live-qa-failed:%'
      AND change.id = (
        SELECT MAX(latest.id)
        FROM "FeatureFlagChange" AS latest
        WHERE latest.key = flag.key
      )
  );
