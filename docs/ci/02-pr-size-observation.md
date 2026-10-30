## PR size observation (YPER4-711)

- Trusted production code counts additions and deletions.
- One config excludes generated and fixture files.
- Renames crossing exclusion boundaries still count.
- Incomplete measurements produce errors, never passing counts.
- First phase: reporting only; merging stays unchanged.
- No automatic cutoff or `size-ok` approval exists.
- Artifacts preserve each head, count and verdict.
- Artifact name: `pr-size-<PR>-<run>`; retention: 14 days.
- Post seven full days of ticket observations.
- Then independently review blocking and human approval.
- Existing required checks stay unchanged.

