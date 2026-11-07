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
    'htpr-7977-short-task-writer',
    'htpr-8716-quick-entry-focus',
    'htpr-8804-visible-links-first',
    'htpr-8826-blocked-by-me-list',
    'htpr-8881-board-view-filters'
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
