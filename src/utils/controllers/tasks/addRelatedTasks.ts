import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

export const taskRelationTypes = [
  "RelatedTo",
  "BlockedBy",
  "BlockedTo",
  "Duplicate",
] as const;

export type TaskRelationType = (typeof taskRelationTypes)[number];

export const isTaskRelationType = (
  relationType: unknown
): relationType is TaskRelationType =>
  typeof relationType === "string" &&
  taskRelationTypes.includes(relationType as TaskRelationType);

/**
 * Go through each task in array
 * Check whether task exists
 * If exists, check if there is an existing relation
 * If no relation, then check if it's not trying to relate to itself.
 * Also need to make sure if the relation we are adding is not sub/parent of the currentTask
 * If all requirements are met, relation is made both ways.
 *
 * @param {*} relatedTasks
 * @return {*}
 */
export const addRelatedTasks = async (relations: any, userId: number) => {
  try {
    console.log("🚀 ~ addRelatedTasks ~ relations:", relations);
    const relatedTasks = relations.relatedTasks;
    const invalidRelationType = relatedTasks?.some(
      (related: any) =>
        related.relationType !== undefined &&
        !isTaskRelationType(related.relationType)
    );
    if (invalidRelationType) {
      return {
        status: 400,
        json: { message: "Invalid relation type" },
      };
    }
    const accessibleProjects = await prisma.project.findMany({
      where: {
        status: "Normal",
        ...getProjectWhere(userId),
      },
      select: {
        id: true,
      },
    });
    const accessibleProjectIds = accessibleProjects.map(({ id }) => id);
    const accessibleProjectIdSet = new Set(accessibleProjectIds);

    const currentTask = await prisma.task.findFirst({
      where: {
        id: parseInt(relations.currentTaskId),
        projectId: { in: accessibleProjectIds },
      },
      select: {
        id: true,
        parentTaskId: true,
        subTasks: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!currentTask)
      return {
        status: 403,
        json: { message: "Forbidden" },
      };
    const relationAdded = [];
    if (relatedTasks && relatedTasks.length > 0) {
      for (const related of relatedTasks) {
        const relatedProjectId = parseInt(related.projectId);
        if (!accessibleProjectIdSet.has(relatedProjectId)) continue;

        const taskToFind = await prisma.task.findFirst({
          where: {
            uniqueIndex: parseInt(related.uniqueIndex),
            projectId: relatedProjectId,
          },
          select: {
            id: true,
            title: true,
          },
        });
        console.log("🚀 ~ addRelatedTasks ~ taskToFind:", taskToFind);

        if (taskToFind) {
          if (
            currentTask.parentTaskId !== taskToFind.id &&
            currentTask.subTasks.every(
              (subtask) => subtask.id !== taskToFind.id
            )
          ) {
            const relationType: TaskRelationType =
              related.relationType ?? "RelatedTo";
            //See if there is an existing relation between the task to relate and relatee tasks.
            const existingRelation = await prisma.taskRelations.findFirst({
              where: {
                OR: [
                  {
                    sourceTaskId: currentTask.id,
                    targetTaskId: taskToFind.id,
                  },
                  {
                    sourceTaskId: taskToFind.id,
                    targetTaskId: currentTask.id,
                  },
                ],
              },
              include: {
                targetTask: {
                  select: {
                    title: true,
                    id: true,
                  },
                },
                sourceTask: {
                  select: {
                    title: true,
                    id: true,
                  },
                },
              },
            });
            console.log(
              "🚀 ~ addRelatedTasks ~ existingRelation:",
              existingRelation
            );

            if (taskToFind.id === currentTask.id) continue;

            if (!existingRelation) {
              const relation = await prisma.taskRelations.create({
                data: {
                  sourceTaskId: currentTask.id,
                  targetTaskId: taskToFind.id,
                  relationType: relationType as any,
                },
                include: {
                  targetTask: true,
                },
              });

              relationAdded.push(relation);
            } else if (
              existingRelation.sourceTaskId === currentTask.id &&
              existingRelation.targetTaskId === taskToFind.id &&
              existingRelation.relationType !== relationType
            ) {
              // Only update in place when the existing relation runs the SAME
              // direction we are setting. A reverse-direction relation (source
              // and target swapped) is a distinct relationship; overwriting its
              // type would invert its meaning for the other task, so leave it.
              const relation = await prisma.taskRelations.update({
                where: {
                  id: existingRelation.id,
                },
                data: {
                  relationType: relationType as any,
                },
                include: {
                  targetTask: true,
                },
              });

              relationAdded.push(relation);
            }
          }
        }
      }
    }
    return {
      status: 200,
      json: relationAdded,
    };
  } catch (error) {
    console.log("🚀 ~ addRelatedTasks ~ error:", error);
    return {
      status: 500,
      json: [],
    };
  }
};
