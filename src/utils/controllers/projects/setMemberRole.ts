import prisma from "@/lib/prisma";

type MemberRole = "Admin" | "Member";

export type SettingOperationReceipt = { id: string; userId: number; proposalId: string; action: string };

const setMemberRole = async (
  actingUserId: number,
  projectId: number,
  targetUserId: number,
  role: MemberRole,
  expectedRole?: MemberRole,
  operation?: SettingOperationReceipt,
) => {
  try {
    if (!actingUserId || !projectId || !targetUserId || !role) {
      return ({
        status: 400,
        json: { message: "Missing required information" },
      });
    }

    if (role !== "Admin" && role !== "Member") {
      return ({
        status: 400,
        json: { message: "Invalid member role" },
      });
    }

    const project = await prisma.project.findUnique({
      where: {
        id: projectId,
      },
    });

    if (!project) {
      return ({
        status: 400,
        json: { message: "Project not valid" },
      });
    }

    if (project.ownerId !== actingUserId) {
      return ({
        status: 401,
        json: { message: "Only Board owner can change member roles." },
      });
    }

    if (actingUserId === targetUserId) {
      return ({
        status: 400,
        json: { message: "Cannot change your own member role" },
      });
    }

    if (targetUserId === project.ownerId) {
      return ({
        status: 400,
        json: { message: "Cannot change project owner role" },
      });
    }

    const member = await prisma.member.findFirst({
      where: {
        userId: targetUserId,
        projectId,
        status: "Accepted",
        agentId: null,
      },
    });

    if (!member) {
      return ({
        status: 400,
        json: { message: "Member not found" },
      });
    }

    if (expectedRole !== undefined) {
      const where = {
        id: member.id,
        userId: targetUserId,
        status: "Accepted",
        agentId: null,
        role: expectedRole,
        project: { ownerId: actingUserId, status: { not: "Deleted" } },
      } as const;
      const changed = operation
        ? await prisma.$transaction(async (tx) => {
          const result = await tx.member.updateMany({ where, data: { role } });
          if (result.count === 1) await tx.aiSettingOperation.create({ data: operation });
          return result;
        })
        : await prisma.member.updateMany({ where, data: { role } });
      if (changed.count !== 1) {
        return { status: 409, json: { message: "Role or board access changed since the preview. Ask for a fresh proposal." } };
      }
      return { status: 200, json: { ...member, role } };
    }

    const updatedMember = await prisma.member.update({
      where: {
        id: member.id,
      },
      data: {
        role,
      },
    });

    return ({
      status: 200,
      json: updatedMember,
    });
  } catch (error) {
    console.error(error);
    return ({
      status: 500,
      json: { error: "Failed to change member role" },
    });
  }
};

export default setMemberRole;
