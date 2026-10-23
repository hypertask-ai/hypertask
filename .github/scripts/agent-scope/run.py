#!/usr/bin/env python3
"""Regenerate agent entries, scan them, and enforce the scope ratchet."""
import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True

from inventory import generate
from scope_scan import scan

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--exceptions', type=Path, default=HERE / 'agent-scope-exceptions.json')
    parser.add_argument('--baseline', type=Path, default=HERE / 'agent-scope-baseline.json')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    output = args.output or Path(tempfile.mkdtemp(prefix='agent-scope-', dir=os.environ.get('RUNNER_TEMP')))
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault('SEMGREP_USER_DATA_FOLDER', str(output / 'state'))
    print(f'Agent scope evidence: {output}', flush=True)
    if args.self_test:
        from self_test import run
        return run(output)
    generate(args.root.resolve(), output / 'routes.csv', output / 'analysis.json')
    return scan(args.root.resolve(), output / 'routes.csv', output, args.exceptions, args.baseline)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        print(f'Agent scope guard failed: {error}', file=sys.stderr)
        sys.exit(2)
