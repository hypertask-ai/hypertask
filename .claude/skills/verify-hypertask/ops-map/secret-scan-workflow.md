# Secret scan workflow installer

## How a customer reaches it

`scripts/secret-scan/install-workflow <repo checkout>` installs the gitleaks and trufflehog workflow (`.github/workflows/gitleaks.yml`) into a repo agents push to. It reads the repo's visibility from GitHub and refuses unknown values. Every visibility gets `runs-on: ubuntu-latest`; CI on the VPS is forbidden. This is infrastructure, with no app UI or account writes.

## How to drive it

From merged production (`git archive origin/production scripts/secret-scan`), run `install-workflow.test.sh`, then run the installer against an empty checkout whose `origin` is a private hypertask-ai repo (for example analytics) and against one whose `origin` is a public repo (hypertask). Both installs must be byte-identical to the template and use `ubuntu-latest`. In a real private repo, the next push or PR must run the `secret-scan` job on GitHub-hosted runners and pass.

## What usually breaks

- Unreadable visibility (gh not signed in, no `origin`): the installer must refuse and leave any existing workflow untouched, never guess.
- The template's `runs-on: ubuntu-latest` line changing shape: the installer must refuse rather than silently write a paid runner into a private repo.
- A private repo install that names a self-hosted runner (re-registers VPS CI).

## What proof to collect

Checklist written before QA; output of the merged-production test and both installs; one private repo `secret-scan` run on GitHub-hosted runners. Doctor: merge SHA production deployment success, login HTTP 200, and /my-tasks signed in with a QA account with a desktop screenshot. Record account id, never credentials.

## Cleanup

Delete the temporary checkouts. No repo settings, secrets or boards change.
