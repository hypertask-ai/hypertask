#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077
if [[ $# != 3 || ! $1 =~ ^(HTPR|HYFA|YPER4)-[1-9][0-9]*$ || ! $2 =~ ^[1-9][0-9]*$ || ! $3 =~ ^[1-9][0-9]*$ ]]; then
  echo 'Usage: key-provider | download.sh TICKET RUN_ID ATTEMPT (age identity on stdin)' >&2
  exit 2
fi
ticket=$1 run=$2 attempt=$3
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
artifact="live-qa-$ticket-$run-$attempt"
gh run download "$run" --repo hypertask-ai/hypertask --name "$artifact" --dir "$tmp/download" >/dev/null
age --decrypt --identity - --output "$tmp/evidence.tar" "$tmp/download/live-qa-evidence.tar.age"
python3 - "$tmp/evidence.tar" "$HOME/.local/state/vcc-evidence/$ticket/$run-$attempt" <<'PY'
import os, pathlib, re, shutil, sys, tarfile
archive, destination = sys.argv[1:]
with tarfile.open(archive) as bundle:
    members = bundle.getmembers()
    files = []
    names = set()
    for member in members:
        if member.isdir() and member.name in ('.', './'):
            continue
        name = member.name.removeprefix('./')
        if not member.isfile() or not re.fullmatch(r'(capture-[1-9][0-9]*\.(png|webm)|metadata\.json|proof\.md)', name) or name in names:
            raise SystemExit('Refused unsafe evidence archive')
        names.add(name)
        files.append((member, name))
    if len(files) > 202 or sum(m.size for m, _ in files) > 256 * 1024 * 1024 or not {'metadata.json', 'proof.md'} <= names:
        raise SystemExit('Refused incomplete or oversized evidence archive')
    target = pathlib.Path(destination)
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    target.mkdir(mode=0o700)
    for member, name in files:
        with bundle.extractfile(member) as source, (target / name).open('xb') as output:
            shutil.copyfileobj(source, output)
        os.chmod(target / name, 0o600)
print(destination)
PY
