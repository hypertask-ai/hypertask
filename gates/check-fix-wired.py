import sys
tests = yaml_rules = []
ci = open('.github/workflows/ci-tests.yml').read()
vr = open('.github/workflows/visual-regression.yml').read()
checks = {
 'production capture publishes the baseline': 'name: visual-baseline-${{ steps.baseline.outputs.image }}-${{ steps.baseline.outputs.sha }}-' in vr,
 'capture is a push-only step': 'Publish the validated baseline' in vr,
 'visual-compare looks the artifact up': 'actions/artifacts?per_page=100&name=$BASELINE_NAME' in ci,
 'visual-compare downloads and unpacks it': 'baseline-artifact.zip' in ci and 'unzip -q -o' in ci,
 'a hit is reported as a captured base': "VISUAL_BASE_CACHE_HIT: ${{ steps.baseline-cache.outputs.cache-hit == 'true' || steps.baseline-artifact.outputs.hit == 'true' }}" in ci,
 'the base build is skipped on a hit': "steps.baseline-artifact.outputs.hit != 'true'" in ci,
 'the job may read artifacts': 'actions: read' in ci.split('\n  visual-compare:')[1].split('\n  mcp-cli-api-contract:')[0],
}
bad = [k for k, v in checks.items() if not v]
if bad:
    print('missing:', bad); sys.exit(1)
print('G3 ok: upload, lookup, download and cache-hit wiring all present')
