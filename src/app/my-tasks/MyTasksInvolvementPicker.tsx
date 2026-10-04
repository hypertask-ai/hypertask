"use client";

import OptionPickerModal from "@/components/Modals/OptionPicker";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6930_MY_TASKS_KANBAN_REUSE_FLAG } from "@/lib/flags/keys";
import { MY_TASKS_SCOPE_VALUES, type MyTasksScope } from "@/lib/myTasksScopes";

const labels: Record<MyTasksScope, string> = {
  assigned: "Assigned to me",
  created: "Created by me",
  mentioned: "Mentioned",
  watching: "Watching",
};

export default function MyTasksInvolvementPicker({ scopes, onToggle, onClose }: {
  scopes: MyTasksScope[];
  onToggle: (scope: MyTasksScope) => void;
  onClose: () => void;
}) {
  const kanbanReuseEnabled = useFlag(HTPR_6930_MY_TASKS_KANBAN_REUSE_FLAG);
  return kanbanReuseEnabled ? (
    <OptionPickerModal
      header="Involvement"
      options={MY_TASKS_SCOPE_VALUES.map((scope) => ({
        id: scope, label: labels[scope], checked: scopes.includes(scope),
      }))}
      onSelect={(option) => {
        const scope = MY_TASKS_SCOPE_VALUES.find((value) => value === option.id);
        if (scope) onToggle(scope);
      }}
      onClose={onClose}
    />
  ) : null;
}
