# Feature flags

Register product flags in `src/lib/flags/definitions.ts`, using constants from `src/lib/flags/keys.ts`. Keep entries in their existing order and format. `src/lib/flags.ts` keeps runtime defaults, server APIs and public exports, including key constants and `FeatureFlagKind`.

New features and improvements default to Owner + QA. Bugfix flags use `kind: "bugfix"` and default to Everyone unless an explicit `defaultMode` overrides it. Infra tickets do not add a flag.

The CI feature-flag gate and ship-check accept definitions in either the new module or the legacy inline registry so rebased PRs can still be checked. `premerge-evidence.py` invokes ship-check, and the feature-flag reconciliation job invokes the same CI gate; neither has a separate registry parser.
