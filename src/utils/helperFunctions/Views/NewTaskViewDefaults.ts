import type { IFilterSettings } from "@/models/Filters/model";
import type { IAgent, ILabel, IUser } from "@/models/model";
import { EstimateConstants, PriorityConstants } from "@/lib/constants/constants";

// Labels and agents use UUIDs; filter-only placeholders are not assignable IDs.
const assignableId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const getNewTaskViewDefaults = (filters?: IFilterSettings) => {
  const values = (type: string) => {
    const filter = filters?.addedFilters.find((filter) => filter.type === type);
    if (filter?.match !== undefined && filter.match !== "ANY" && filter.match !== "ALL") return undefined;
    return Array.isArray(filter?.searchPayload) ? filter.searchPayload : undefined;
  };

  return {
    tags: values("Labels")?.filter((label) => typeof label?.id === "string" && assignableId.test(label.id)) as ILabel[] | undefined,
    assignees: (values("Assignees") ?? []).filter((person) =>
      person && typeof person === "object" && ("uid" in person
        ? Number.isSafeInteger(person.id) && person.id > 0
        : typeof person.id === "string" && assignableId.test(person.id) && !person.revokedAt)
    ) as (IUser | IAgent)[],
    priority: values("Priority")?.map((value) => PriorityConstants.find((priority) =>
      priority.priority_index > 0 && priority.priority_index === value?.priority_index
    )).find(Boolean),
    estimate: values("Size")?.map((value) => EstimateConstants.find((estimate) =>
      estimate.estimate_index > 0 && estimate.estimate_index === value?.estimate_index
    )).find(Boolean),
  };
};
