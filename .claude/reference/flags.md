# Flag-release detail

Read AGENTS.md Feature flags and verify-qa Released flags for defaults, exceptions, cleanup, premerge recording and emergency flag-off.

Developers never switch a feature flag to Everyone: Valentin decides on the ticket and his Claude session switches it.

New or changed visible UI needs Valentin's yes on a clickable wireframe on its ticket before code: load `wireframe`, then move to **UX Sign-off** (board 15 column 22502); the `ux-signoff` status enforces this. A `[BUGFIX]` restoring intended behaviour is exempt from wireframe sign-off, but every new component file needs his yes naming it (Valentin, 2026-10-10).
