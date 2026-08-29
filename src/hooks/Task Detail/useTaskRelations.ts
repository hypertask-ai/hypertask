import {
  addRelationsToTaskRoute,
  removeRelationFromTaskRoute,
} from "@/lib/constants/APIRouteConstants";
import axios from "axios";

export type TaskRelationType =
  | "RelatedTo"
  | "BlockedBy"
  | "BlockedTo"
  | "Duplicate";

export const useTaskRelations = () => {
  const removeRelation = async (relationId: number) => {
    const response = await axios.post(removeRelationFromTaskRoute, {
      relationId,
    });

    if (response.status === 200) {
      return response;
    } else return undefined;
  };

  const addRelations = async (
    relations: any,
    relationType?: TaskRelationType
  ) => {
    const relationsWithTypes = relationType
      ? {
          ...relations,
          relatedTasks: relations.relatedTasks?.map((related: any) => ({
            ...related,
            relationType: related.relationType ?? relationType,
          })),
        }
      : relations;
    const response = await axios.post(addRelationsToTaskRoute, {
      relations: relationsWithTypes,
    });
    if (response.status === 200) {
      return response;
    } else return undefined;
  };

  return { removeRelation, addRelations };
};
