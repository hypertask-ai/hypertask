import prisma from "@/lib/prisma";
import {
  aiImageModelDefinitions,
  aiModelDefinitions,
} from "@/lib/aiModelOptions";
import { getBoardAgentMembers } from "@/utils/controllers/agents/boardMembers";
import { turbopufferFetchMentionTasks } from "../search/document";
import { isFeatureEnabled, PAGE_MENTIONS_FLAG } from "@/lib/flags";

const taskSearchByParam = async (
  rawParam: string,
  userid: number,
  projectId: number
) => {
  try {
    const hyperAiId = parseInt(process.env.NEXT_PUBLIC_HYPERAI_ID || "332");
    // HTPR-4478: this route fires on every @-mention keystroke. projectIds
    // (needs only userid), owner_members (only projectId) and hyperAI (a
    // constant id) are mutually independent, so fetch them concurrently
    // instead of in three sequential round trips.
    const [projectIds, owner_members, hyperAI, pageMentionsEnabled] = await Promise.all([
      fetchidlist(userid),
      prisma.project.findFirst({
        where: {
          id: projectId,
          status: "Normal",
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
      // Fail open on the gate, never on the menu: this route had no dependency
      // on the flag table before, and a read failure there must not blank the
      // whole @ list (people, agents, tasks, boards) for everyone.
      isFeatureEnabled(PAGE_MENTIONS_FLAG, userid).catch(() => false),
    ]);

    let hyperAIObject = { ...hyperAI, displayName: "HyperAI" };

    // Pages are only offered for a board the caller is actually a member of.
    const canMentionPages = pageMentionsEnabled && projectIds.includes(projectId);

    const param = cleanQuery(rawParam);
    const wordsInQuery = getQueryWords(param);
    // ponytail: this search path does not load plan/provider settings; the
    // hyper-mentioned route enforces both gates and falls back server-side.
    const normalizedModelQuery = normalizeModelMentionSearch(rawParam);
    const modelMentionArray =
      param === "all" || !normalizedModelQuery
        ? []
        : [...aiModelDefinitions, ...aiImageModelDefinitions]
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

      // HTPR-4478: projects, recent tasks and board agents are independent
      // reads; run them concurrently instead of three sequential round trips.
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
        fetchMentionPages(canMentionPages, projectId, ""),
      ]);

      const updatedtask = task?.map((item: any) => ({
        id: item?.id,
        name: item?.title, // Change the property name here
        type: "task",
        index: item.uniqueIndex,
        project_id: item?.projectId, // Keep other properties unchanged
        ticketNumber: item?.ticketNumber,
      }));

      const updatedProjects = projects?.map((item: any) => ({
        id: item?.id,
        name: item?.title,
        type: "project",
        identifier: (item?.uniqueIdentifier ?? "").toString().toUpperCase(),
      }));

      const updatedAgents = boardAgentRows.slice(0, 5).map((row) => ({
        id: row.agent.id,
        name: row.agent.displayName,
        userId: row.agent.userId,
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
        item.displayName.toLowerCase().includes(param.toLowerCase())
      );
      const firstFiveResults = filteredData.slice(0, 5);
      newArray =
        firstFiveResults &&
        firstFiveResults?.map((item) => ({
          id: item?.id,
          name: item?.displayName,
          type: "name",
        }));

      // HTPR-4478: the Turbopuffer task search, the project search and the
      // board-agent lookup are independent; run them concurrently instead of
      // three sequential round trips (Turbopuffer is the slow one, so this
      // matters most on this branch).
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
        fetchMentionPages(canMentionPages, projectId, param),
      ]);

      const updatedProjects = projects?.map((item: any) => ({
        id: item?.id,
        name: item?.title,
        type: "project",
        identifier: (item?.uniqueIdentifier ?? "").toString().toUpperCase(),
      }));

      const updatedAgents = boardAgentRows
        .filter((row) =>
          row.agent.displayName
            .toLowerCase()
            .includes(param.toLowerCase())
        )
        .slice(0, 5)
        .map((row) => ({
          id: row.agent.id,
          name: row.agent.displayName,
          userId: row.agent.userId,
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

/**
 * The Pages group, or nothing at all when there are no pages to offer. Omitting
 * the heading keeps the response byte-identical to the pre-feature one for a
 * user the flag is off for.
 */
const pageGroup = (pages: MentionPage[]) =>
  pages.length
    ? [{ name: "Pages", type: "pageHeading", count: pages.length }, ...pages]
    : [];

interface MentionPage {
  id: string;
  name: string;
  type: string;
  ticketNumber: string;
}

/**
 * Canvas pages of the current board, offered as a "Pages" group in the @ menu
 * (HTPR-5898). `id` carries the page publicId because that is what
 * buildRichTextMentionHref turns into /page/<id>; `name` is the chip's text.
 * An empty `titleQuery` means the caller typed nothing yet, so return the newest.
 * Page.task is a required relation, so every page has a parent task; only
 * Task.ticketNumber itself is nullable, hence the fallback on the label.
 */
const fetchMentionPages = async (
  enabled: boolean,
  projectId: number,
  titleQuery: string,
): Promise<MentionPage[]> => {
  if (!enabled) return [];
  try {
    const pages = await prisma.page.findMany({
      take: 5,
      where: {
        projectId,
        archived: false,
        task: { deletedAt: null },
        ...(titleQuery
          ? { title: { contains: titleQuery, mode: "insensitive" as const } }
          : {}),
      },
      orderBy: { id: "desc" },
      select: {
        publicId: true,
        title: true,
        task: { select: { ticketNumber: true } },
      },
    });
    return pages.map((page) => ({
      id: page.publicId,
      name: page.title,
      type: "page",
      ticketNumber: page.task.ticketNumber ?? "",
    }));
  } catch (error) {
    // Degrade to "no Pages group" rather than losing the whole @ menu, but make
    // the reason loud: a silent empty group is indistinguishable from a board
    // that genuinely has no pages.
    console.error("🤔 ~ fetchMentionPages ~ error:", error);
    return [];
  }
};

const fetchidlist = async (id: number) => {
  try {
    if (id) {
      const projectid = await prisma.project.findMany({
        where: {
          OR: [
            {
              members: {
                some: {
                  userId: id,
                },
              },
            },
            {
              ownerId: {
                in: [id],
              },
            },
          ],
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
