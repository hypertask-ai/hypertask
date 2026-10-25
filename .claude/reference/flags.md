# Flag-release detail

Read [Feature flags](#feature-flags-for-new-user-facing-behavior) and verify-qa Released flags for defaults, exceptions, cleanup and emergency flag-off.

Test click removed (Valentin 2026-10-21); safety is flags, revert, live QA after release and the YPER4-550 screenshot check.

New feature and improvement flags set `defaultMode: "EVERYONE"` in their definition file, so the change is live at once and can still be switched off in seconds (Valentin, 2026-10-20, HTPR-7389: "we set it to live right away for everyone by default unless there is a REAL STRONG reason not to"). Exceptions are `kind: "internal"` and a flag whose `releaseRisk.highRisk` names one of four high-risk kinds: `money`, `access` (login and access), `data-deletion` or `customer-email`. High-risk flags set `defaultMode: "OWNER_AND_QA"` and get an independent model review (Fable in CLAUDE mode, Codex gpt-6.1-sol in CODEX mode) plus one HT Product Lead check before anyone asks Valentin to release them. When unsure whether a ticket is high risk, ask that review model and HT Product Lead. Existing flags keep their current mode. Switching an existing flag still needs his thumbs up (Switching flags in /ship).

No feature ships Off (Valentin, 2026-10-30, HTPR-7980: "We're not releasing features to off. We're only releasing to me or to everyone."). A new flag goes live in its default mode on merge: `EVERYONE`, or `OWNER_AND_QA` for high-risk and internal flags. Never ask Valentin to turn a feature on for himself and QA: that mode is the release, not a decision. The only release question for him is moving from `OWNER_AND_QA` to `EVERYONE`. `OFF` is only the emergency switch after failed live QA.

Only for Valentin's own explicit request, a new flag may instead use `defaultMode: "OWNER_ONLY"` with `releaseRisk.ownerRequest: { quote: "<his exact request>", ticketUrl: "<ticket link>" }`: the quote must be non-blank and the link must match `^https://app\.hypertask\.ai/detail/project-\d+/\d+$`. This exception permits only Owner only, not Owner + QA or Off, and does not replace required `releaseRisk.highRisk` metadata.

Only saved-data, security and crash fixes skip the flag. Legal, privacy, compliance and urgent work still get one; urgent or explicitly requested work may go to Everyone at once through a `Question: Switch <flag-key> to Everyone?` thumbs up, keeping `kind` honest ([Feature flags](#feature-flags-for-new-user-facing-behavior); YPER4-418, YPER4-419). `feature-flag-gate` fails a `[BUGFIX]` or `[INFRA]` PR that shows existing UI in new places or to more users without a ticket flag.

New or changed visible UI needs Valentin's yes on a clickable wireframe on its ticket or its direct parent before code: load `wireframe`, then move to **UX Sign-off** (board 15 column 22502); the `ux-signoff` status enforces this, except for provable flag-removal-only diffs deleting definitions whose trusted production modes are `EVERYONE` and retaining exactly the flag-on UI (new visible UI still needs sign-off). A `[BUGFIX]` restoring intended behaviour is exempt from wireframe sign-off, but every new component file needs his yes naming it (Valentin, 2026-10-10). A PR that adds no new component file under `src/components/` (only reused UI) is also exempt and ships behind its ticket flag, which `feature-flag-gate` checks (Valentin, 2026-10-23, YPER4-627: "i think this stuff can go straight to live for everyone i don't want flag pile ups anymore" and "we just need to make sure its FAST REVERTABLE with a flag").

The `ux-signoff` gate accepts `https://hypertask.app/wireframes/<id>`, `https://hypertask.app/explorations/<id>` and `https://claude.ai/artifact/<id>`. It checks each ticket thread separately: the wireframe and approval must be on the same ticket. Only Valentin’s own human account approves (including “agree”, “agreed” / “Agree to ux though”); agent-authored quotes do not count, and rejection words such as “no”, “not”, “but”, “change” and “instead” still win, so a mixed answer such as “Agreed but ... pls create a new ticket” needs his 👍 on a wireframe or Question comment (YPER4-593: text alone cannot tell a deferred request from a change to this design). Parent lookup uses `/api/mcp/tasks?ticket_number=…` → `parent_task.ticketNumber`, never an inferred ticket number. His own 👍 or ✅ also approves an agent comment starting `Question:` posted after the newest wireframe comment, when the reaction is newer than the Question's last edit, the Question has a `Yes:` line, links the current wireframe or that wireframe's comment (`#comment-<id>`), and its question line is exactly `May <slice> ship with the new parts named here: <Name>, <Name>?` naming every new component the PR adds (no negative, test-only or deferring words in `<slice>`); such a Question approves those names, and `New elements:` names from earlier comments with the same wireframe link carry over (YPER4-591). Reactions by agents acting as him never count.

## Shapes accepted by feature-flag-gate

The trusted gate starts from a live ticket-specific branch. Coverage follows that file’s imports through changed UI files, recursively. It does not flow back from an imported hook to its consuming component. A gated API route can also cover changed UI files that reference it through that import tree. Arbitrary context data flow is not proof. Gate the actual behavior; an unused flag read does not count. Server authorization still needs its own flag check.

These examples use the synthetic `OTHER_FLAG` from the gate tests. Replace it with your ticket's real flag constant. `Row`, `items`, `remove`, and `subscribe` represent existing app code, not new shared controls. Tests run these exact examples through `.github/scripts/feature-flag-gate.mjs`.

### Props: branch in the live component

A conditional callback prop counts when the flag branch is inside the live component. When Off, the existing row remains without its new action. The same expression inside an untracked `.map()` callback does not count.

```tsx flag-gate:prop
import { useFlag } from "@/hooks/useFlag";
import { OTHER_FLAG } from "@/lib/flags/keys";

declare function Row(props: { onDelete?: () => void }): JSX.Element;
declare function remove(): void;

export function Widget() {
  const enabled = useFlag(OTHER_FLAG);
  return <Row onDelete={enabled ? remove : undefined} />;
}
```

A flag check inside a named handler also counts when a live JSX attribute references that handler. A function child of a consumed custom component also counts, including nested render children. Discarded JSX, unreachable callbacks, intrinsic-element function children, and shadowed flag bindings do not count. An unused handler does not count. This protects the action, not the visibility of its control.

Changed exported components can reach their gate through private components and helpers in the same file. Unchanged sibling exports need no new ticket gate. Changed ungated sibling exports still block the file; a gate in an unrelated export does not cover them.

### Effects: select the callback, not the hook

The gate does not treat a branch hidden inside a `useEffect` callback as a live flag branch. Select the callback at the component's top level. Call `useEffect` unconditionally, keep its dependencies complete, and retain subscription cleanup.

```tsx flag-gate:effect
import { useEffect } from "react";
import { useFlag } from "@/hooks/useFlag";
import { OTHER_FLAG } from "@/lib/flags/keys";

declare function subscribe(): () => void;

export function Widget() {
  const enabled = useFlag(OTHER_FLAG);
  useEffect(enabled ? () => subscribe() : () => {}, [enabled]);
  return <div />;
}
```

### Mapped rows: keep the branch in the live component

An inline `.map()` callback is not a tracked live function. Build the rows with a loop so the flag branch remains inside the exported component. Off still renders every existing row, without the new action. Read the flag once, outside the loop.

```tsx flag-gate:rows
import { useFlag } from "@/hooks/useFlag";
import { OTHER_FLAG } from "@/lib/flags/keys";

declare const items: { id: string; title: string }[];
declare function remove(id: string): void;

export function Widget() {
  const enabled = useFlag(OTHER_FLAG);
  const rows = [];
  for (const item of items) {
    rows.push(
      <div key={item.id}>
        {item.title}
        {enabled && <button onClick={() => remove(item.id)}>Delete</button>}
      </div>,
    );
  }
  return <>{rows}</>;
}
```

For a cross-file hook or context change, a gate inside the hook alone does not cover its changed consumer. Put the branch around the consumer's new behavior; its changed imports then receive coverage. Keep any independent hook behavior gated too. Do not move a hook into a condition or add a flag read unrelated to the changed behavior just to satisfy CI.

Run `npm run test:file -- tests/feature-flag-gate.test.cjs` on an allowed development host. On the VPS, use the PR's hosted CI result. The `documented flag-gate shapes` tests check these examples, their ungated variants, and the unsupported mapped-prop, effect, and map callback shapes. Mechanical acceptance does not replace flag-on and flag-off behavior tests.

## Feature flags for new user-facing behavior

Use one ticket-specific flag for new features, deliberate behavior/design changes, and ordinary bug fixes. A bug fix restores intended behavior; showing existing UI in new places or to more people is new behavior. Review the actual diff, not just its title.

- Add one client-safe definition file and its own tests. Never edit shared registry lists or commit generated indexes. Follow [the registry reference](../../docs/feature-flags.md).
- Keep kind honest: feature, improvement, bugfix, or internal. New feature, improvement, and bugfix flags default to Everyone unless high-risk or internal. Existing modes stay unchanged.
- Money, login/access, deletion, and customer-email work must declare high-risk metadata, default Owner + QA, and receive independent review plus an HT Product Lead check before release approval. Never omit risk to obtain Everyone.
- Owner only requires Valentin's explicit request, exact quote, and matching ticket URL in owner-request metadata. It does not waive high-risk metadata.
- Saved-data, security, and crash fixes need no bugfix flag. Other exemptions: identical-output performance work, dependencies, CI, spelling, and tickets labeled **AI CHAT 💬**. Same-provider model replacements with unchanged slots, plan gating, and fallback are dependency updates. Urgency, legal, privacy, and compliance are not exemptions.
- Infra/plumbing work, including the Agent Kit, has no product flag. Product-visible work discovered on board 4060 needs a linked board-15 ticket and its flag.
- Gate protected behavior on the server. A hidden client control is not authorization. API-only changes still need semantic flag review even when outside the mechanical gate.
- Reused UI needs no wireframe. A new component file still needs Valentin's design approval naming it. Follow current house rules for Figma proposals.
- Existing flag switches follow /ship approval rules. When flagged behavior fails, a flag-owner write/admin agent holds it at Owner + QA with a failure reason first, then repairs. Runners never switch a flag Off; Off is Valentin's own safety switch. This emergency path includes high-risk and bugfix flags; never re-enable automatically after a hold.
- After release, post the flag's dedicated link, key, purpose, and required Valentin mention on the ticket. Keep its flag link in the description.
- A flagged ticket reaches Done after live QA passes in its declared mode. Do not request release permission by parking it in Valentin Review.

| Rule | Enforcement |
|---|---|
| Ticket-named flag, valid defaults, and changed-UI coverage | `feature-flag-gate`; semantic review still required |
| New component design approval | `ux-signoff`, advisory status plus owner policy |
| Mechanical BUGFIX/INFRA/REFACTOR exemptions do not waive policy | Flag gate plus owner review |
| Cleanup after 7 days for bugfixes, otherwise 14; money/access/deletion stay 14 | Feature-flag-removals cron files up to 10 tickets daily; never switches flags |

Mechanical title exemptions are bounded heuristics, not permission to omit a required flag. Never retitle a PR or weaken a check to pass it. See [flag-release detail](../../.claude/reference/flags.md) and the gate implementation for syntax and thresholds.

