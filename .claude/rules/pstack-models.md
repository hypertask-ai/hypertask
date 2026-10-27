# pstack model configuration for Hypertask. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the parent session model (omit Agent `model`). Alias entries in a panel list still count toward its fan-out.
# Owner rules: subscription only, never fast mode, no Fable. Most tokens go to Sonnet; Opus only at medium for judgment.
# budget: medium (high). Opus roles pinned to medium by owner choice.
feature, refactoring: sonnet high
bug-fix: sonnet high
perf-issue: sonnet high
hillclimb: sonnet high
judgment and prose: opus medium
hardest tasks: opus medium
how explorer: haiku high
how explainer: opus medium
why investigators: haiku high
why synthesizer: opus medium
reflect tooling: haiku high
reflect judgment, divergent, synthesizer: opus medium
arena runners: sonnet high, sonnet high
arena cross-judge pool: opus medium
swarm workers: sonnet high
architect runners: sonnet high, opus medium
interrogate reviewers: opus medium
