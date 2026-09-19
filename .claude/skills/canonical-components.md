# Canonical UI components

Use these production components before adding markup for a new control. The first path in each row is the component to reuse. The reference path shows the established composition when one control alone is not enough.

| Control | Reuse | Reference composition |
|---|---|---|
| Toolbar icon button | `src/components/PageComponents/Kanban/HeaderComponents/HeaderIconWrapper.tsx` | `src/components/PageComponents/Kanban/HeaderComponents/ShellViewControls.tsx` |
| Menu | `src/components/commands.tsx` | `src/components/Modals/commands/HTC/CommandList.tsx` |
| Dialog | `src/components/Common/CommonModalComponents/index.tsx` | `src/components/Modals/Common Modals/ConfirmDialog.tsx` |
| View tabs | `src/components/PageComponents/Kanban/HeaderComponents/ViewTabsBar.tsx` | `src/components/Global/MobileBoardViewPicker.tsx` |
| Task table | `src/components/PageComponents/Kanban/TableView/TableView.tsx` | `src/components/PageComponents/Kanban/TableView/TableColumnsPicker.tsx` |
| Saved views | `src/components/PageComponents/Kanban/HeaderComponents/SaveViewHeaderKanban.tsx` | `src/components/Modals/ViewModals/ManageViewsModals.tsx` |

## How to use the list

- Add actions to the command palette instead of building a local dropdown.
- Compose dialogs from the common modal container, header, rows, and footer.
- Extend the existing tabs, table, or saved-view composition instead of adding a second version beside it.
- If none fits, follow `reuse-existing-ui`: record what you checked and why the existing component cannot do the job.
- In the pull request's **Components reused** section, map each changed exported control to the base-branch component binding it uses: `ExportedControl` in `src/path/to/control.tsx` -> `src/components/reused.tsx`. If none fits, use `ExportedControl` in `src/path/to/control.tsx` -> No existing component fits: `specific justification`.
