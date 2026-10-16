# Flag-release detail

Read AGENTS.md Feature flags and verify-qa Released flags for defaults, exceptions, cleanup, premerge recording and emergency flag-off.

Developers never switch a feature flag to Everyone: Valentin decides on the ticket and his Claude session switches it.

Only saved-data, security and crash fixes skip the flag. Legal, privacy, compliance and urgent work still get one; urgent or explicitly requested work may go to Everyone at once with `ht-flag set <flag-key> everyone`, linking an unedited comment on the flag's own ticket that Valentin wrote himself or that quotes him and carries his thumbs up (else a `Question: Switch <flag-key> to Everyone?` thumbs up), keeping `kind` honest (AGENTS.md, Feature flags; YPER4-418, YPER4-419). `feature-flag-gate` fails a `[BUGFIX]` or `[INFRA]` PR that shows existing UI in new places or to more users without a ticket flag.

New or changed visible UI needs Valentin's yes on a clickable wireframe on its ticket before code: load `wireframe`, then move to **UX Sign-off** (board 15 column 22502); the `ux-signoff` status enforces this. A `[BUGFIX]` restoring intended behaviour is exempt from wireframe sign-off, but every new component file needs his yes naming it (Valentin, 2026-10-10).
