#!/usr/bin/env python3
"""Inventory current source without network or application execution."""
import argparse
import csv
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Reviewed entry-point boundaries override transitive authentication used by
# internally invoked operations. Values are code locations, not credentials.
OVERRIDES = {
    'src/app/api/ops/core-actions-smoke/route.ts': ('bearer', 'src/lib/productionSmoke/access.ts:35 rejects every agent principal'),
    'src/app/api/admin/cleanup-oauth-codes/route.ts': ('bearer', 'route.ts:6-9 requires configured admin bearer credential'),
    'src/app/api/calendar/feed/route.ts': ('bearer', 'route.ts:24 validates calendar-feed JWT audience, not an agent login'),
    'src/app/api/notifications/unsubscribe/route.ts': ('bearer', 'route.ts:9 verifies purpose-specific unsubscribe token'),
    'src/app/api/slack/events/route.ts': ('webhook', 'route.ts:43 verifies Slack request signature'),
    'src/app/api/slack/commands/route.ts': ('webhook', 'route.ts:18 verifies Slack request signature'),
    'src/app/api/webhooks/github/route.ts': ('webhook', 'route.ts:384 verifies GitHub request signature'),
    'src/app/api/stripe/webhook/route.ts': ('webhook', 'Stripe event signature'),
    'src/pages/api/stripe/webhook.ts': ('webhook', 'Stripe event signature'),
}

def generate(root, output, analysis_path):
    subprocess.run(['node', str(HERE / 'analyze.cjs'), str(root), str(analysis_path)], check=True)
    analysis = json.loads(analysis_path.read_text())
    rows = []
    for route in analysis['routes']:
        auth = set(route['auth'])
        notes = []
        source = (root / route['path']).read_text()
        if route['path'] in OVERRIDES:
            kinds, note = OVERRIDES[route['path']]
            auth = set(kinds.split(';'))
            notes.append(note)
        elif '/api/cron/' in route['path']:
            auth = {'cron'}
            notes.append('incoming cron boundary; internal agent operation calls do not make this an agent login endpoint')
        elif 'verifySignature' in source or 'verifyQStash' in source:
            auth = {'webhook'}
            notes.append('incoming signed queue request')
        if route['parseErrors']:
            auth.add('agent')
            notes.append('malformed entry conservatively scanned so parse errors cannot hide authentication')
        if not auth:
            auth = {'public'}
            notes.append('no session/bearer/agent/cron/signature validator reachable; public includes unauthenticated login initiation, one-time-code exchange and retired 410 endpoints')
        if 'getCurrentUserFromCookies' in source or 'isValidUser' in source:
            notes.append('legacy profile-cookie branch conservatively agent-capable, not proof of signed authentication')
        reads = sorted({c['model'] for c in route['calls'] if c['mode'] == 'read'})
        writes = sorted({c['model'] for c in route['calls'] if c['mode'] == 'write'})
        helpers = route['helpers']
        flag = 'agent' in auth and bool(reads or writes) and not helpers
        data = sorted({f"{c['node'].split('#')[0]}:{c['line']} {c['model']}.{c['method']}[{c['via']}]" for c in route['calls']})
        auth_evidence = sorted({f"{k.split('#')[0]}:{analysis['nodes'][k]['line']} {k.split('#')[1]}" for k in route['reached'] if analysis['nodes'][k]['auth']})
        helper_chains = [' -> '.join(h['chain']) for h in helpers]
        reason = ('agent-capable authentication reaches board data but no shared access predicate; ' + (data[0] if data else '')) if flag else ''
        rows.append(dict(path=route['path'], kind=route['kind'], methods=';'.join(route['methods']), auth_kind=';'.join(sorted(auth)), agent_capable=str('agent' in auth).lower(), reads=';'.join(reads), writes=';'.join(writes), shared_predicates=('direct' if any(len(h['chain']) <= 2 and h['chain'][0].split('#')[0] == route['path'] for h in helpers) else 'via-controller') if helpers else 'none', predicate_evidence=' | '.join(helper_chains), data_evidence=' | '.join(data), auth_evidence=' | '.join(auth_evidence), flagged=str(flag).lower(), reason=reason, notes=' | '.join(notes)))
    rows.sort(key=lambda r: r['path'])
    with output.open('w', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} rows; {sum(r['flagged']=='true' for r in rows)} flagged", flush=True)
    malformed = [r['path'] for r in analysis['routes'] if r['parseErrors']]
    if malformed:
        raise ValueError(f'Inventory parser errors: {malformed}')
    return rows

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('root', nargs='?', type=Path, default=HERE / 'export')
    p.add_argument('--output', type=Path, default=HERE / 'routes.csv')
    p.add_argument('--analysis', type=Path, default=HERE / 'analysis.json')
    a = p.parse_args()
    generate(a.root.resolve(), a.output, a.analysis)
