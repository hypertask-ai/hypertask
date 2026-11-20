---
name: verify-qa
description: After deployment, verify real production behavior and record proof before closing the ticket.
---

pstack: 0.15.43

# verify-qa moved

This skill is now [verify-hypertask](../verify-hypertask/SKILL.md). Read it for every
proof: Launch, Doctor, Drive, Evidence, Cleanup and Helpers.

The helpers stay in `scripts/` and the customer map stays in `reference/feature-map/`
because `.github/workflows/ship-scripts-tests.yml` and `feature-map-weekly.yml` name those
paths, and those workflow files have another owner.
Both paths move with the skill once those lists move with them.
