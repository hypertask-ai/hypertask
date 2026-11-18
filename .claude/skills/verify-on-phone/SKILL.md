---
name: verify-on-phone
description: Any ticket touching UI, before opening the PR
---

pstack: 0.15.43

# verify-on-phone moved

This skill is now [verify-hypertask](../verify-hypertask/SKILL.md). Its Launch and Drive
sections hold the local server recipe and the 390x844 shot, and its Evidence section holds
the ticket attachment rule.

`scripts/phone-shot.sh` stays where it is: it resolves its own Playwright and does not
depend on the caller's working directory.
