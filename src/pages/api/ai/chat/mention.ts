import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { httpStatusConfig } from "@/lib/configs/http-status.config";
import prisma from "@/lib/prisma";
import type { AgentMentionItem } from "@/models/model";
import { getBoardAgentMembers } from "@/utils/controllers/agents/boardMembers";
import { turbopufferFetchMentionTasks } from "@/utils/controllers/search/document";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "GET") {
    try {
      const query = req.query;
      const { param, projectId } = query;
      const userObj = req.cookies?.nookies_user
        ? JSON.parse(req.cookies.nookies_user)
        : null;
      if (!userObj || !userObj.id)
        return res.status(401).json({ message: "Unauthorized" });
      if (!param)
        return res
          .status(400)
          .json({ message: httpStatusConfig.statusCodes[400].userMessage });

      const projectIds = await fetchidlist(userObj?.id);
      if (projectIds.length === 0) {
        return res
          .status(400)
          .json({ message: httpStatusConfig.statusCodes[400].userMessage });
      }
      const owner_members = await prisma.project.findFirst({
        where: {
          id: {
            in: projectIds,
          },
          status: "Normal",
        },
        select: {
          owner: true,
          members: {
            select: {
              user: true,
            },
          },
        },
      });

      const proccessedParam = cleanQuery(param as string);
      const wordsInQuery = getQueryWords(proccessedParam);
      const parsedProjectId =
        typeof projectId === "string" ? parseInt(projectId, 10) : null;
      const boardAgentRows =
        parsedProjectId && projectIds.includes(parsedProjectId)
          ? await getBoardAgentMembers(parsedProjectId)
          : [];
      const updatedAgents: AgentMentionItem[] = boardAgentRows
        .filter(
          (row) =>
            proccessedParam === "all" ||
            row.agent.displayName
              .toLowerCase()
              .includes(proccessedParam.toLowerCase())
        )
        .slice(0, 5)
        .map((row) => ({
          id: row.agent.id,
          name: row.agent.displayName,
          photoURL: row.agent.photoURL,
          type: "agent",
        }));

      const members_array: any[] | undefined = owner_members?.members.map(
        (item) => item.user
      );
      var combinedArray: any[] = [];
      if (members_array && owner_members) {
        combinedArray = [owner_members?.owner, ...members_array].filter(
          Boolean
        );
      } else {
        combinedArray = [owner_members?.owner].filter(Boolean);
      }

      const slicedarray = combinedArray?.slice(0, 5);
      let newArray = slicedarray?.map((item) => ({
        id: item?.id,
        name: item?.displayName,
        type: "name",
      }));

      if (proccessedParam == "all") {
        console.log("🤔 ~ taskSearchByParam ~ FETCHING ALL");

        const projects = await prisma.project.findMany({
          take: 5,
          where: {
            id: {
              in: projectIds,
            },
          },
        });

        const task = await prisma.task.findMany({
          take: 5,
          where: {
            projectId: {
              in: projectIds,
            },
            deletedAt: null,
            updatedAt: {
              not: null,
            },
          },
          orderBy: {
            updatedAt: "desc",
          },
        });

        const updatedtask = task?.map((item: any) => ({
          id: item?.id,
          name: item?.title, // Change the property name here
          type: "task",
          index: item.uniqueIndex,
          project_id: item?.projectId, // Keep other properties unchanged
          ticketNumber: item?.ticketNumber,
          status: item?.status,
        }));

        const updatedProjects = projects?.map((item: any) => ({
          id: item?.id,
          name: item?.title,
          type: "project",
          identifier: (item?.uniqueIdentifier ?? "").toString().toUpperCase(),
        }));

        return res.status(200).json([
          {
            name: "Boards",
            type: "projectHeading",
            count: updatedProjects.length,
          },
          ...updatedProjects,
          { name: "Tasks", type: "taskHeading", count: updatedtask.length },
          ...updatedtask,
          { name: "Agents", type: "agentHeading", count: updatedAgents.length },
          ...updatedAgents,
          { name: "People", type: "peopleHeading", count: newArray.length },
          ...newArray,
        ]);
      } else {
        const filteredData = combinedArray.filter((item) =>
          item.displayName.toLowerCase().includes(proccessedParam.toLowerCase())
        );
        const firstFiveResults = filteredData.slice(0, 5);
        newArray =
          firstFiveResults &&
          firstFiveResults?.map((item) => ({
            id: item?.id,
            name: item?.displayName,
            type: "name",
          }));

        const updatedtask = await turbopufferFetchMentionTasks(
          param as string,
          projectIds,
          projectId ? parseInt(projectId as string, 10) : null
        );

        const projects = await prisma.project.findMany({
          take: 5,
          where: {
            id: {
              in: projectIds,
            },
            OR: [
              {
                uniqueIdentifier: {
                  contains: (param as string).toLowerCase(),
                  mode: "insensitive",
                },
              },
              {
                title: {
                  contains: proccessedParam.toLowerCase(),
                  mode: "insensitive",
                },
              },
              {
                title: {
                  contains: (param as string).toLowerCase(),
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
        });

        const updatedProjects = projects?.map((item: any) => ({
          id: item?.id,
          name: item?.title,
          type: "project",
          identifier: (item?.uniqueIdentifier ?? "").toString().toUpperCase(),
          status: item.status,
        }));

        return res.status(200).json([
          {
            name: "Boards",
            type: "projectHeading",
            count: updatedProjects.length,
          },
          { name: "Tasks", type: "taskHeading", count: updatedtask.length },
          ...updatedtask,
          ...updatedProjects,
          { name: "Agents", type: "agentHeading", count: updatedAgents.length },
          ...updatedAgents,
          { name: "People", type: "peopleHeading", count: newArray.length },
          ...newArray,
        ]);
      }
    } catch (error) {
      console.log("🤔 ~ TaskSearchByParams ERROR:", error);
      return res
        .status(500)
        .json({ message: httpStatusConfig.statusCodes[500].userMessage });
    }
  } else {
    return res
      .status(405)
      .json({ message: httpStatusConfig.statusCodes[405].userMessage });
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

export default handler;
