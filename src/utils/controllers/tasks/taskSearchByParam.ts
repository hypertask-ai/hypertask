import { standalonePagesEnabled } from "@/utils/controllers/pages/standalonePagesEnabled";
import { haiku55ModelEnabled } from "@/app/api/ai/_lib/planGate";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import prisma from "@/lib/prisma";
import {
  aiImageModelDefinitions,
  aiModelDefinitions,
} from "@/lib/aiModelOptions";
import { getBoardAgentMembers } from "@/utils/controllers/agents/boardMembers";
import { turbopufferFetchMentionTasks } from "../search/document";
import { isFeatureEnabled, PAGE_MENTIONS_FLAG } from "@/lib/flags";
import {
  matchesMentionName,
  selectMentionAgents,
} from "@/utils/helperFunctions/mentionSearch";

const taskSearchByParam = async (
  rawParam: string,
  userid: number,
  projectId: number
) => {
  try {
    const hyperAiId = parseInt(process.env.NEXT_PUBLIC_HYPERAI_ID || "332");
    const [projectIds, owner_members, hyperAI, pageMentionsEnabled, haiku55Enabled, standaloneEnabled] = await Promise.all([
      fetchidlist(userid),
      prisma.project.findFirst({
        where: {
          id: projectId,
          status: "Normal",
          ...projectContentAccessWhere(userid),
        },
        select: {
          owner: true,
          members: {
            where: { agentId: null },
            select: {
              user: true,
            },
          },
        },
      }),
      prisma.user.findFirst({
        where: {
          id: hyperAiId,
        },
      }),
      isFeatureEnabled(PAGE_MENTIONS_FLAG, userid).catch(() => false),
      haiku55ModelEnabled(userid),
      standalonePagesEnabled(userid),
    ]);

    if (!projectIds.includes(projectId)) {
      return { status: 404, json: [] };
    }

    let hyperAIObject = { ...hyperAI, displayName: "HyperAI" };

    const canMentionPages = pageMentionsEnabled && projectIds.includes(projectId);

    const param = cleanQuery(rawParam);
    const wordsInQuery = getQueryWords(param);
    const normalizedModelQuery = normalizeModelMentionSearch(rawParam);
    const modelMentionArray =
      param === "all" || !normalizedModelQuery
        ? []
        : [...aiModelDefinitions, ...aiImageModelDefinitions]
            .filter((model) => haiku55Enabled
              ? model.key !== "claude-haiku-4.5"
              : model.key !== "claude-haiku-5-5")
            .filter((model) =>
              [model.label, model.key].some((value) =>
                normalizeModelMentionSearch(value).includes(
                  normalizedModelQuery
                )
              )
            )
            .map((model) => ({ ...hyperAI, displayName: model.label }));

    const members_array: any[] | undefined = owner_members?.members.map(
      (item) => item.user
    );
    let combinedArray: any[] = [];
    if (members_array && owner_members) {
      combinedArray = [
        hyperAIObject,
        owner_members?.owner,
        ...members_array,
      ].filter(Boolean);
    } else {
      combinedArray = [
        hyperAIObject,
        owner_members?.owner,
      ].filter(Boolean);
    }

    const slicedarray = combinedArray?.slice(0, 5);
    let newArray = slicedarray?.map((item) => ({
      id: item?.id,
      name: item?.displayName,
      type: "name",
    }));
    const modelArray = modelMentionArray.map((item) => ({
      id: item?.id,
      name: item.displayName,
      type: "name",
    }));

    if (param == "all") {
      console.log("🤔 ~ taskSearchByParam ~ FETCHING ALL");

      const [projects, task, boardAgentRows, pages] = await Promise.all([
        prisma.project.findMany({
          take: 5,
          where: {
            id: {
              in: projectIds,
            },
          },
        }),
        prisma.task.findMany({
          take: 5,
          where: {
            projectId,
            deletedAt: null,
            updatedAt: {
              not: null,
            },
          },
          orderBy: {
            updatedAt: "desc",
          },
        }),
        getBoardAgentMembers(projectId, userid),
        fetchMentionPages(canMentionPages, projectId, "", standaloneEnabled),
      ]);

      const updatedtask = task?.map((item: any) => ({
        id: item?.id,
        name: item?.title,
        type: "task",
        index: item.uniqueIndex,
        project_id: item?.projectId,
        ticketNumber: item?.ticketNumber,
      }));

      const updatedProjects = projects?.map((item: any) => ({
        id: item?.id,
        name: item?.title,
        type: "project",
        identifier: (item?.uniqueIdentifier ?? "").toString().toUpperCase(),
      }));

      const updatedAgents = selectMentionAgents(
        boardAgentRows.map((row) => row.agent),
        param,
      ).map((agent) => ({
        id: agent.id,
        name: agent.displayName,
        userId: agent.userId,
        type: "agent",
      }));

      return {
        status: 200,
        json: [
          { name: "People", type: "peopleHeading", count: newArray.length },
          ...newArray,
          { name: "Models", type: "modelHeading", count: modelArray.length },
          ...modelArray,
          { name: "Agents", type: "agentHeading", count: updatedAgents.length },
          ...updatedAgents,
          { name: "Tasks", type: "taskHeading", count: updatedtask.length },
          ...updatedtask,
          ...pageGroup(pages),
          {
            name: "Boards",
            type: "projectHeading",
            count: updatedProjects.length,
          },
          ...updatedProjects,
        ],
      };
    } else {
      const filteredData = combinedArray.filter((item) =>
        matchesMentionName(item.displayName, param)
      );
      const firstFiveResults = filteredData.slice(0, 5);
      newArray =
        firstFiveResults &&
        firstFiveResults?.map((item) => ({
          id: item?.id,
          name: item?.displayName,
          type: "name",
        }));

      const [updatedtask, projects, boardAgentRows, pages] = await Promise.all([
        turbopufferFetchMentionTasks(rawParam, projectIds, projectId),
        prisma.project.findMany({
          take: 5,
          where: {
            id: {
              in: projectIds,
            },
            OR: [
              {
                uniqueIdentifier: {
                  contains: rawParam.toLowerCase(),
                  mode: "insensitive",
                },
              },
              {
                title: {
                  contains: param.toLowerCase(),
                  mode: "insensitive",
                },
              },
              {
                title: {
                  contains: rawParam.toLowerCase(),
                  mode: "insensitive",
                },
              },
              {
                AND: wordsInQuery.map((word) => ({
                  title: {
                    contains: word.toLowerCase(),
                    mode: "insensitive",
                  },
                })),
              },
            ],
          },
        }),
        getBoardAgentMembers(projectId, userid),
        fetchMentionPages(canMentionPages, projectId, param, standaloneEnabled),
      ]);

      const updatedProjects = projects?.map((item: any) => ({
        id: item?.id,
        name: item?.title,
        type: "project",
        identifier: (item?.uniqueIdentifier ?? "").toString().toUpperCase(),
      }));

      const updatedAgents = selectMentionAgents(
        boardAgentRows.map((row) => row.agent),
        param,
      ).map((agent) => ({
        id: agent.id,
        name: agent.displayName,
        userId: agent.userId,
        type: "agent",
      }));

      return {
        status: 200,
        json: [
          { name: "People", type: "peopleHeading", count: newArray.length },
          ...newArray,
          { name: "Models", type: "modelHeading", count: modelArray.length },
          ...modelArray,
          { name: "Agents", type: "agentHeading", count: updatedAgents.length },
          ...updatedAgents,
          { name: "Tasks", type: "taskHeading", count: updatedtask.length },
          ...updatedtask,
          ...pageGroup(pages),
          {
            name: "Boards",
            type: "projectHeading",
            count: updatedProjects.length,
          },
          ...updatedProjects,
        ],
      };
    }
  } catch (error) {
    console.log("🤔 ~ taskSearchByParam ~ error:", error);
    return {
      status: 500,
      json: [],
    };
  }
};

export default taskSearchByParam;

const pageGroup = (pages: MentionPage[]) =>
  pages.length
    ? [{ name: "Pages", type: "pageHeading", count: pages.length }, ...pages]
    : [];

interface MentionPage {
  id: string;
  name: string;
  type: string;
}

const fetchMentionPages = async (
  enabled: boolean,
  projectId: number,
  titleQuery: string,
  standaloneEnabled: boolean,
): Promise<MentionPage[]> => {
  if (!enabled) return [];
  try {
    const pages = await prisma.page.findMany({
      take: 5,
      where: {
        archived: false,
        ...(standaloneEnabled ? {} : {
          taskId: { not: null },
          task: { projectId, deletedAt: null },
        }),
        projectId,
        project: { status: "Normal" },
        ...(titleQuery
          ? { title: { contains: titleQuery, mode: "insensitive" as const } }
          : {}),
      },
      orderBy: { id: "desc" },
      select: {
        publicId: true,
        title: true,
      },
    });
    return pages.map((page) => ({
      id: page.publicId,
      name: page.title,
      type: "page",
    }));
  } catch (error) {
    console.error("🤔 ~ fetchMentionPages ~ error:", error);
    return [];
  }
};

const fetchidlist = async (id: number) => {
  try {
    if (id) {
      const projectid = await prisma.project.findMany({
        where: {
          ...projectContentAccessWhere(id),
        },
        select: {
          id: true,
        },
      });
      const valuesArray = projectid.map((obj: any) => Object.values(obj));
      return valuesArray.flat() as number[];
    }
    return [];
  } catch (error) {
    console.log("r🤔 ~ fetchidlist ~ error:", error);
    return [];
  }
};

function cleanQuery(query: string) {
  return query.replace(/[^a-zA-Z0-9\s]/g, "");
}

function getQueryWords(cleanedQuery: string) {
  return cleanedQuery.split(/\s+/).filter((word) => word.length > 0);
}

function normalizeModelMentionSearch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
