export GH_API_RETRY_STATE="$gate_tmp/github-api-budget.json"
printf '{"waited":0,"deadline":%s}\n' "$(( $(date +%s) * 1000 + ${GH_API_TIME_BUDGET_SECONDS:-480} * 1000 ))" >"$GH_API_RETRY_STATE"

gh_api() {
  local result=0
  node .github/scripts/github-rate-limit.mjs "$@" || result=$?
  # Calls stay in the main shell so exhaustion exits the pass, not a substitution.
  if [ "$result" -eq 78 ]; then
    if [ "${gh_api_failed:-0}" -ne 0 ] || [ "${failures:-0}" -gt 0 ]; then
      exit 2
    fi
    exit 0
  fi
  if [ "$result" -ne 0 ]; then gh_api_failed=2; fi
  return "$result"
}
