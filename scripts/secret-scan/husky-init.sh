# Sourced by husky v9 before every hook in repos that use it (their local hooks path skips the
# global one). Runs the same key scan before a commit (YPER4-324).
if [ "$n" = pre-commit ]; then
  "${XDG_CONFIG_HOME:-$HOME/.config}/git/hooks/scan-staged" || exit 1
fi
