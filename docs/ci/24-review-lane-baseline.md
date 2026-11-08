## Review-lane baseline

Historical, kept for comparison: the self-hosted review lane is retired and AI review is now Codex's built-in GitHub review (see the Review gate section). Before the second dedicated runner was restored, the latest 100 AI-review workflow runs had **0 seconds p50 queue time, 398 seconds p95, and 1,019 seconds maximum**. Review execution was 124 seconds at p50. The review lane currently runs as a single runner (`contabo-1`) under the separate `htreviewrunner` OS identity; the live `/ci` page alerts when that lane goes offline.
