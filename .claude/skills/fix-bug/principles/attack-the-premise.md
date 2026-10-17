# Attack the Premise

When two fixes that share one belief have both failed the same check, or both been undone after shipping, suspect the belief, not the fixes.

**Why:** Each failed fix is evidence against what it assumed. A third fix on the same belief spends effort where the evidence already says the cause is not.

**Pattern:**
- **Write the belief down.** One sentence that every failed fix assumed, for example "the open is slow because the snapshot arrives late".
- **Test it before the next fix.** Find an observation that would come out differently if the belief were false, and make it on the real path: a trace, a timing, a log line. Look at how the failures spread (which devices, which data sizes, first or second run), not only at how big they are. Keep the check rerunnable.
- **Follow the evidence.** If it contradicts the belief, the cause is elsewhere: look for what the failures share that the belief did not predict. If it confirms the belief, ask the next "why" per `fix-root-causes.md`; the earlier fixes may have treated a consequence.
- **Remove the condition instead of compensating for it.** A hold, retry or cleanup that works around the cause leaves the cause in place and adds work on every run.

**Stop:** do not start a third fix before the belief is written in this session's notes and tested.

Source: adapted from pstack principle-attack-the-premise, https://github.com/cursor/plugins/tree/main/pstack.
