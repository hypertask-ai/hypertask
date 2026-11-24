# Cloudflare security scan (HTPR-9588)

Ticket: https://app.hypertask.ai/detail/project-15/9588

Scan run on 2026-11-22. This page records which Cloudflare scanners ran, what they
covered, and what was left alone. It is the durable copy of the PR description. Host
names, addresses and record contents stay in the ticket, because this repository is
public.

## What ran

| Tool | Scope | Plan needed | Result |
|---|---|---|---|
| Security Insights, on-demand | 4 zones, one scan each | Free, included | All 4 jobs completed |
| URL Scanner | the public marketing page and the app | Free, included | 2 unlisted scans, both finished, neither marked malicious |

Quota after the scans: 4 of 5 on-demand scans used.

## What did not run, and why

- Web and API Vulnerability Scanner needs API Shield on the zone. This account is not
  entitled to it. Nothing was started and no plan was bought.
- Managed Defense vulnerability discovery (the code scanner) is not authorized for this
  Cloudflare connection. Nothing was started.

## State before and after

- Scheduled Security Insights: off before the scan, still off after. That switch is the
  undo for this work.
- Live Cloudflare settings: none edited. No WAF rule, DNS record, bot setting, TLS or
  email record was changed.
- Spend: none.

## Findings this scan closed

The August pass reported HSTS off, Always Use HTTPS off, missing SPF, missing DMARC on
one domain, an exposed old address record, and suggested Polish and Argo. None came back:

- HSTS is on. Always Use HTTPS is on.
- SPF is present where the old pass said it was missing.
- The domain without DMARC now has a record.
- Polish and Argo are paid performance switches, not security defects.

The old critical "WAF not enabled" item did not return either. The free managed ruleset
is not attached, and attaching it is a live change, so it was left alone.

## Findings that are not defects for this product

- "Challenge AI bots" is wrong here. The public site allows those crawlers on purpose.
- Grey-cloud names pointing at the public app host, the docs site, the auth host or a
  third-party score tool are not a private-origin leak. They point at public servers.
- A console error on the marketing page came from the scanner's own request header. The
  page was not marked malicious.

## Findings that stand, with no change made

Each one is a live setting or a DNS record, so none was touched by a scan ticket:

- Bot Fight Mode is off on all 4 zones. The switch is free.
- DMARC is monitor-only on 2 zones.
- security.txt is missing on all 4 zones.
- One probe hostname has 2 SPF records.

## How to re-run

Cloudflare dashboard, Security Center: one on-demand Security Insights scan per zone,
with scheduled scans left off. Quota allows 5 on-demand scans per month; 1 is left this
month.
