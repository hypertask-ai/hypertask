DELETE FROM "FeatureFlag" WHERE "key" IN (
  'htpr-6130-mobile-reminder-safe-area',
  'htpr-6154-chat-stop-and-timeout',
  'htpr-6197-confirmed-proposal-heading',
  'htpr-6278-chat-turn-failure-state',
  'htpr-6363-task-writer-research',
  'htpr-6372-search-ranking',
  'htpr-6553-agent-chat-polling',
  'htpr-6554-light-comment-separation',
  'htpr-6559-keep-direct-task-open-after-comment',
  'htpr-6561-preserve-ai-edited-description-structure',
  'htpr-6722-latest-models'
);
