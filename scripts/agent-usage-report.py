#!/usr/bin/env python3
"""Per-role Claude Code token report for YPER4-382 (run before and after each declutter change).

Privacy-safe Claude Code API accounting (Python standard library only).

Titles: custom-title.customTitle and agent-name.agentName are append-only records
without timestamps in this corpus. Use the last explicit title for sessionId;
ai-title.aiTitle is a fallback only. Across files, later file mtime wins. Nested
transcripts (including subagents/) are independent chains regardless of parent
sessionId and always role=subagent. Case-insensitive title prefixes: RUNNER,
BUG RUNNER, SPEED RUNNER; HT Product Lead, INFRA MANAGER; Growth; else other.

Read each inode once. Deduplicate globally by message.id (fallback requestId,
uuid, then file/line), retaining max (input+creation+read, output), exactly as
cache-audit/collect.py. Exclude <synthetic>. Window is [since, until), UTC;
--days is a rolling duration, not calendar weeks. Sessions means chains with an
API call in the window. First-call cost is the earliest *observed lifetime* API
call of each such chain, even before the window, not its first in-window call.
No text, prompts, tool arguments, titles or message content are emitted/stored.
"""
import argparse
import collections
import datetime as dt
import json
from pathlib import Path
import statistics
import time

ROOT = Path.home() / '.claude/projects'
ROLES = ('runner', 'lead', 'growth', 'subagent', 'other')


def timestamp(value):
    try:
        parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.timestamp()
    except (ValueError, TypeError, AttributeError):
        return None


def iso(value):
    return dt.datetime.fromtimestamp(value, dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def role(title, nested=False):
    if nested:
        return 'subagent'
    title = title.strip().upper()
    if title.startswith(('RUNNER', 'BUG RUNNER', 'SPEED RUNNER')):
        return 'runner'
    if title.startswith(('HT PRODUCT LEAD', 'INFRA MANAGER')):
        return 'lead'
    if title.startswith('GROWTH'):
        return 'growth'
    return 'other'


def files(root=ROOT):
    seen = set()
    for path in sorted(root.rglob('*.jsonl'), key=lambda p: (p.stat().st_mtime_ns, str(p))):
        stat = path.stat()
        key = stat.st_dev, stat.st_ino
        if key not in seen:
            seen.add(key)
            yield path


def scan(root=ROOT, observer=None):
    requests, titles, ai_titles = {}, {}, {}
    stats = collections.Counter()
    for path in files(root):
        stats['files'] += 1
        nested = path.parent.parent != root
        with path.open(encoding='utf-8', errors='replace') as stream:
            for number, line in enumerate(stream, 1):
                try:
                    record = json.loads(line)
                except ValueError:
                    stats['malformed_lines'] += 1
                    continue
                if not isinstance(record, dict):
                    stats['invalid_records'] += 1
                    continue
                sid = record.get('sessionId') or path.stem
                chain = sid + ':' + path.stem if nested else sid
                kind = record.get('type')
                if not nested:
                    if kind in ('custom-title', 'agent-name'):
                        value = record.get('customTitle') if kind == 'custom-title' else record.get('agentName')
                        if isinstance(value, str):
                            titles[sid] = value
                    elif kind == 'ai-title' and isinstance(record.get('aiTitle'), str):
                        ai_titles[sid] = record['aiTitle']
                t = timestamp(record.get('timestamp'))
                if observer is not None:
                    observer(record, path, number, sid, chain, nested, t)
                message = record.get('message')
                if kind != 'assistant' or not isinstance(message, dict) or not message.get('usage'):
                    continue
                if message.get('model') == '<synthetic>':
                    stats['synthetic_excluded'] += 1
                    continue
                if t is None:
                    stats['untimed_api_blocks'] += 1
                    continue
                usage = message['usage']
                key = message.get('id') or record.get('requestId') or record.get('uuid')
                if not message.get('id'):
                    stats['missing_message_id'] += 1
                key = key or f'{path}:{number}'
                row = {'chain': chain, 'sid': sid, 'nested': nested, 'ts': t,
                       'input': usage.get('input_tokens', 0) or 0,
                       'creation': usage.get('cache_creation_input_tokens', 0) or 0,
                       'read': usage.get('cache_read_input_tokens', 0) or 0,
                       'output': usage.get('output_tokens', 0) or 0}
                row['size'] = row['input'] + row['creation'] + row['read']
                old = requests.get(key)
                if old is not None:
                    stats['duplicate_api_blocks'] += 1
                    if (row['input'], row['creation'], row['read']) != (old['input'], old['creation'], old['read']):
                        stats['usage_conflicts'] += 1
                if old is None or (row['size'], row['output']) > (old['size'], old['output']):
                    requests[key] = row
    for row in requests.values():
        row['role'] = role(titles.get(row['sid'], ai_titles.get(row['sid'], '')), row['nested'])
    return requests, {sid: role(title) for sid, title in (ai_titles | titles).items()}, dict(stats)


def summarize(rows, first):
    chains = {row['chain'] for row in rows}
    sizes = [row['size'] for row in rows]
    totals = {field: sum(row[field] for row in rows) for field in ('input', 'creation', 'read', 'output')}
    return {'sessions': len(chains), 'api_calls': len(rows),
            'mean_input_size': statistics.mean(sizes) if sizes else None,
            'median_input_size': statistics.median(sizes) if sizes else None,
            'cache_hit_rate': totals['read'] / sum(totals[k] for k in ('input', 'creation', 'read'))
            if sum(totals[k] for k in ('input', 'creation', 'read')) else None,
            'total_input': totals['input'], 'total_creation': totals['creation'],
            'total_read': totals['read'], 'total_output': totals['output'],
            'median_first_call_size': statistics.median(first[c]['size'] for c in chains) if chains else None}


def report(requests, since, until, stats=None, elapsed=None):
    first = {}
    for row in requests.values():
        if row['ts'] < until and (row['chain'] not in first or row['ts'] < first[row['chain']]['ts']):
            first[row['chain']] = row
    rows = [r for r in requests.values() if since <= r['ts'] < until]
    return {'window': {'since': iso(since), 'until': iso(until), 'days': (until-since)/86400},
            'first_call_rule': 'earliest observed lifetime API call for each active chain; may precede window',
            'roles': {name: summarize([r for r in rows if r['role'] == name], first) for name in ROLES},
            'overall': summarize(rows, first), 'scan': stats or {}, 'elapsed_seconds': elapsed}


def text_report(data):
    lines = [f"UTC window: {data['window']['since']} <= t < {data['window']['until']}",
             'Input size = uncached input + cache creation + cache read (tokens).',
             'First-call median uses earliest observed lifetime call of active sessions.',
             'Role        Sessions Calls     Mean input Median input First-call   Hit rate  Read / Creation / Input']
    for name, row in list(data['roles'].items()) + [('overall', data['overall'])]:
        fmt = lambda x: '-' if x is None else f'{x:,.1f}'
        hit = '-' if row['cache_hit_rate'] is None else f"{row['cache_hit_rate']:.2%}"
        lines.append(f"{name:<11} {row['sessions']:>8} {row['api_calls']:>6} {fmt(row['mean_input_size']):>12} "
                     f"{fmt(row['median_input_size']):>12} {fmt(row['median_first_call_size']):>10} {hit:>10} "
                     f"{row['total_read']:,} / {row['total_creation']:,} / {row['total_input']:,}")
    lines.append(f"Scan seconds: {data['elapsed_seconds']:.3f}")
    return '\n'.join(lines) + '\n'


def window_args(parser):
    parser.add_argument('--days', type=float, default=7)
    parser.add_argument('--since', help='ISO timestamp, naive values are UTC')
    parser.add_argument('--until', help='ISO timestamp, defaults to now UTC')


def window(args, parser):
    until = timestamp(args.until) if args.until else time.time()
    since = timestamp(args.since) if args.since else (until - args.days * 86400 if until is not None else None)
    if args.days <= 0 or since is None or until is None or since >= until:
        parser.error('require positive --days and valid ISO bounds with since < until')
    return since, until


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    window_args(parser)
    parser.add_argument('--json', type=Path, help='write metadata-only JSON report')
    parser.add_argument('--root', type=Path, default=ROOT, help='transcript folder (default ~/.claude/projects)')
    args = parser.parse_args()
    since, until = window(args, parser)
    start = time.perf_counter()
    requests, _, stats = scan(args.root)
    data = report(requests, since, until, stats, time.perf_counter() - start)
    if args.json:
        args.json.write_text(json.dumps(data, indent=2) + '\n')
    print(text_report(data), end='')


if __name__ == '__main__':
    main()
