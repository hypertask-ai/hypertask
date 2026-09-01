# Hypertask UI style guide

This is the canonical visual contract for new and changed Hypertask UI. It records the de-facto system in the production components and theme files. Use it in design, implementation, linting, and pull request review.

A pull request does not need to repair unrelated historical drift. It must not introduce a new deviation or materially extend one on changed lines. When this guide and an old call site disagree, follow this guide unless the call site is listed as an exception below.

## Product character

Hypertask is minimal and keyboard-first. Controls use compact geometry, quiet hierarchy, and semantic theme tokens. Prefer an existing component or composition over a new visual pattern.

The core themes are AMOLED, Graphite, and Porcelain. Dia deliberately changes typography and card geometry. The legacy `dark.css` and `light.css` themes are compatibility sources, not references for new UI.

Sources:

- `tailwind.config.ts`
- `src/styles/tailwindThemes/{amoled,graphite,porcelain,dia}.css`
- `src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/NewCommentComponent.tsx`
- `src/components/Common/AttachmentsUpload/index.tsx`
- `src/lib/configs/general.config.ts`

## Shape and borders

### Corner radii

| Use | Radius | Preferred utility |
|---|---:|---|
| Keyboard badges and very small inset marks | 2px | `rounded-[2px]` |
| Compact controls, menu rows, chips | 4px | `rounded-sm` or `rounded-[4px]` |
| Cards, panels, modals, sheets | 5px | `rounded-[5px]` |
| Mobile comment input well only | 8px | `rounded-lg` |
| Avatars, status dots, and established circular icon actions | 50% | `rounded-full` |

Do not use `rounded-xl`, `rounded-2xl`, or another generic large SaaS radius on product UI. Do not turn labels or counts into outlined pills.

Dia is an intentional exception. Its kanban cards and posted comments use 10px corners, and its modals use 12px corners. Keep those values scoped under `.dia`; do not copy them into another theme.

### Borders and shadows

- A normal separator or card edge is a 1px hairline using `border-thin`, `border-border-light-gray-thin`, or the component's semantic border token.
- Inputs, dropdowns, and popovers are borderless unless an existing component specifically owns a hairline. Use surface contrast and the established overlay shadow instead.
- Never add white box borders, `focus:border-white-black`, or a white focus ring to an input, popover, dropdown, badge, or chip. Kanban section containers are the narrow keyboard-focus exception.
- Use `shadow-md` for ordinary raised cards. Use `customshadow-1`, `customshadow-2`, or `customshadow-4` only where an existing modal or overlay pattern already does.
- Do not add gradients.

## Color tokens

Use semantic Tailwind names or their CSS variables in components. A raw color is acceptable only when it is already declared as a theme or brand token and no semantic utility exists. New colors belong in every supported theme before use.

| Role | Component utility | CSS variable | AMOLED | Graphite | Porcelain | Dia |
|---|---|---|---|---|---|---|
| Page | `bg-pageBackground` | `--bg-pageBackground` | `#000000` | `#0e0e0e` | `#ffffff` | `#f6f4ef` |
| Card | `bg-cardBackground` | `--bg-cardBackground` | `#1d1d1d` | `#262a30` | `#ffffff` | `#ffffff` |
| Modal or menu | `bg-modalBackground` | `--bg-modalBackground` | `#141414` | `#2c2f36` | `#ffffff` | `#ffffff` |
| Comment surface | `bg-comment-description` | `--bg-comment-description` | `#121212` | `#262a30` | `#f9f9fa` | `#ffffff` |
| Mobile comment well | `bg-newcomment-well` | `--bg-newcomment-well` | `#000000` | `#17191d` | `#ececef` | `#f1ede6` |
| Primary text | `text-white-black` | `--color-white-black` | `#ececec` | `#ffffff` | `#18181b` | `#1f1d1a` |
| Muted text | `text-text-light-gray` | `--color-text-light-gray` | `#8a8a8a` | `#8e9093` | `#727279` | `#67635b` |
| Quiet border | `border-border-light-gray-thin` | `--border-light-gray-thin` | `#333333` | `#33373e` | `#e2e2e6` | `#e9e4da` |
| Primary action | `bg-shadcn-primary` | `--shadcn-primary` | `222 9% 46%` | `225 10% 49%` | `228 10% 40%` | `142 27% 33%` |

Static brand tokens are `hypertasks-purple` (`#4455BB`), `hypertasks-green` (`#C2CFA5`), `hypertasks-ai-purple` (`#C668FF`), and `hypertasks-header-blue` (`rgb(35, 131, 226)`). Brand colors are accents, not substitutes for themed surfaces or text.

## Spacing

Tailwind's base spacing unit is 4px. Build normal layout rhythm from `1`, `2`, `3`, `4`, `5`, `6`, and `8`, which resolve to 4, 8, 12, 16, 20, 24, and 32px. Half steps such as 2px and 6px are acceptable for compact internal alignment.

- Compact icon or inline-control gap: 4 to 8px.
- Menu-row horizontal padding: 8 to 12px.
- Card or field horizontal padding: 12 to 16px.
- Section spacing: 16 to 24px.
- Do not import a foreign 10px-based scale or add arbitrary padding when the nearest established step works.
- Mobile-only controls reserve at least 44 by 44px via `MOBILE_TARGET`. The painted icon remains smaller.

## Typography

AMOLED, Graphite, and Porcelain use IBM Plex Sans. Dia uses italic Newsreader for board, column, modal, and `h1` to `h3` headings. Inter is the fallback for surfaces outside a core-theme selector.

Use the eight named sizes from `tailwind.config.ts`:

| Token | Size | Typical role |
|---|---:|---|
| `text-micro` | 11px | chips, counts, ticket IDs |
| `text-meta` | 12px | metadata, compact secondary text |
| `text-dense` | 13px | list rows and compact controls |
| `text-content` | 14px | default UI and body copy |
| `text-emphasis` | 16px | prominent labels and titles |
| `text-subheading` | 18px | section headings |
| `text-heading` | 24px | page headings |
| `text-display` | 32px | rare display text |

Prefer the named utilities over arbitrary `text-[Npx]`. Keep font weight quiet: regular for content, medium or semibold for controls and hierarchy, and bold only when the existing pattern calls for it. See `openwiki/typography.md` for surface-specific conventions.

## Icons

Use Lucide for new product icons unless the surrounding component already uses another family.

- 14px: dense secondary actions and board-header neighbours.
- 16px: default menu, field, and toolbar icons.
- 18px: navigation and medium-emphasis actions.
- 20px: primary toolbar actions.
- 22px: the mobile comment Send arrow.
- Core themes render Lucide at a 1.5 stroke. Existing call sites commonly specify `strokeWidth={1.75}` for compatibility, but the theme rule wins. Use `keep-stroke` only for a deliberate icon-specific exception.
- Icon-only mobile controls still reserve a 44px target. Do not enlarge the glyph to fill the target.

## Button hierarchy

A control group has one primary action.

### Primary

Use `bg-shadcn-primary text-primary-foreground` with the established 4 or 5px radius. Put the primary action at the end of the action order, normally the far right. Disabled state uses opacity and blocks interaction; it does not introduce another color.

### Secondary or ghost

Use a borderless text or icon action with `text-text-light-gray` or `text-icon-dark-gray`. Hover and keyboard focus may use `bg-hover-active` plus `text-white-black`. Do not surround secondary actions with a bright outline, and do not make them compete with the primary fill.

Destructive actions use the semantic destructive token or an existing destructive component. A destructive color does not justify a second primary action.

## Reference implementation: mobile comment field

The mobile comment composer is the reference for combining shape, spacing, tokens, icons, and action hierarchy. Its production composition is:

1. A fixed transparent composer over the page.
2. A drag handle above the field.
3. Twelve pixels of horizontal composer padding and 6px below the field.
4. A `bg-cardBackground` well with 8px corners, a quiet theme border, 12px horizontal padding, and 4px vertical padding.
5. A 14px editor with 8px vertical padding and the “Add a comment…” placeholder.
6. One flat action row with an 8px gap: Plus, purple `PencilSparkles`, spacer, mic, then Send. The Plus menu contains attachments, mention, commands, and discard.
7. Empty dictation, recording confirmation, and Send use a 48×44 inverted-theme action with 4px corners. With text, the ghost mic sits immediately left of Send.

Relevant markup lives in `NewCommentComponent.tsx`; action ordering lives in `AttachmentsUpload/index.tsx` and `mobileCommentComposer.ts`. Preserve the single-row ordering because re-parenting the microphone destroys an in-flight recording.

## Pull request review contract

For changed user-facing UI, review the changed lines against this guide.

A style finding gates only when the diff itself proves that the pull request introduced or materially extended a violation. Cite the changed file and line, name the violated rule, and point to the conforming token or nearby reference pattern. Report that concrete violation as `major` so `claude-review` blocks it.

Do not gate on:

- unchanged historical drift;
- Dia's scoped 10px and 12px geometry;
- established circular avatars, status dots, floating actions, or AI chat send controls;
- data visualization colors that cannot map to a semantic UI role;
- third-party widgets that the app does not style;
- an owner-approved design whose exception is documented in the pull request.

Subjective preference is not evidence. If the supplied diff does not prove the violation, omit the finding or mark it low-confidence so it remains advisory.
