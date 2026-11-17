# Occasional shipping operations

Read this only when a ticket needs a timer installation, a self-update cutover, or a non-app repository setup. Everyday shipping stays in [the ship skill](../skills/ship/SKILL.md).

## Runner timer installation

Install the merged executable to `~/.local/lib/hypertask/ship-chores/ship-chores` and its unit templates to `~/.config/systemd/user/`. Validate both with `user-unit-check`, reload systemd, enable only your own `ship-chores@NUMBER.timer`, then verify `user-unit-check --first-run ship-chores@NUMBER.service`. Never choose another identity. Shared locking and durable head history prevent overlap. The sweep never touches `~/.local/state/fleet/one-run.on`; the picker hold belongs to the merger that already runs on this server. Do not enable the sweep timer while that merger runs, or two mergers race for the same PR. Protected work still needs its authorized merger.

Runner timers, webhooks, pickup, and self-update have their own scripts. Read them only for an installation or dispatch task, not every ticket. New user timers require `user-unit-check` before enablement and one successful first real run afterward.

## Other repositories

For non-app repositories, configure `SHIP_REPO`, `SHIP_BASE`, and `SHIP_CHECKOUT` before generating gates and repeat them for checks and the Done move. The gate generator persists them. Native CLI uses `hypertask-ai/cli`, base `main`; verify uses `hypertask-ai/verify`, base `app-suite`. Verify releases require a merge-SHA release and an updated nightly checkout. Release-less repos may use `SHIP_DEPLOY=none`; a real release takes precedence. Cloudflare workers additionally use `SHIP_WORKER`; deployment proof requires the merge version active at 100%. See script validation before choosing settings.

## Runner setup still in this repository

Runner setup has not moved out of this product repository yet. The scripts live in `.claude/skills/ship/scripts/`, and the live self-update timer still installs them from here. Deleting them before the destination repository owns the install and the callers breaks live runners. Track the move on https://app.hypertask.ai/detail/project-15/7811 and get HT Product Lead's migration steps before removing any of them.
