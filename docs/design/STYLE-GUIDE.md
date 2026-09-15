# Hypertask design gate

This is the checkable subset of the visual contract, written for the design
gate and for whoever is about to change a screen.

**`openwiki/style-guide.md` is canonical.** It carries the full contract: every
colour token per theme, the icon sizes, the button hierarchy, the mobile
comment field reference implementation, and the pull request review contract.
This file restates only what the gate checks, adds the component-per-job table
and the reference screens, and defers to the canonical guide for everything it
omits. When the two disagree, the canonical guide wins and this file is wrong.

`docs/design/tokens.json` is the token manifest. It points at the real sources
rather than forking them, because a copied palette rots. Per-theme colour
values live in `src/styles/tailwindThemes/*.css`; utilities live in
`tailwind.config.ts`.

## The scales

| Axis | Values | Source |
|---|---|---|
| Type | `text-micro` 11, `text-meta` 12, `text-dense` 13, `text-content` 14, `text-emphasis` 16, `text-subheading` 18, `text-heading` 24, `text-display` 32 | `tailwind.config.ts` |
| Radius | 2px badges, 4px compact controls, 5px cards and modals, `rounded-full` avatars and dots | `openwiki/style-guide.md` |
| Spacing | 4px base: 4, 8, 12, 16, 20, 24, 32. 2px and 6px half steps for compact internal alignment | Tailwind default scale |
| Colour | Semantic utilities only: `bg-pageBackground`, `bg-cardBackground`, `bg-modalBackground`, `text-white-black`, `text-text-light-gray`, `border-border-light-gray-thin`, `bg-shadcn-primary` | theme CSS files |
| Icons | `lucide-react` at 14, 16, 18, 20, 22. Stroke 1.5 from the theme | `openwiki/style-guide.md` |

Brand accents are `hypertasks-purple` `#4455BB`, `hypertasks-green` `#C2CFA5`,
`hypertasks-ai-purple` `#C668FF`, `hypertasks-header-blue` `rgb(35, 131, 226)`.
They are accents. They never replace a themed surface or text token.

## Canonical component per job

Reach for the component in this table before writing a new one. Where the table
says none, there is genuinely no primitive: copy the nearest existing
composition rather than inventing a look, and say in the pull request which
call site you copied.

| Job | Component | Path |
|---|---|---|
| Modal shell | `ModalContainerCustom` | `src/components/Common/CommonModalComponents/index.tsx` |
| Text input inside a modal | `ModalInput` | `src/components/Common/CommonModalComponents/index.tsx` |
| Confirm dialog | `ConfirmDialog` | `src/components/Modals/Common Modals/ConfirmDialog.tsx` |
| Toast | `react-hot-toast` `toast()` | no in-house wrapper; call the library directly |
| Kanban task card | `KanbanTaskCard` | `src/components/PageComponents/Kanban/KanbanTaskComponents/KanbanTaskCard.tsx` |
| List or table row | `TaskListRow` | `src/components/Common/TaskRowComponents/TaskListRow.tsx` |
| Avatar, user and agent | `UserAvatar` (pass `agentId` for an agent) | `src/components/Common/UserAvatar.tsx` |
| Chip, label, pill | `LabelWrapper` | `src/components/Labels/LabelWrapper.tsx` |
| Tooltip | `Tooltip` | `src/components/Common/Tooltip.tsx` |
| Button | **none** | there is no Button primitive. Match the nearest existing action, and keep one primary per control group. |
| Dropdown, menu, popover | **none** | not standardised. Match the nearest existing picker rather than adding a kit. |

A new affordance normally enters through a keyboard shortcut, the Ctrl+K
command palette, and the `?` cheatsheet, not a new visible control. See
`docs/DESIGN.md` for how to register one.

## Match these screens

New and changed UI has to look like it belongs next to these. Open the real
thing before you draw anything; never design from memory.

| Screen | Route | Entry component |
|---|---|---|
| Kanban board | `/[...boardURL]` | `src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx` |
| Task detail | `/detail/[...slug]` | `src/app/detail/[...slug]/TaskDetailComp.tsx` |
| Inbox | `/inbox` | `src/app/inbox/Inbox.tsx` |
| Settings | `/settings/[[...section]]` | `src/components/Modals/Settings/SettingsShell.tsx` |
| Mobile comment field | task detail on a phone | `src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/NewCommentComponent.tsx` |

The mobile comment field is the reference for combining shape, spacing, tokens,
icons and action hierarchy. `openwiki/style-guide.md` documents its composition
step by step.

## Do not

1. **No new colours.** No hex literal, no `rgb()`, no `hsl()` in a component. A
   colour that does not exist yet is declared in every theme file first, then
   used through its semantic utility.
2. **No ad-hoc spacing.** No arbitrary padding, margin or gap off the 4px scale.
   `p-[13px]` is always wrong; `p-3` is what you meant.
3. **No inline styles for colour or spacing.** `style={{}}` is for values only
   the runtime knows, such as a measured height. Colour and spacing are
   utilities.
4. **No second button style.** One primary per control group, `bg-shadcn-primary`
   at the end of the action order. Secondary and ghost actions stay borderless.
5. **No new icon set.** Lucide, unless the surrounding component already uses
   another family. Not `react-icons`, not `@heroicons`, not Material.
6. **No foreign UI kit.** Not `reactstrap`, not MUI, not Ant, not
   react-bootstrap. Compose from the table above.
7. **No generic large radii.** No `rounded-lg`, `rounded-xl`, `rounded-2xl`.
   Dia's 10px and 12px corners stay scoped under `.dia`.
8. **No gradients.** Flat semantic surfaces.
9. **No white focus rings or white box borders** on inputs, popovers,
   dropdowns, badges or chips. Kanban section containers are the one keyboard
   focus exception.
10. **No arbitrary text sizes.** `text-[10px]` is off the scale; pick a named
    size.

## Run the check

```bash
node scripts/design-lint.mjs                 # working tree vs the production merge base
node scripts/design-lint.mjs --json          # machine-readable findings
node scripts/design-lint.mjs --verify-tokens # tokens.json still matches tailwind.config.ts
```

The lint reads **changed lines only**. It never reports historical drift,
because `openwiki/style-guide.md` says a style finding gates only when the diff
itself proves the pull request introduced or extended the violation. Run it
before you open the pull request; `design-gate` runs the same script in CI and
blocks auto-merge on a violation.

An owner-approved exception goes in `docs/design/lint-allow.txt` with the
reason and the ticket that approved it. CI reads that file from the production
base commit, so a pull request cannot pass itself by editing its own allowlist.
