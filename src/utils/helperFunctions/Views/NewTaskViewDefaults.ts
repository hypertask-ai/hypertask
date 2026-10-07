import type { IFilterSettings } from "@/models/Filters/model";
import type { IAgent, ILabel, IUser } from "@/models/model";
import type { IEstimateConstants, IPrioritiesConstants } from "@/lib/constants/constants";

export const getNewTaskViewDefaults = (filters?: IFilterSettings) => {
  const values = (type: string) =>
    filters?.addedFilters.find((filter) => filter.type === type)?.searchPayload;

  return {
    tags: values("Labels") as ILabel[] | undefined,
    assignees: (values("Assignees") ?? []) as (IUser | IAgent)[],
    priority: values("Priority")?.[0] as IPrioritiesConstants | undefined,
    estimate: values("Size")?.[0] as IEstimateConstants | undefined,
  };
};
