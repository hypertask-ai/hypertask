#!/usr/bin/env python3
"""Reject interrupted or explicitly incomplete scans before filing or advancing scope."""
import json
from pathlib import Path
import re
import sys


def validate(root):
    runs = list(Path(root).glob('*/run.json'))
    if len(runs) != 1:
        raise ValueError(f'expected one run in this job, found {len(runs)}')
    run = runs[0]
    data = json.loads(run.read_text())
    result = data.get('scan_results') or {}
    if data.get('status') != 'completed' or result.get('scan_completed') is not True:
        raise ValueError('scan did not complete')
    prose = '\n'.join(str(result.get(k, '')) for k in ('methodology', 'executive_summary', 'technical_analysis'))
    if not re.search(r'\bCOVERAGE_COMPLETE\b', prose):
        raise ValueError('scan did not attest to completing the requested scope')
    if re.search(r'COVERAGE_INCOMPLETE|(?:scope|coverage|review|scan)\s+(?:is|was|remains)?\s*incomplete|did not complete|budget.{0,30}(exhaust|exceed|reach)', prose, re.I):
        raise ValueError('report admits incomplete coverage or exhausted budget')
    if not (run.parent / 'penetration_test_report.md').is_file():
        raise ValueError('completed scan has no report')
    return run.parent


if __name__ == '__main__':
    try:
        print(validate(sys.argv[1]))
    except (ValueError, KeyError, OSError) as error:
        raise SystemExit(f'Strix rejected: {error}') from error
