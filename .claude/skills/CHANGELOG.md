# Changelog

## 1.0.0 - 2026-09-15

The product skill pack moved here from `hypertask-ai/agent-skills`, into the
repo it serves. Skills are now read from the checkout each run works in,
instead of a separate skills repo. Company-pack references go through
`$COMPANY_SKILLS_DIR` (the installed company-skills plugin, falling back to
`~/projects/company-skills`). Growth, Support and Finance stay in
`hypertask-ai/agent-skills`.
