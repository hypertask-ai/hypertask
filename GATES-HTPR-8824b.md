# GATES HTPR-8824b

Goal: AI chat sidebar and floating composer placeholder reads "Ask anything, @ for context" with the flag on, and the AI chat plus menu reuses one shared component instead of a copy.

Flag: htpr-8824-ai-chat-one-composer (EVERYONE). Reused, no new flag.

## Gates

1. Placeholder text: sidebar and floating composer read "Ask anything, @ for context" with the flag on; flag off keeps "Focus with CTRL + Q, @ for context". Evidence: unit test written, live screenshot of both surfaces.
2. Plus menu shared: AiChatOneComposer and ComposeTaskWriter render one shared ComposerPlusMenu component, no duplicate markup. Evidence: diff plus tests.
3. PR merged: title "HTPR-8824 [IMPROVE] AI chat composer: placeholder and shared plus menu", required checks green, no P1. Evidence: PR link and merge sha.
4. Deploy confirmed: production deploy for the merge sha succeeded. Evidence: deploy id.
5. Live proof: QA account screenshots of sidebar and floating placeholder and plus menu on production. Evidence: sc2-upload links.

## Status

All gates open.
