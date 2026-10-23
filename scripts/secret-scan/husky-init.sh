# Sourced through husky v9's init.sh before every hook in repos that use it (their local hooks
# path skips the global one). Runs the same key scan before a commit (YPER4-324).
# Husky skips init.sh when the repo has no .husky/pre-commit file, so such a repo has CI only.
if [ "$n" = pre-commit ]; then
  "${XDG_CONFIG_HOME:-$HOME/.config}/git/hooks/scan-staged" || exit 1
fi
