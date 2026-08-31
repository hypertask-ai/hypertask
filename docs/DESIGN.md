# Hypertask Design System

The single source of truth for what Hypertask looks like and how to extend it. **Read this before any UI work.** Values are extracted from `tailwind.config.ts` and `src/styles/tailwindThemes/{light,dark}.css`; component patterns from the real components. If a value here disagrees with the code, the code wins — update this file.

## The one rule

Hypertask is **minimal and keyboard-first, modeled on Superhuman.** The design is "invisible until you summon it." On-canvas chrome (buttons, pills, chips, banners, count badges, toggles, settings panels) on task / board / feed / detail surfaces **breaks the product** and is never acceptable. New affordances ship through keyboard shortcuts + the Ctrl+K command palette + the `?` cheatsheet — never a new visible element. Any genuinely-new visible element needs a mockup approved by Valentin first.

**Never design from memory.** Open the live app or `~/projects/hypertasks-dev` and read the actual component before drawing. Generic "modern SaaS" mockups are rejected on sight.

## Real screenshots

Capture from the live app (logged in) via `zsb` and host on R2. Re-capture when the UI changes.

- Board (kanban, dark): https://yeoux.net/ht-cf-01
- Ticket detail rail: _TODO — re-capture (zsb pane was closed)_
- Ctrl+K command palette: _TODO_
- `?` cheatsheet: _TODO_

## Colors

Brand accents (static, not themed):

| Name | Value |
|---|---|
| `hypertasks-purple` | `#4455BB` |
| `hypertasks-green` | `#C2CFA5` |
| `hypertasks-ai-purple` | `#C668FF` |
| `hypertasks-header-blue` | `rgb(35, 131, 226)` |

Dark mode is the primary theme (`darkMode: "class"`, `.dark` on root). Theme files imported in `src/styles/globals.scss`.

| Role | CSS var | Dark | Light |
|---|---|---|---|
| Page background | `--bg-pageBackground` | `#0e0e0e` | `#ffffff` |
| Task-detail page bg | `--bg-taskDetailPage` | `#0e0e0e` | `rgb(250,250,252)` |
| Container / panel | `--bg-containerBackground` | `#212429` | `white` |
| Card | `--bg-cardBackground` | `#2a2d34` | `#f9f9f9` |
| **Ticket-detail rail** | `--bg-comment-description` | `#2F343C` | `#f9f9f9` |
| Modal / Ctrl+K | `--bg-modalBackground` | `#333B47` | `white` |
| Sidebar | `--bg-sidebar` | `#202124` | `#f3f3f3` |
| Hover (card) | `--hover-cardBackground` | `#2f343c` | `#d0d0d0` |
| Hover (active) | `--bg-hover-active` | `#4c5362` | `#e9e9e9` |
| Selected element | `--active-modal-element` | `#4f5766` | `#ececec` |
| Border | `--border` | `#272729` (`240 3.7% 15.9%`) | `#e4e4e7` (`240 5.9% 90%`) |
| Thin border | `--border-light-gray-thin` | `rgb(35,37,42)` | `rgb(224,224,224)` |
| Text primary | `--color-white-black` | `white` | `#262525` |
| Text muted | `--muted-foreground` | `#9FA2A8` (`240 5% 64.9%`) | `#737380` (`240 3.8% 46.1%`) |
| **Label / faint text** | `--color-text-light-gray` | `#8e9093` | `#858585` |
| Label component text | `--color-text-labelComponent` | `#d3d3d3` | `#858585` |
| Focus/active border | `--border-active` | `white` | `#262525` |

Other named: `icon-dark-gray #999a9d`, `icon-hover-gray #95999e`, `header-text #76777a`.

## Shape

- **Radius:** no custom scale. Codebase uses `rounded-[4px]` (containers/rail), `rounded-[5px]` (labels), `rounded-[2px]` (kbd badges), `rounded-full` (avatars), `rounded-sm`. Shadcn `--radius: 0.75rem` exists but is **not** wired to a tailwind token — don't use big radii.
- **Shadow:** `shadow-md` (Tailwind default) on the task info column. Custom heavy shadows exist (`customshadow-1/2/4`) but are for modals/overlays, e.g. `customshadow-2: 2px 2px 20px rgba(0,0,0,.35)`.
- **Fonts:** AMOLED, Graphite, and Porcelain use IBM Plex Sans through `--font-plex`. Dia uses italic Newsreader through `--font-newsreader` for board, column, modal, and `h1`–`h3` headings. Inter remains the `font-sans` default for surfaces without a core-theme override. Base body text is `text-[14px]`; the custom `modalSmall` size is 16px.
- **Heights:** `labelComponent: 22px`, `SVH-full: 100svh`.

## Component patterns

### Ticket-detail property (a "custom field" is one of these)

Right rail = sticky column, `bg-comment-description` (`#2F343C`), `shadow-md`, `rounded-[4px]`, `py-[10px] px-[16px]`, `max-w-[312px] min-w-[260px]`, rows `gap-7` (28px). Files under `src/components/PageComponents/TaskDetail/MainPageComponents/`.

Each property row:

```jsx
<TaskInfoRow>                                   {/* flex w-full text-[#8E9093] items-baseline */}
  <LocalRightSideInfo title="Priority" .../>    {/* label: w-[25%] @sm:w-1/2 text-[#8E9093] font-medium */}
  <TaskInfoValue onClick={...} className="cursor-pointer group">  {/* value: ml-[20px] w-full min-w-0 */}
    {/* a label component, a pill, or a <ClickableSpan title="No Priority"/> when empty */}
  </TaskInfoValue>
</TaskInfoRow>
```

Empty value = `ClickableSpan` → `text-text-light-gray cursor-pointer` (e.g. "No Priority", "No due date"). Existing values render as dedicated components: `PriorityLabelComponent` (pill), `AssigneesContainer` (avatar `w-4 h-4 rounded-full` + name), `DueDateLabel`, etc. **A new field is the same row — do not invent a different layout.**

### Ctrl+K command (how new affordances enter the product)

Files: `src/components/Modals/commands/HTC/AllCommands.ts` (data), `HTCTypes.ts` (types), `commands.tsx` (modal). Modal is always dark `#333B47`, white text. Group header `p-3 text-text-light-gray font-bold text-[14px]`. Row `h-[60px] px-6`, selected `bg-[#4f5766]`. Key badge `<kbd>` `px-[6px] rounded-[2px] bg-[#555B64] font-extrabold`.

```ts
// ICommandList
{ key: "createCustomField", name: "Create custom field…", commandMode: CommandMode.CreateField,
  keyboard: ["F"], keywords: "custom field property add" }
```

Add the entry to a group in `AllCommands.ts`, add the `CommandMode` enum value, handle it in the `handleAction` switch.

### `?` cheatsheet shortcut

Files: `src/lib/constants/shortcuts.ts` (`getKeyboardShortcuts`), `src/components/sidebars/keyboardShortcuts.tsx`. Panel `fixed bg-sidebar text-white-black right-0 w-[26vw]`, fontSize 14. Section header `text-[#8E9093] text-[14px] font-medium`. Key badge `<kbd>` `px-[6px] py-[4px] rounded-[2px] bg-[#4F5765] text-white`. `null` in `pressKey` renders as "then" (chord separator).

```ts
// IShortcut sub-entry
{ shortTitle: "Set ICE", pressKey: ["I"] }
{ shortTitle: "Go to task board", pressKey: ["G", null, "T"] }  // G then T
```

Register the entry, wire the actual listener in the relevant keyboard hook, optionally mirror as a command.

## Wireframe checklist

Before sharing any mockup, confirm: dark `#0e0e0e` base, real container/rail/modal colors above, `#4455BB` accent (not violet), `#8E9093` labels, 4–5px radius (not 2xl), 14px system font, and every new affordance routed through Ctrl+K / shortcut / cheatsheet — not a button. If it could be a Linear or Notion screenshot, it's wrong.

## Confirm dialogs

All confirm-style modals use `src/components/Modals/Common Modals/ConfirmDialog.tsx`.
The archive-board dialog defines the canonical layout and behavior.

- Never use blue, red, or reactstrap buttons in a confirm dialog.
- Present confirm and cancel as action rows with `ENTER` and `ESC` kbd chips.
- Include the footer hint strip for confirm and cancel shortcuts.
- Use the optional body slot for a confirmation input or textarea.
- Use `ctrl-enter` for multiline input so plain Enter creates a newline.
- This matches the create-task modal's Ctrl+Enter submit convention.

Every new confirm-style modal must use `ConfirmDialog`.
