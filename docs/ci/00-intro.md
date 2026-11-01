# CI contract

_Last updated: 2026-10-31._

**Hypertask app CI runs on GitHub-hosted `ubuntu-latest` runners (the repository is public, so hosted minutes are free), uses a provider-neutral AI review gate, and deploys production directly from the `production` branch.** The only self-hosted runners on the Contabo host belong to the private reviewer and analytics repositories. This file is the human-readable contract; the machine-readable companion is [`docs/ci-policy.yml`](ci-policy.yml).

Each section below is its own file in `docs/ci/`, one file per topic, so two CI changes never edit
the same lines. This page is built from those files: edit the section file, then run
`node scripts/shared-lists/build.mjs --write`.
