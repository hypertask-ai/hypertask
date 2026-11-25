# CI Node-version guard

## How a customer reaches it

The Node version guard job in a pull request's GitHub checks. It compares package.json engines.node and every workflow node-version with the live hypertasks-prod Vercel project setting. This is infrastructure, with no app UI or account writes.

## How to drive it

After the guard is merged and its production deployment succeeds, branch a throwaway PR from current production. Change only package.json engines.node to a different major from the live Vercel setting, such as 22.x when Vercel is 24.x. Open a non-draft PR targeting production. Never merge this PR.

Wait for the Node version guard job to finish and read its comparison-step log. Confirm it fails specifically on package.json engines.node, naming both the proposed and live Node versions. The unchanged production PR is the positive control: its guard must pass.

## What usually breaks

- Comparing with a hard-coded expected major instead of the live API value.
- Ignoring workflow pins or YAML's quoted, inline and alias forms.
- Treating absent API credentials or invalid nodeVersion as a pass.
- Giving the Vercel token to PR comparison scripts or dependency installation.

## What proof to collect

Checklist written before QA; real check-run metadata and comparison-step logs for the positive and negative controls; closed throwaway PR metadata and confirmation its remote branch no longer exists. Doctor: merge SHA production deployment success, login HTTP 200, and /my-tasks signed in with a QA account. Capture desktop 1440x900 and phone 390x844 doctor screenshots, plus a short video. Record account id and tier, never credentials. Publish a self-contained HTML report and attach proof and key media to the ticket.

## Cleanup

Close the throwaway PR and delete only its own branch. No QA board or production settings are changed.
