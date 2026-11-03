// HYCI-107. One Dependabot PR must finish its own run with its lane label on it,
// and a major bump must finish with a board ticket too.
//
// Until 2026-10-29 that was two workflows chained by a label event:
// `dependabot-stack.yml` computed the lane and labelled the PR, and
// `dependabot-major-ticket.yml` reacted to the `labeled` trigger. PR 2460
// (seroval 1.6.9 -> 1.6.12) and PR 2462 (@hono/node-server 1.19.17 -> 2.1.5)
// arrived to a repository where `dependabot-stack.yml` had been disabled by hand
// on 2026-09-27, so no lane label was ever written, the second workflow never
// started, and a major bump sat five days with no owner and no ticket.
//
// So the chain is gone. This module classifies, labels, tickets and arms the
// merge in the one run the PR's own event starts, and a schedule sweeps every
// open Dependabot PR through the same code to heal what a missed event leaves
// behind. The order is deliberate: the ticket is filed even when labelling
// fails, because an owner beats a label. Anything this run cannot finish is
// commented on the PR and fails the run, so a missing lane label is a visible
// problem instead of a silent one.

const APP = "https://app.hypertask.ai";
const PROJECT_ID = 15;
const SECTION_ID = 4389;
const MARKER = "<!-- stack-upgrade-ticket -->";
const GAP_MARKER = "<!-- dependabot-lane-missing -->";
const SMALL = "stack-minor";
const MAJOR = "major-upgrade";
const DEPENDABOT = new Set(["dependabot", "dependabot[bot]", "app/dependabot"]);
const HOLD = new Set(["hold", "do-not-merge", "valentin-review", "wip", "probation"]);

const isDependabot = login => DEPENDABOT.has(String(login || "").toLowerCase());

const labelNames = pull => (pull?.labels || []).map(label => String(label?.name || "").toLowerCase());

// Below 1.0.0 semver puts breaking changes in the MINOR slot, so 0.5.x -> 0.6.0
// is a major in everything but the number.
const smallBump = (fromMajor, fromMinor, toMajor, toMinor) =>
  fromMajor === toMajor && (fromMajor !== "0" || fromMinor === toMinor);

// The grouped `stack-minor` PR carries a markdown table of every member bump.
// The group is configured for patch and minor only, but pre-1.0 packages ride it
// as semver majors, so every row is checked. A row that does not parse fails
// closed: an unreadable table is not evidence of a small bump.
function groupRows(body) {
  const rows = [];
  let malformed = 0;
  for (const line of String(body || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
    if (cells.length !== 3) {
      malformed++;
      continue;
    }
    const from = /^`([^`]*)`$/.exec(cells[1]);
    const to = /^`([^`]*)`$/.exec(cells[2]);
    if (from && to) {
      rows.push([from[1], to[1]]);
      continue;
    }
    const header = /^package$/i.test(cells[0]) && /^from$/i.test(cells[1]) && /^to$/i.test(cells[2]);
    const separator = /^:?-+:?$/.test(cells[1]) && /^:?-+:?$/.test(cells[2]);
    if (!header && !separator) malformed++;
  }
  return { rows, malformed };
}

function laneOf(pull) {
  const title = String(pull?.title || "");
  const body = String(pull?.body || "");
  if (/\bstack-minor group\b/i.test(title)) {
    const { rows, malformed } = groupRows(body);
    if (rows.length === 0 || malformed > 0) {
      return { major: true, reason: `grouped PR body had ${rows.length} readable rows and ${malformed} unreadable, so it is treated as major` };
    }
    for (const [fromCell, toCell] of rows) {
      const from = /^(\d+)\.(\d+)\./.exec(fromCell);
      const to = /^(\d+)\.(\d+)\./.exec(toCell);
      if (!from || !to) {
        return { major: true, reason: `grouped row "${fromCell}" -> "${toCell}" is unreadable, so it is treated as major` };
      }
      if (!smallBump(from[1], from[2], to[1], to[2])) {
        return { major: true, reason: `${fromCell} -> ${toCell} in the group crosses a major` };
      }
    }
    return { major: false, reason: `${rows.length} grouped bumps are all patch or minor` };
  }
  // "Build(deps): Bump <pkg> from 1.2.3 to 1.3.0". Agents retitle these PRs with
  // their ticket ("HTPR-8421 [INFRA] Bump @hono/node-server from 1.19.17 to
  // 2.1.5", PR 2462), so the version pair is matched anywhere in the title.
  const versions = /\bfrom (\d+)\.(\d+)\.\S* to (\d+)\.(\d+)\.\S*/.exec(title);
  if (!versions) {
    // Multi-package security PRs carry no versions ("Bump pacote and npm").
    // Unknown is major: a needless ticket is far cheaper than an unreviewed
    // major merge.
    return { major: true, reason: "no version pair in the title, so it is treated as major" };
  }
  const [, fromMajor, fromMinor, toMajor, toMinor] = versions;
  return smallBump(fromMajor, fromMinor, toMajor, toMinor)
    ? { major: false, reason: `${fromMajor}.${fromMinor} -> ${toMajor}.${toMinor} stays inside one major` }
    : { major: true, reason: `${fromMajor}.${fromMinor} -> ${toMajor}.${toMinor} crosses a major` };
}

function bumpLabel(title) {
  const match = /Bump ([^ ]+?)(?: (?:from|across) )/.exec(String(title || ""));
  return match ? match[1] : null;
}

function securityUpdate(body) {
  return /CVE-\d{4}-|GHSA-|security (advisory|update|vulnerabilit)/i.test(String(body || ""));
}

function ticketShape(pull) {
  const title = String(pull?.title || "");
  const token = `dep-pr-${pull?.number}`;
  const pkg = bumpLabel(title);
  const versions = /\bfrom (\S+) to (\S+)/.exec(title);
  // The dedupe token goes into the title so a retry can find the ticket even
  // when the PR link comment below never landed.
  const name = pkg && versions ? `${pkg} ${versions[1]} -> ${versions[2]}` : title;
  return {
    token,
    pkg: pkg || title,
    from: versions ? versions[1] : "?",
    to: versions ? versions[2] : "?",
    title: `Stack upgrade: ${name} [${token}]`,
  };
}

function ticketDescription({ pkg, from, to, pull }) {
  const security = securityUpdate(pull?.body)
    ? "<p><strong>Security update.</strong> Dependabot flagged an advisory on this package, so this is urgent.</p>"
    : "";
  return `<p><strong>Upgrade <code>${pkg}</code> from ${from} to ${to} and get it merged within a week.</strong></p>${security}` +
    "<p>Dependabot opened this as a major version bump, so it is deliberately NOT auto-merged. A dev takes it, reads the upstream changelog, fixes whatever breaks, and lands the PR.</p>" +
    `<ul><li><strong>Pull request:</strong> <a href="${pull?.html_url}">${pull?.html_url}</a></li>` +
    "<li><strong>Gate:</strong> checks green on the PR, then the post-deploy QA pass once it is live. The dev drives that pass.</li>" +
    "<li><strong>Do not</strong> enable auto-merge on this PR.</li></ul>";
}

const linkComment = ticket =>
  `${MARKER}\nMajor upgrade, so this PR is not auto-merged. Tracked on ${ticket}: ${APP}/detail/project-${PROJECT_ID}/${String(ticket).split("-").pop()}` +
  "\n\nA dev picks it up from the board, lands it within a week, and drives the post-deploy QA pass.";

module.exports = async function dependabotLane({
  github,
  context,
  core,
  fetchImpl = globalThis.fetch,
  env = process.env,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  const { owner, repo } = context.repo;
  const runUrl = `${context.serverUrl || "https://github.com"}/${owner}/${repo}/actions/runs/${context.runId}`;
  const patPresent = env.PAT_PRESENT === "true";
  const mcpToken = env.MCP_TOKEN || "";
  const problems = new Map();

  const log = message => core.info(message);
  const problem = (pull, message) => {
    const entry = problems.get(pull.number) || { pull, messages: [] };
    entry.messages.push(message);
    problems.set(pull.number, entry);
    core.warning(`#${pull.number}: ${message}`);
  };

  // Auto-merge is a repository setting (`allow_auto_merge`), and it is off on
  // this repository today. The last thing the old labeller did before someone
  // disabled it by hand was fail red on every small bump with "Auto merge is not
  // allowed for this repository" (runs 35813553677, 35950827293, 36089679328,
  // 36088962781); a permanent red check is what got the workflow switched off,
  // which is how the major lane lost its tickets. So the setting is read once
  // and respected: no arming, no red run, and the lane label still lands.
  let autoMergeAllowed;
  const canAutoMerge = async () => {
    autoMergeAllowed ??= github.rest.repos.get({ owner, repo })
      .then(({ data }) => Boolean(data?.allow_auto_merge))
      .catch(error => {
        log(`could not read allow_auto_merge (${error.message}); not arming auto-merge this run`);
        return false;
      });
    return autoMergeAllowed;
  };

  const getPull = async number => {
    const { data } = await github.rest.pulls.get({ owner, repo, pull_number: number, mediaType: { format: "full" } });
    return data;
  };

  async function targets() {
    if (context.eventName === "pull_request_target") {
      const number = context.payload.pull_request.number;
      try {
        return [await getPull(number)];
      } catch (error) {
        problem({ number }, `reading it failed: ${error.message}`);
        return [];
      }
    }
    // A cron is a best-effort tick on this repository: HYCI-71 measured 33 of
    // about 1049 five-minute triggers delivered, so a missed event can leave a
    // PR unlabelled for hours. The sweep is the heal path, never the main road.
    const listed = await github.paginate(github.rest.pulls.list, {
      owner, repo, state: "open", base: "production", per_page: 100,
    });
    const candidates = listed.filter(pull =>
      pull.base?.ref === "production" && pull.state === "open" && isDependabot(pull.user?.login));
    // `pulls.list` omits the body, and the body decides the grouped table and
    // the security priority, so each candidate is read in full. Dependabot's
    // own limit is three open PRs, so this stays a handful of requests. One
    // unreadable PR is a problem on that PR, never a reason to skip the others.
    const full = [];
    for (const candidate of candidates) {
      try {
        full.push(await getPull(candidate.number));
      } catch (error) {
        problem(candidate, `reading it failed: ${error.message}`);
      }
    }
    return full;
  }

  async function comments(pull) {
    const list = await github.paginate(github.rest.issues.listComments, {
      owner, repo, issue_number: pull.number, per_page: 100,
    });
    return list.map(comment => String(comment.body || ""));
  }

  async function comment(pull, body) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await github.rest.issues.createComment({ owner, repo, issue_number: pull.number, body });
        return true;
      } catch (error) {
        if (attempt === 3) {
          problem(pull, `commenting on the PR failed: ${error.message}`);
          return false;
        }
        await sleep(attempt * 5000);
      }
    }
    return false;
  }

  async function disarmAutoMerge(pull) {
    if (!pull.auto_merge) return;
    try {
      await github.graphql(
        "mutation($id: ID!) { disablePullRequestAutoMerge(input: { pullRequestId: $id }) { actor { login } } }",
        { id: pull.node_id },
      );
    } catch (error) {
      log(`#${pull.number}: disabling auto-merge reported "${error.message}"; verifying it anyway`);
    }
    let fresh;
    try {
      fresh = await getPull(pull.number);
    } catch (error) {
      problem(pull, `auto-merge may still be armed: reading it back failed (${error.message})`);
      return;
    }
    if (fresh.auto_merge) problem(pull, "auto-merge is still armed on a major upgrade");
  }

  async function armAutoMerge(pull) {
    if (pull.auto_merge) {
      log(`#${pull.number}: auto-merge already armed`);
      return;
    }
    if (pull.draft) {
      log(`#${pull.number}: draft, so auto-merge is armed once it is ready for review`);
      return;
    }
    if (!await canAutoMerge()) {
      log(`#${pull.number}: auto-merge is not allowed on this repository, so it is labelled and waits for a person`);
      return;
    }
    if (!patPresent) {
      problem(pull, "AUTOMERGE_TOKEN is empty, so auto-merge cannot be armed: a GITHUB_TOKEN merge does not start the push workflows that follow a production merge");
      return;
    }
    try {
      await github.graphql(
        "mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: SQUASH }) { pullRequest { number } } }",
        { id: pull.node_id },
      );
    } catch (error) {
      // REST reports `mergeable` as a boolean and the reason in `mergeable_state`,
      // so only a clean pull request should have been armable at all. Anything
      // else is the PR still settling and the next event or sweep picks it up.
      if (pull.mergeable_state === "clean") problem(pull, `auto-merge could not be armed: ${error.message}`);
      else log(`#${pull.number}: not armable yet (${pull.mergeable_state}): ${error.message}`);
    }
  }

  async function applyLane(pull, wanted) {
    const opposite = wanted === MAJOR ? SMALL : MAJOR;
    try {
      await github.rest.issues.addLabels({ owner, repo, issue_number: pull.number, labels: ["full-ci", wanted] });
    } catch (error) {
      problem(pull, `labelling it "${wanted}" failed: ${error.message}`);
    }
    try {
      await github.rest.issues.removeLabel({ owner, repo, issue_number: pull.number, name: opposite });
    } catch (error) {
      if (error.status !== 404) problem(pull, `removing the stale "${opposite}" label failed: ${error.message}`);
    }
    // The label is the thing that went missing for five days, so it is read
    // back rather than assumed.
    const fresh = await getPull(pull.number).catch(error => {
      problem(pull, `reading its labels back failed (${error.message}), so the "${wanted}" label is unconfirmed`);
      return null;
    });
    if (fresh && !labelNames(fresh).includes(wanted)) problem(pull, `it still carries no "${wanted}" label`);
  }

  async function mcp(path, init = {}) {
    const response = await fetchImpl(`${APP}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${mcpToken}`, "Content-Type": "application/json", ...(init.headers || {}) },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${path}`);
    return response.json();
  }

  // A failed read is never read as "no ticket yet": that would file a duplicate
  // on every rate limit, and a hidden ticket is worse than a missing comment.
  async function fileTicket(pull) {
    if (!mcpToken) {
      problem(pull, "HYPERTASK_MCP_TOKEN is empty, so no board ticket could be filed");
      return;
    }
    const shape = ticketShape(pull);
    let seen;
    try {
      seen = await comments(pull);
    } catch (error) {
      problem(pull, `reading its comments failed (${error.message}), so the duplicate check could not run and no ticket was filed`);
      return;
    }
    let ticket;
    if (seen.some(text => text.includes(MARKER))) {
      log(`#${pull.number}: already linked to an upgrade ticket`);
      return;
    }
    try {
      const search = await mcp(`/api/mcp/tasks/search?q=${encodeURIComponent(shape.token)}&project_id=${PROJECT_ID}&limit=10`);
      if (!Array.isArray(search?.tasks)) throw new Error("the board search returned no task list");
      const hit = search.tasks.find(task => String(task?.title || "").includes(`[${shape.token}]`));
      ticket = hit?.ticketNumber;
    } catch (error) {
      problem(pull, `the board search failed (${error.message}), so no ticket was filed`);
      return;
    }
    if (!ticket) {
      try {
        const created = await mcp("/api/mcp/tasks/create", {
          method: "POST",
          body: JSON.stringify({
            project_id: PROJECT_ID,
            section_id: SECTION_ID,
            title: shape.title,
            description: ticketDescription({ ...shape, pull }),
            priority: securityUpdate(pull.body) ? 1 : 0,
          }),
        });
        ticket = created?.task?.ticketNumber;
      } catch (error) {
        problem(pull, `the board ticket could not be created (${error.message}); create it by hand: ${shape.title}`);
        return;
      }
      if (!ticket) {
        problem(pull, `a ticket was created but its number could not be read: ${shape.title}`);
        return;
      }
      log(`#${pull.number}: filed ${ticket}`);
    } else {
      log(`#${pull.number}: relinking the existing ticket ${ticket}`);
    }
    if (!await comment(pull, linkComment(ticket))) {
      problem(pull, `${ticket} exists but the PR link comment failed; the next run relinks it`);
    }
  }

  async function one(pull) {
    if (pull.base?.ref !== "production" || (pull.state && pull.state !== "open")) {
      log(`#${pull.number}: not an open pull request to production`);
      return;
    }
    if (!isDependabot(pull.user?.login)) {
      log(`#${pull.number}: not a Dependabot pull request`);
      return;
    }
    const { major, reason } = laneOf(pull);
    log(`#${pull.number}: ${major ? MAJOR : SMALL} because ${reason}`);
    const held = labelNames(pull).some(label => HOLD.has(label));
    if (major) {
      // Safety and ownership before bookkeeping: an armed major is disarmed and
      // an owner exists whatever happens to its labels, and a hold label is a
      // reason to leave the labels alone, never a reason to skip either.
      await disarmAutoMerge(pull);
      await fileTicket(pull);
      if (held) {
        log(`#${pull.number}: a hold label is present, so its lane labels are left alone`);
        return;
      }
      await applyLane(pull, MAJOR);
      return;
    }
    if (held) {
      log(`#${pull.number}: a hold label is present, so the lane is left alone`);
      return;
    }
    await applyLane(pull, SMALL);
    await armAutoMerge(pull);
  }

  const pulls = await targets();
  log(`${pulls.length} Dependabot pull request(s) to settle (${context.eventName}).`);
  for (const pull of pulls) {
    try {
      await one(pull);
    } catch (error) {
      problem(pull, `this run stopped on it: ${error.message}`);
    }
  }

  // A lane label this run could not write is the PR 2460/2462 incident
  // repeating, so it is said on the PR itself and fails the run: red in Actions,
  // visible on the PR, retried by the next sweep.
  for (const { pull, messages } of [...problems.values()]) {
    const existing = await comments(pull).catch(() => null);
    if (existing && existing.some(text => text.includes(GAP_MARKER))) continue;
    await comment(pull, `${GAP_MARKER}\nThe Dependabot lane guard could not settle this upgrade PR:\n\n` +
      messages.map(message => `- ${message}`).join("\n") +
      `\n\nThe sweep retries every fifteen minutes. Run: ${runUrl}`);
  }
  if (problems.size > 0) {
    core.setFailed(`Dependabot lane left ${problems.size} pull request(s) unfinished: ${
      [...problems.values()].map(({ pull, messages }) => `#${pull.number} ${messages.join("; ")}`).join(" | ")}`);
  }

  return { checked: pulls.length, problems: problems.size };
};

module.exports.laneOf = laneOf;
module.exports.groupRows = groupRows;
module.exports.ticketShape = ticketShape;
module.exports.ticketDescription = ticketDescription;
module.exports.linkComment = linkComment;
module.exports.securityUpdate = securityUpdate;
module.exports.isDependabot = isDependabot;
module.exports.LANES = { SMALL, MAJOR };
module.exports.MARKERS = { MARKER, GAP_MARKER };
