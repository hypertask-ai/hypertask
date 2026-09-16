#!/usr/bin/env bash
# Sanity checks for the product skill pack in .claude/skills/.
#
# No dependencies beyond bash, grep, and sed: no jq, no python, no network.
# Runs from anywhere; resolves the repo root from its own location so it
# works the same locally and in CI.
#
# Checks:
#   A. Every row of INDEX.md's | Name | Trigger | Path | table names a Path
#      that exists on disk.
#   B. Every .claude/skills/*/SKILL.md is listed as a Path in that table, so
#      a new skill can't be added without a row.
#   C. Every repo-relative .claude/skills/... path a skill names (ending in
#      .sh, .md, .py or .ts) exists.
#   D. Every board column a skill names in a --section flag exists in
#      board.yml (repo root) or .claude/board.yml, whichever exists.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SKILLS_DIR="$REPO_ROOT/.claude/skills"
INDEX="$SKILLS_DIR/INDEX.md"

FAILS=0
CHECKS=0

# Skills that predate this INDEX.md and are not governed by it: general
# Claude Code skills invoked as slash commands, not Product Bot's
# ticket-routing table. Add a name here only with a reason.
#   prototype - HTPR-5931, a /prototype slash-command skill, unrelated to
#   the Product Bot routing this INDEX.md documents.
EXEMPT_SKILLS=(prototype)

is_exempt() {
  local name="$1" ex
  for ex in "${EXEMPT_SKILLS[@]}"; do
    [ "$name" = "$ex" ] && return 0
  done
  return 1
}

# ---------------------------------------------------------------------------
# A. INDEX rows resolve.
# ---------------------------------------------------------------------------
CHECKS=$((CHECKS + 1))
a_fail=0
a_count=0
in_table=0
while IFS= read -r line; do
  if [ "$line" = "| Name | Trigger | Path |" ]; then
    in_table=1
    continue
  fi
  if [ "$in_table" -eq 1 ]; then
    case "$line" in
      '|---|---|---|')
        continue
        ;;
      '|'*'|'*'|'*)
        ;;
      *)
        in_table=0
        continue
        ;;
    esac
    path="${line##*|}"          # nothing after the last |
    rest="${line%|*}"           # drop trailing empty field
    path="${rest##*|}"          # the Path column
    path="$(echo "$path" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    [ -z "$path" ] && continue
    a_count=$((a_count + 1))
    if [ ! -f "$REPO_ROOT/$path" ]; then
      echo "FAIL A: INDEX.md row names a Path that does not exist: $path"
      a_fail=1
    fi
  fi
done < "$INDEX"
if [ "$a_count" -eq 0 ]; then
  echo "FAIL A: no rows found in INDEX.md's Name/Trigger/Path table"
  a_fail=1
fi
if [ "$a_fail" -eq 0 ]; then
  echo "PASS A: INDEX rows resolve ($a_count rows)"
else
  echo "FAIL A: INDEX rows resolve"
  FAILS=$((FAILS + 1))
fi

# ---------------------------------------------------------------------------
# B. Every SKILL.md is indexed.
# ---------------------------------------------------------------------------
CHECKS=$((CHECKS + 1))
b_fail=0
b_count=0
while IFS= read -r -d '' f; do
  rel="${f#"$REPO_ROOT"/}"
  name="$(basename "$(dirname "$f")")"
  is_exempt "$name" && continue
  b_count=$((b_count + 1))
  if ! grep -qF "$rel" "$INDEX"; then
    echo "FAIL B: $rel is not listed as a Path in INDEX.md"
    b_fail=1
  fi
done < <(find "$SKILLS_DIR" -mindepth 2 -maxdepth 2 -name 'SKILL.md' -print0 | sort -z)
if [ "$b_fail" -eq 0 ]; then
  echo "PASS B: every SKILL.md is indexed ($b_count checked)"
else
  echo "FAIL B: every SKILL.md is indexed"
  FAILS=$((FAILS + 1))
fi

# ---------------------------------------------------------------------------
# C. Scripts a skill names exist.
# ---------------------------------------------------------------------------
CHECKS=$((CHECKS + 1))
c_fail=0
c_count=0
c_skipped=0
while IFS= read -r match; do
  [ -z "$match" ] && continue
  case "$match" in
    'http'*|'~'*|'/'*|'$'*)
      # Points outside this repo (an absolute path, a home-dir path, an env
      # var expansion, or a URL) -- deliberately not checked here.
      c_skipped=$((c_skipped + 1))
      continue
      ;;
  esac
  c_count=$((c_count + 1))
  if [ ! -f "$REPO_ROOT/$match" ]; then
    echo "FAIL C: referenced path does not exist: $match"
    c_fail=1
  fi
done < <(grep -rhoE '[A-Za-z0-9_.$~:/-]*\.claude/skills/[A-Za-z0-9_./-]+\.(sh|md|py|ts)' "$SKILLS_DIR" | sort -u)
if [ "$c_fail" -eq 0 ]; then
  echo "PASS C: scripts a skill names exist ($c_count checked, $c_skipped skipped as outside the repo)"
else
  echo "FAIL C: scripts a skill names exist"
  FAILS=$((FAILS + 1))
fi

# ---------------------------------------------------------------------------
# D. Board columns a skill names exist.
# ---------------------------------------------------------------------------
CHECKS=$((CHECKS + 1))
# The agent template lays board.yml down at the repo root; supervise-board's
# own board files live under .claude/. Take whichever this repo has, or the
# check never runs on a synced repo.
BOARD=""
for candidate in "$REPO_ROOT/board.yml" "$REPO_ROOT/.claude/board.yml"; do
  [ -f "$candidate" ] && { BOARD="$candidate"; break; }
done
if [ -z "$BOARD" ]; then
  echo "SKIP D: no board.yml at the repo root or under .claude/"
else
  d_fail=0
  d_count=0
  # Two shapes. supervise-board's board files nest "title:" under columns:; the
  # agent-template skeleton maps a role to a section name directly under roles:.
  columns="$( { sed -n '/^columns:/,$p' "$BOARD" | grep -oE 'title:[[:space:]]*.*' \
                  | sed -E 's/title:[[:space:]]*//'
                sed -n '/^roles:/,/^[^[:space:]]/p' "$BOARD" \
                  | sed -nE 's/^[[:space:]]+[a-z_]+:[[:space:]]*(.+)$/\1/p'
              } | sed -E 's/^"//; s/"$//; s/^'"'"'//; s/'"'"'$//' | sed '/^$/d')"
  while IFS= read -r section; do
    [ -z "$section" ] && continue
    # A shell variable stands in for the column name at that call site; only the
    # runtime value is a real section, and this check cannot see it.
    case "$section" in *'$'*|*'{{'*) continue ;; esac
    d_count=$((d_count + 1))
    if ! printf '%s\n' "$columns" | grep -qF "$section"; then
      echo "FAIL D: skill names board section '$section', not a column in ${BOARD#"$REPO_ROOT"/}"
      d_fail=1
    fi
  done < <(grep -rhoE -- '--(to-)?section[[:space:]]+"[^"]+"' "$SKILLS_DIR" \
    | sed -E 's/--(to-)?section[[:space:]]+"([^"]+)"/\2/' | sort -u)
  if [ "$d_fail" -eq 0 ]; then
    echo "PASS D: board columns a skill names exist ($d_count checked)"
  else
    echo "FAIL D: board columns a skill names exist"
    FAILS=$((FAILS + 1))
  fi
fi

echo "---"
echo "$((CHECKS - FAILS))/$CHECKS checks passed"
[ "$FAILS" -eq 0 ]
