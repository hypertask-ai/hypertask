# Signup check (hypertask.app)

## How a customer reaches it

Not a customer page. https://hypertask.app/signup-check is an internal report behind Cloudflare Access, built from hypertask-ai/analytics (HTPR-7284). It compares, per Berlin day for the last 30 completed days, signups and activations from the production database (read-only `dashboard_ro`) and Stripe paid invoices with what PostHog recorded. Counts only.

## How to drive it

- Page: fetch it with the Access service identity from `~/.config/hypertask-agent-runtime.env` (CF-Access-Client-Id and Secret headers); a plain browser without Access login gets a 302 to the login page.
- Live proof: `bash ~/.local/state/vcc-evidence/HTPR-7284/check-live.sh` prints `signup-check live ok` (30 `data-day` rows, database and PostHog cells, PostHog snapshot under 36 h, no email address, neighbouring pages still load).
- Refresh: `systemctl --user start signup-check.service` on the VPS, then `journalctl --user -u signup-check.service -n 3` shows the totals line. The timer runs daily at 06:17 Berlin.
- Fixture paths (exclusions, Berlin window across DST, snapshot validation): `npm test` in hypertask-ai/analytics.

## What usually breaks

- The PostHog push runs before Cloudflare Workers Builds deployed a new snapshot shape, so the API rejects it; rerun the service after the deploy.
- The Worker's own Stripe read comes back incomplete; the page then shows daily-scan invoice counts and a "Payments not available: <reason>" line.
- Tracking events only exist since 2026-10-16 (signups, payments) and 2026-10-17 (activation); earlier days show "not available" by design.

## What proof to collect

Doctor: analytics merge SHA, deployment visible on the page. `check-live.sh` output, the refresh totals line, desktop 1440x900 and phone 390x844 screenshots taken with the Access headers, and the timer's next run.

## Cleanup

Nothing is written except the daily counts snapshot in the site's own storage.
