#!/usr/bin/env bash
# Open the PR for a ticket and route the ticket to the right review lane.
# Used by both fix-bug and ship-feature-behind-flag.
#
# This script does NOT branch and does NOT commit. Do that first, then run it
# from inside the worktree with your work committed on the current branch.
#
# Run `open-pr.sh --help` for usage and examples.
set -euo pipefail

SELF="open-pr"

# Every failure says what happened and what to do about it, then exits non-zero.
shq() {  # print args as a paste-able shell command line
  local a
  for a in "$@"; do printf " '%s'" "${a//\'/\'\\''}"; done
}

die() {
  printf 'ERROR: %s Do this next: %s\n' "$1" "$2" >&2
  exit "${3:-1}"
}

require_abs() {  # value, label, next-step
  case "$1" in
    /*) ;;
    *) die "$2 must be an absolute path, got '$1'." "$3" ;;
  esac
}

show_help() {
  cat <<'EOF'
open-pr.sh - push the current branch, open its PR, and move the ticket to a
review lane. Reads the board back afterwards, so a silent board failure cannot
look like a success.

Usage:
  open-pr.sh <PREFIX-NNN> <TYPE> "<short title>" --body-file <absolute path>
             [--lane ai-review|ht-manager-review|valentin-review]
             [--remote <name>] [--base <branch>] [--dry-run] [--help]

TYPE is BUGFIX, FEATURE or INFRA. The PR title becomes "<TICKET> [<TYPE>] <title>".

--body-file is required and must be an ABSOLUTE path. The PR body has to be
written with the write-pr-summary skill, so it cannot come from
`gh pr create --fill`. The file is checked for the five write-pr-summary
sections before anything is pushed, in dry runs too.

Lanes (see ticket-lifecycle "Route the PR to the right review lane"):
  ai-review          default. Auto-merge ON. Normal bug fix or flagged
                     feature, and additive DB migrations behind a flag.
  ht-manager-review  auto-merge OFF. Destructive migration, CI or infra
                     decision, shipped-bug verification.
  valentin-review    auto-merge OFF. Money, auth, security, irreversible
                     data, product direction. Moves the ticket and posts
                     nothing else; never assigns userId 6 (Valentin,
                     2026-09-14 - only Valentin assigns himself). Post the
                     one-line question as a comment yourself.

On success it prints the PR URL, the ticket, the lane, the section the board
now reports, and the auto-merge setting.

Examples:
  # Normal bug fix, auto-merge on, default lane:
  open-pr.sh HTPR-6471 BUGFIX "stop the sidebar collapsing on reload" \
    --body-file /home/valentin/work/HTPR-6471/pr-body.md

  # Billing change parked for Valentin, rehearsed first:
  open-pr.sh HTPR-6480 FEATURE "charge per seat, not per board" \
    --body-file /home/valentin/work/HTPR-6480/pr-body.md \
    --lane valentin-review --dry-run
EOF
}

case "${1:-}" in
  --help|-h|help) show_help; exit 0 ;;
esac

[ "$#" -ge 3 ] || die "open-pr.sh needs a ticket, a TYPE and a short title, got $# argument(s)." "Run 'open-pr.sh --help' and copy one of the two examples."

TICKET="$1"
TYPE="$2"
TITLE_REST="$3"
shift 3

LANE="ai-review"
BODY_FILE=""
REMOTE="${HT_GIT_REMOTE:-origin}"
BASE="${HT_BASE_BRANCH:-production}"
DRY_RUN="no"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h) show_help; exit 0 ;;
    --lane) LANE="${2:?}"; shift 2 ;;
    --body-file) BODY_FILE="${2:?}"; shift 2 ;;
    --remote) REMOTE="${2:?}"; shift 2 ;;
    --base) BASE="${2:?}"; shift 2 ;;
    --dry-run) DRY_RUN="yes"; shift ;;
    *) die "$SELF does not know the argument '$1'." "Run 'open-pr.sh --help' for the accepted flags. Unknown flags are rejected here on purpose, unlike the hypertask CLI, which ignores them." ;;
  esac
done

case "$TICKET" in
  *-[0-9]*) ;;
  *) die "'$TICKET' is not a ticket reference." "Pass the ticket as PREFIX-NNN, for example HTPR-6471." ;;
esac

case "$TYPE" in
  BUGFIX|FEATURE|INFRA) ;;
  *) die "TYPE must be BUGFIX, FEATURE or INFRA, got '$TYPE'." "Re-run with BUGFIX for a bug, FEATURE for new behaviour, INFRA for CI and tooling." ;;
esac

case "$LANE" in
  ai-review)         SECTION="AI Review";         AUTOMERGE="yes" ;;
  ht-manager-review) SECTION="HT Manager Review"; AUTOMERGE="no" ;;
  valentin-review)   SECTION="Valentin Review";   AUTOMERGE="no" ;;
  *) die "--lane must be ai-review, ht-manager-review or valentin-review, got '$LANE'." "Use ai-review unless the change touches money, auth, security, irreversible data, or a destructive migration." ;;
esac

[ -n "$BODY_FILE" ] || die "--body-file is missing." "Write the PR body with the write-pr-summary skill, save it to an absolute path, and pass it as --body-file /absolute/path/pr-body.md."
require_abs "$BODY_FILE" "--body-file" "Re-run with the full path, for example --body-file \"\$PWD/pr-body.md\"."
[ -f "$BODY_FILE" ] || die "The body file $BODY_FILE does not exist." "Write the PR body with the write-pr-summary skill and save it to that exact path before re-running."

# Refuse a body that skips the write-pr-summary shape (see
# write-pr-summary/SKILL.md step 2). "The action line" is a first line, not
# a heading string, so it is checked by presence, not by grep; the other four
# are checked verbatim against the skill's own labels. This runs in dry runs
# too: a dry run that passes a bad body would be a lie.
MISSING=()
FIRST_LINE="$(grep -m1 -v '^[[:space:]]*$' "$BODY_FILE" || true)"
[ -n "$FIRST_LINE" ] || MISSING+=("the action line (the first non-blank line is missing)")
grep -qF "What went wrong" "$BODY_FILE" || MISSING+=("What went wrong")
grep -qF "What changes" "$BODY_FILE" || MISSING+=("What changes")
grep -qF "What you will see" "$BODY_FILE" || MISSING+=("What you will see")
grep -qF "Watch out for" "$BODY_FILE" || MISSING+=("Watch out for")
if [ "${#MISSING[@]}" -gt 0 ]; then
  printf 'ERROR: %s is missing %d write-pr-summary section(s): %s.' \
    "$BODY_FILE" "${#MISSING[@]}" "$(IFS=', '; echo "${MISSING[*]}")" >&2
  printf ' Do this next: open write-pr-summary/SKILL.md step 2, add the missing headings to the body file, then re-run this command.\n' >&2
  exit 1
fi

PR_TITLE="${TICKET} [${TYPE}] ${TITLE_REST}"

run() {  # echoes a paste-able command in dry runs, runs it otherwise
  if [ "$DRY_RUN" = "yes" ]; then
    printf 'DRY RUN:'; shq "$@"; printf '\n'
  else
    "$@"
  fi
}

if [ "$DRY_RUN" = "yes" ]; then
  run git fetch "$REMOTE" "$BASE"
  run git push -u "$REMOTE" HEAD
  run gh pr create --base "$BASE" --title "$PR_TITLE" --body-file "$BODY_FILE"
  if [ "$AUTOMERGE" = "yes" ]; then run gh pr merge --auto --squash; fi
  run hypertask task move "$TICKET" --section "$SECTION"
  run hypertask --json task get "$TICKET"
  printf 'DRY RUN OK: body file %s has all five write-pr-summary sections.\n' "$BODY_FILE"
  printf 'DRY RUN OK: %s would go to lane %s (section "%s"), automerge=%s, PR title: %s\n' \
    "$TICKET" "$LANE" "$SECTION" "$AUTOMERGE" "$PR_TITLE"
  exit 0
fi

git fetch "$REMOTE" "$BASE" \
  || die "git fetch $REMOTE $BASE failed, so the base branch is unknown here." "Check 'git remote -v' and that the branch '$BASE' exists on '$REMOTE', or pass --base with the right branch."
git push -u "$REMOTE" HEAD \
  || die "git push to $REMOTE failed, so there is nothing for GitHub to open a PR against." "Run 'git status' to confirm the work is committed, then 'git push -u $REMOTE HEAD' by hand to read the real git error."

PR_URL="$(gh pr create --base "$BASE" --title "$PR_TITLE" --body-file "$BODY_FILE" 2>&1)" \
  || die "gh pr create failed: $PR_URL" "Run 'gh auth status' and 'gh pr list --head \"\$(git branch --show-current)\"'. If a PR already exists, update it with 'gh pr edit' instead of opening a new one."
PR_URL="$(printf '%s\n' "$PR_URL" | grep -oE 'https://github\.com/[^[:space:]]+' | tail -1)"
[ -n "$PR_URL" ] || die "gh pr create returned no PR URL, so there is no PR to review." "Run 'gh pr list --head \"\$(git branch --show-current)\"' and open the PR by hand."

if [ "$AUTOMERGE" = "yes" ]; then
  gh pr merge --auto --squash \
    || die "The PR is open at $PR_URL but auto-merge could not be turned on." "Run 'gh pr merge --auto --squash' in this worktree, or leave it off and tell the review lane a human has to press merge."
else
  printf '%s: auto-merge left OFF for lane %s, a human clears this one.\n' "$SELF" "$LANE"
fi

hypertask task move "$TICKET" --section "$SECTION" \
  || die "Moving $TICKET to '$SECTION' failed, so the PR at $PR_URL is open with the ticket in the wrong column." "Run 'hypertask project sections <project id>' to see the real section names, then 'hypertask task move $TICKET --section \"<name>\"'."

# Read the board back. A silently failed move must not look like a success.
STATE="$(hypertask --json task get "$TICKET" 2>/dev/null || true)"
NOW="$(printf '%s' "$STATE" | python3 -c 'import json,sys
try:
    t = json.load(sys.stdin)["tasks"][0]
except Exception:
    print(""); sys.exit(0)
print("%s\t%s" % (t.get("section",""), ",".join(str(a.get("id")) for a in (t.get("assignees") or [])) or "none"))' 2>/dev/null || true)"
NOW_SECTION="${NOW%%$'\t'*}"
NOW_ASSIGNEES="${NOW##*$'\t'}"

[ -n "$NOW_SECTION" ] \
  || die "Could not read $TICKET back from the board after the move, so the PR at $PR_URL is unverified." "Run 'hypertask --json task get $TICKET' and confirm the section by eye before handing off."
[ "$NOW_SECTION" = "$SECTION" ] \
  || die "$TICKET is in '$NOW_SECTION', not '$SECTION', after the move, so the PR at $PR_URL is in the wrong review queue." "Run 'hypertask task move $TICKET --section \"$SECTION\"' and check 'hypertask project sections <project id>' for the exact spelling."

printf '%s: PR opened.\n' "$SELF"
printf '  pr:        %s\n' "$PR_URL"
printf '  ticket:    %s\n' "$TICKET"
printf '  section:   %s (read back from the board)\n' "$NOW_SECTION"
printf '  assignees: %s\n' "$NOW_ASSIGNEES"
printf '  lane:      %s, automerge=%s\n' "$LANE" "$AUTOMERGE"
printf '  title:     %s\n' "$PR_TITLE"
