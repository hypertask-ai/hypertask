#!/usr/bin/env python3
import argparse
import csv
import hashlib
import io
from pathlib import Path
import subprocess
import sys
import tempfile

SNAPSHOT = '4c1777e08431308d563cc7c7e12ffda806004301'
JAR_SHA256 = '4287ae2034901844450f769547bc4497a0da1a6d1c7fa6fadc858705e6743b5f'
HEADERS = {
    'summary': ['statistic', 'value'],
    'revisions': ['entity', 'n-revs'],
    'coupling': ['entity', 'coupled', 'degree', 'average-revs'],
}


def validate_output(analysis, text):
    try:
        rows = list(csv.reader(io.StringIO(text, newline=''), strict=True))
        if not rows or rows[0] != HEADERS[analysis] or len(rows) < 2:
            raise ValueError('missing expected CSV header or rows')
        if any(len(row) != len(rows[0]) or any(not cell for cell in row) for row in rows[1:]):
            raise ValueError('invalid CSV row')
        if analysis == 'summary':
            expected = {'number-of-commits', 'number-of-entities', 'number-of-entities-changed', 'number-of-authors'}
            if len(rows) != 5 or {row[0] for row in rows[1:]} != expected:
                raise ValueError('invalid summary statistics')
            values = [int(row[1]) for row in rows[1:]]
        elif analysis == 'revisions':
            values = [int(row[1]) for row in rows[1:]]
        else:
            values = [int(row[3]) for row in rows[1:]]
            if any(not 0 <= int(row[2]) <= 100 for row in rows[1:]):
                raise ValueError('invalid coupling degree')
        if any(value <= 0 for value in values):
            raise ValueError('nonpositive count')
        return rows
    except (csv.Error, ValueError, IndexError) as error:
        raise ValueError(f'invalid {analysis} output: {error}') from error


def run(command, cwd):
    result = subprocess.run(command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        raise RuntimeError(f'{command[0]} failed: {result.stderr.decode("utf-8", "replace").strip()}')
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description='Reproduce the fixed HTPR-8190 code-maat baseline')
    parser.add_argument('--jar', required=True, type=Path, help='Trusted official code-maat 1.0.4 standalone JAR')
    parser.add_argument('--output', required=True, type=Path, help='Existing empty directory outside Git worktrees')
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    jar = args.jar.resolve(strict=True)
    if not jar.is_file() or hashlib.sha256(jar.read_bytes()).hexdigest() != JAR_SHA256:
        raise ValueError('JAR does not match the pinned official 1.0.4 SHA-256')
    if run(['git', 'rev-parse', '--is-shallow-repository'], repo).strip() != b'false':
        raise ValueError('complete Git history required; shallow repositories are unsupported')
    output = args.output.resolve(strict=True)
    if not output.is_dir() or any(output.iterdir()):
        raise ValueError('output must be an existing empty directory')
    probe = subprocess.run(['git', 'rev-parse', '--is-inside-work-tree'], cwd=output, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if probe.returncode == 0:
        raise ValueError('output must be outside Git worktrees')
    git = ['git', '-c', 'core.quotePath=true', 'log', SNAPSHOT,
           '--since=2026-10-01T00:00:00Z', '--until=2026-10-29T23:59:59Z',
           '--date=short', '--pretty=format:--%h--%ad--%aN', '--numstat', '--no-renames']
    history = run(git, repo)
    with tempfile.TemporaryDirectory(prefix='code-maat-') as temp:
        log = Path(temp) / 'history.log'
        log.write_bytes(history)
        results = {}
        for analysis in HEADERS:
            data = run(['java', '-jar', str(jar), '-l', str(log), '-c', 'git2', '-a', analysis], repo)
            text = data.decode('utf-8')
            rows = validate_output(analysis, text)
            if analysis == 'revisions':
                rows[1:] = sorted(rows[1:], key=lambda row: (-int(row[1]), row[0]))
            elif analysis == 'coupling':
                rows[1:] = sorted(rows[1:], key=lambda row: (-int(row[2]), -int(row[3]), row[0], row[1]))
            else:
                rows[1:] = sorted(rows[1:])
            canonical = io.StringIO(newline='')
            csv.writer(canonical, lineterminator='\n').writerows(rows)
            results[analysis] = (canonical.getvalue(), rows)
    for analysis, (text, _) in results.items():
        (output / f'{analysis}.csv').write_text(text, encoding='utf-8', newline='')
    summary = dict(results['summary'][1][1:])
    report = ['# Code-maat baseline', '', f'Snapshot: `{SNAPSHOT}`',
              'Committer window: 2026-10-01T00:00:00Z inclusive to 2026-10-30T00:00:00Z exclusive.',
              'Official code-maat 1.0.4; default analysis thresholds.',
              'Co-change is a proxy, not measured conflicts or throughput.', '', '## Summary', '']
    report += [f'- {key}: {value}' for key, value in summary.items()]
    report += ['', '## Top revisions', '']
    report += [f'- `{row[0]}`: {row[1]}' for row in results['revisions'][1][1:11]]
    report += ['', '## Highest coupling', '']
    report += [f'- `{row[0]}` / `{row[1]}`: {row[2]}%, average revisions {row[3]}' for row in results['coupling'][1][1:11]]
    (output / 'report.md').write_text('\n'.join(report) + '\n', encoding='utf-8')


if __name__ == '__main__':
    try:
        main()
    except (OSError, UnicodeError, ValueError, RuntimeError) as error:
        print(f'error: {error}', file=sys.stderr)
        sys.exit(1)
