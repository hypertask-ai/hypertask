import subprocess, sys, yaml
files = ['.github/workflows/ci-tests.yml', '.github/workflows/visual-regression.yml', 'docs/ci.md']
for f in ('.github/workflows/ci-tests.yml', '.github/workflows/visual-regression.yml'):
    with open(f) as fh:
        yaml.safe_load(fh)
changed = set(subprocess.run(['git','status','--porcelain'],capture_output=True,text=True).stdout.split('\n'))
r = subprocess.run(['git','diff','--name-only','origin/production'],capture_output=True,text=True)
touched = {l for l in r.stdout.split() if l}
extra = touched - set(files)
if extra:
    print('unexpected changed files:', sorted(extra)); sys.exit(1)
print('G1 ok: yaml parses, changed files limited to .github/workflows/ci-tests.yml .github/workflows/visual-regression.yml docs/ci.md GATES.md')
