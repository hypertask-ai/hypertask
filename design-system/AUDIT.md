# Design-System Audit

Ranked factual debts found while building the preview cards.

1. High: hardcoded color constants bypass theme variables in core kanban and navigation UI.
   - `src/components/PageComponents/Kanban/KanbanTaskComponents/TaskTopRow.tsx:73` uses `#FFCB33` for saved-task dots and `:81` uses `#5896F1` for notification dots.
   - `src/components/PageComponents/Kanban/HeaderComponents/ViewsHeaderKanban.tsx:11` defines `#51A4F1` and `#76777a`; related header components also use `fill-[#51A4F1]`.
   - `src/components/Labels/DueDateLabel.tsx:60` uses `#FB773F` for the calendar icon.

2. High: admin/login/pricing surfaces use independent Tailwind greys/blues instead of the app theme tokens.
   - `src/app/login/EmailAuth/EmailAuthComponents.tsx:28` and `:29` use raw `text-white`, `text-black`, `placeholder-gray-400`, `focus:border-blue-500`, and `hover:bg-gray-200`.
   - `src/app/reset/components/UserSearch.tsx:35` uses `border-gray-300`, `focus:ring-blue-500`, and `focus:border-blue-500`.
   - `src/app/pricing/Pricing.tsx` contains many raw dark greys and brand purples such as `#27292D`, `#363A40`, `#4E5663`, and `#4455BB`.

3. Medium: near-duplicate greys make the palette hard to reason about.
   - Theme files include `#858585`, `#8e9093`, `#8d8e8f`, `#95999E`, `#999a9d`, `#4F5766`, `#4f5766`, `#4F5765`, `#333B47`, and `#333b47` for similar neutral roles.
   - Some duplicates are split between CSS variables, Tailwind config constants, and component-local literals.

4. Medium: radius and shadow conventions are inconsistent across surfaces.
   - Kanban cards use `rounded-[5px]` and `shadow-md` in `src/components/PageComponents/Kanban/KanbanTaskComponents/TaskDraggableContainer.tsx:53` and `:59`.
   - Shared modal containers use `rounded-[4px]`, `customshadow-4`, and `shadow-customshadow-2` in `src/components/Common/CommonModalComponents/index.tsx:58`.
   - Login/admin screens commonly use `rounded-lg`, `rounded-xl`, and `shadow-lg`, producing a separate visual language.

5. Medium: Bootstrap/reactstrap and Tailwind styling are tightly mixed in modal chrome.
   - `src/components/Common/CommonModalComponents/index.tsx` wraps `reactstrap` `Modal`, `ModalHeader`, and `ModalFooter` while overriding with Tailwind classes.
   - `src/styles/globals.scss:134` overrides `.linksModal .modal-content`; `:144` forces `#333B47` for `#htc.linksModal`, bypassing theme switching.

6. Low: several theme values duplicate each other semantically.
   - Light theme sets `--bg-cardBackground`, `--bg-comment-description`, `--bg-newComment-container`, and `--bg-ai-chat-tiptap` all to `#f9f9f9` or equivalent.
   - Light active tokens `--active-cardBackground`, `--active-elementBg`, `--active-modal-element`, and `--active-list-element` cluster around `#ececec` with slightly different names.
