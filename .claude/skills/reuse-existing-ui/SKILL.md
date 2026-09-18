---
name: reuse-existing-ui
description: Any ticket that adds or changes UI, before writing a line of code
---

# reuse-existing-ui

Use before `fix-bug` or `ship-feature-behind-flag` on any ticket touching UI. The app repo is `~/projects/hypertask-oss`. Its own style rules live in `reference/style-guide.md` and `reference/typography.md` (copied from `~/projects/hypertasks/openwiki/`); the twelve behavioural rules that back step 4 live in `reference/karpathy-rules.md`.

## Steps

1. **List the UI elements the ticket needs.** Write down every control: input, button, list, dialog, composer, mic, send, avatar, chip, whatever the ticket calls for. Don't start on the first one until the whole list exists — a partial list is how the third element quietly becomes a new component nobody checked for.
2. **For each element, grep the app repo for the existing component** before writing anything. Search `src/components` and `src/app`:
   ```
   grep -ril "AudioButton\|composer\|ChatInput" ~/projects/hypertask-oss/src/components | head
   ```
   Swap in the real names for the element you're looking for. Three components already exist for the most commonly reinvented UI, so check these first:
   - **AI chat composer:** `src/components/AI_CHAT/AI_Tiptap_Container.tsx` (renders `AiChatComposerActionRow` from the same directory).
   - **Mic / dictation button:** `AudioButton`, `src/components/RTE/Components/AudioButton.tsx`.
   - **Send button:** `SendMessageButton`, a local function inside `AI_Tiptap_Container.tsx` (not its own file), built on `SendArrow` from `src/components/Common/SendArrow.tsx`.
   Also check `src/components/Global/MobileTabBar.tsx` (the bottom nav bar) and `src/components/Global/MobileTopBar.tsx` (the app top bar) before writing anything that shows or hides either — both already expose visibility helpers in `src/components/Global/mobileShellVisibility.ts` (e.g. `shouldShowMobilePrimaryDock`), so a full-screen page hides them by adding its path there, not by reimplementing the hide logic.
3. **Reuse it as is. Props only.** Import the component and pass it the props it already takes. Don't fork it, don't copy its internals into a new file "to customize", don't wrap it in a new component that just re-renders it with a different name. When the owner selects an existing trigger, keep that exact trigger instead of adding a parallel button or label.
4. **A new component is allowed only when no existing one can do the job.** Say what you checked and why it doesn't fit. Put that reason on the ticket comment and, one line, in the PR summary. Rules 2 (Simplicity First) and 3 (Surgical Changes) in `reference/karpathy-rules.md` back this: no abstractions for single-use code, touch only what you must.
5. **Never re-implement layout that already exists for the same kind of screen.** A mobile full-screen chat is the AI chat's mobile layout (`AI_Chat_Layout.tsx` and friends in `src/components/AI_CHAT/`), not a new page shell that happens to look similar.
6. **Check before hand-off:**
   - Your grep shows no new component whose name resembles an existing one (a `ChatComposer2`, a `MicButtonNew`, a `CustomSendArrow` next to the real `SendArrow` is a red flag, not a variant).
   - The PR diff touches existing components, not new copies of them.

## Notes

- This skill is a gate, not a redesign. It doesn't ask you to fix unrelated drift in the component you're reusing — see `reference/style-guide.md`'s own rule: fix what the ticket touches, leave the rest.
- If the ticket is flag-gated (`ship-feature-behind-flag`), reusing the existing component still needs its own `useFlag` check at the call site: reuse doesn't bypass the flag rule.
