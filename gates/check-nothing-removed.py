import subprocess, sys, yaml
def names(text):
    doc = yaml.safe_load(text)
    out = set()
    for job, body in (doc.get('jobs') or {}).items():
        out.add('job:' + job)
        for step in (body.get('steps') or []):
            if isinstance(step, dict) and step.get('name'):
                out.add('step:%s:%s' % (job, step['name']))
    return out
lost = []
for f in ('.github/workflows/ci-tests.yml', '.github/workflows/visual-regression.yml'):
    mb = subprocess.run(['git','merge-base','HEAD','origin/production'],capture_output=True,text=True).stdout.strip()
    old = names(subprocess.run(['git','show',mb+':'+f],capture_output=True,text=True).stdout)
    new = names(open(f).read())
    lost += sorted(old - new)
if lost:
    print('removed or renamed:', lost); sys.exit(1)
print('G2 ok: job and step names are a superset of origin/production')
