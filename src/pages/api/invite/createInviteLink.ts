import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { LogType, Status } from "@prisma/client";
import { CreateLogInput, IMember, IViewType } from "@/models/model";
import createLog from "@/utils/controllers/logs/createLog";

import prisma from "@/lib/prisma";
import { getProjectViewInclude } from "@/utils/controllers/projects/getAll";
import { getViewFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { sendEmailNotification } from "@/utils/controllers/notifications/sendNotification";
import { GUEST_FORBIDDEN_MESSAGE, isGuestRequest } from "@/lib/demo/guestGuard";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse,
) => {
  if (req.method === "POST") {
    // HTPR-4303: demo guests can't invite people to throwaway boards.
    if (await isGuestRequest(req)) {
      return res.status(403).json({ message: GUEST_FORBIDDEN_MESSAGE });
    }
    const { userId, projectId, emails } = req.body;
    if (!userId || !projectId || !emails) {
      return res.status(400).json({ message: "Missing required information" });
    }

    const result = await addMemberController(userId, projectId, emails);
    res.status(result?.status).json(result?.json)
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
};

export const addMemberController = async (
  userId: number,
  projectId: number,
  emails: string[],
) => {
  try {
    const currentProject = await prisma.project.findFirst({
      where: {
        id: projectId,
        status: "Normal",
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                email: true,
              },
            },
          },
        },
        owner: true,
        team: true,
        ai_custom_instructions: true,
        project_view: getProjectViewInclude({
          currentUserId: userId,
        }),
      },
    });
    if (!currentProject) throw "Project not found";

    const { emailExists, teamMemberEmails, emailsToInvite } =
      await invitedAndExistingEmails({ projectId, currentProject, emails });

    if (emailExists)
      return {
        status: 400,
        json: "User already part of board",
      };

    // SEND INVITE TO EACH EMAIL
    // there are some recalculations, optimize later, works for now, short on time.
    for (const email of emailsToInvite) {
      console.log("Running invite procedure for the following email: ", email);
      if (currentProject?.owner.email === email) return {status: 201, json: "Cannot add owner email"};

      // check if that member is in the TEAM, if he is, just add him straight away, do not send invite.
      const isInTeamAlready = teamMemberEmails.includes(email);
      console.log(
        "Is user already in the team? " + `${isInTeamAlready ? "Yes" : "No"}`,
      );

      if (!isInTeamAlready) await sendInviteToNonMember(userId, projectId, email);
      else await sendInviteToAlreadyExistingMember(email, currentProject.id);
    }

    return {
      status: 200,
      json: emailsToInvite,
    };
  } catch (error) {
    console.log("🚀 ~ addMemberController ~ error:", error)
    prisma.invite.deleteMany({
      where: { projectId },
    });
    return {
      status: 400,
      json: { message: JSON.stringify(error) },
    };
  }
};

async function sendInviteToNonMember(
  userId: number,
  projectId: number,
  email: string,
) {
  console.log("User isn't in the team, sending invite to join team");
  const invite = await prisma.invite.create({
    data: {
      userId,
      projectId,
      key: "SOME-KEY",
      uses: 1,
      emails: [email],
      expired: false,
    },
    include: {
      invitedBy: true,
      project: {
        select: {
          project_view: getProjectViewInclude({
            currentUserId: userId,
          }),
          title: true,
          team: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      },
    },
  });
  let viewSlug: string | undefined;
  const activeView = getViewFromProject(invite.project);
  viewSlug = setViewSlug(activeView);

  const inviteLink = generateInviteLink(
    invite.id,
    projectId,
    invite.project.title ?? "",
    viewSlug,
  );
  const createLogBody: CreateLogInput = {
    log: `${invite.invitedBy.displayName} sent an invite to "${email}" for board "${invite.project?.title}"`,
    type: LogType.Invite,
    status: Status.Normal,
    LoggedById: userId,
  };
  createLog(createLogBody);
  createNotification(email, inviteLink, userId, invite.id, projectId);
  await sendEmailNotification("Invite", {
    sender: invite.invitedBy.displayName ?? "",
    recipient: email,
    title: invite.project.title ?? "",
    link: inviteLink,
  });
}

export const generateInviteLink = (
  inviteId: string,
  projectId: number,
  projectName: string,
  viewSlug: string | undefined,
) => {
  const baseURL = String(process.env.NEXT_PUBLIC_BASEURL);
  return `${baseURL}/invite?key=${inviteId}&project=${projectName}&projectId=${projectId}${viewSlug ? `&view=${viewSlug}` : ""}`;
};

export const setViewSlug = (activeView: IViewType | undefined) =>
  activeView &&
  activeView.type === "Applied" &&
  activeView.view.visibility === "Public"
    ? activeView.view.slug
    : undefined;

export const createNotification = async (
  email: string,
  inviteLink: string,
  fromUserId: number,
  inviteId: string,
  projectId: number,
) => {
  // check if the user exists so we can create notification, if not just return
  const invitedUser = await prisma.user.findFirst({
    where: { email: email },
  });
  console.log("🚀 ~ createNotification ~ invitedUser:", invitedUser);
  if (!invitedUser) return false;

  // ============= create first notification
  const notification = await prisma.notification.create({
    data: {
      type: "Invited",
      fromUserId: fromUserId,
      userId: invitedUser.id,
      projectId,
      taskId: null,
    },
  });
  console.log("🚀 ~ createNotification ~ notification:", notification);

  // ============ create notification_invite
  const userIdBy = await createUserNotificationInvite(fromUserId);
  const userIdTo = await createUserNotificationInvite(invitedUser.id);

  const notification_invite = await prisma.notification_Invite.create({
    data: {
      userIdBy: userIdBy,
      userIdTo: userIdTo,
      inviteId,
      inviteURL: inviteLink,
      notificationId: notification.id,
    },
  });
  console.log(
    "🚀 ~ createNotification ~ notification_invite:",
    notification_invite,
  );
  await prisma.notification.update({
    where: { id: notification.id },
    data: { notification_inviteId: notification_invite.id },
  });

  return true;
};

const createUserNotificationInvite = async (userId: number) => {
  const check = await prisma.user_Notification_Invites.findFirst({
    where: { userId: userId },
    include: { notificationInviteBy: true, notificationInviteTo: true },
  });
  if (check) return check.id;
  const user_notification_invites =
    await prisma.user_Notification_Invites.create({
      data: {
        userId,
      },
    });
  console.log(
    "🚀 ~ createUserNotificationInvite ~ user_notification_invites:",
    user_notification_invites,
  );
  return user_notification_invites.id;
};

const sendInviteToAlreadyExistingMember = async (
  email: string,
  projectId: number,
) => {
  let user = await prisma.user.findFirst({ where: { email } });
  if (user) {
    const member = await prisma.member.create({
      data: {
        userId: user.id,
        projectId: projectId,
      },
      include: {
        user: true,
      },
    });
    console.log("Member created: ", member);
  }
};

const checkTeamMemberEmails = async (teamId: string) => {
  // first get owner email
  const team = await prisma.team.findFirst({
    where: {
      id: teamId,
    },
    include: {
      googleAccount: {
        select: {
          userId: true,
        },
      },
      members: {
        include: {
          user: true,
        },
      },
    },
  });

  const ownerEmail = await prisma.user.findUnique({
    where: {
      id: team?.googleAccount.userId,
    },
    select: {
      email: true,
    },
  });

  const teamMembersEmails = [
    ownerEmail?.email ?? null,
    ...(team?.members.flatMap((x) => x.user.email) ?? []),
  ].filter(Boolean);

  return teamMembersEmails;
};

interface IInvitedAndExistingEmails {
  projectId: number;
  emails: string[];
  currentProject: any;
}

const invitedAndExistingEmails = async ({
  projectId,
  emails,
  currentProject,
}: IInvitedAndExistingEmails) => {
  const invitesForCurrentProj = await prisma.invite.findMany({
    where: {
      projectId: projectId,
      expired: false,
    },
    select: {
      emails: true,
    },
  });
  console.log(
    "🚀 ~ file: createInviteLink.ts:42 ~ consthandler:NextApiHandler= ~ invitesForCurrentProj:",
    invitesForCurrentProj,
  );
  const alreadyInvitedEmails = invitesForCurrentProj.map(
    (invite) => invite.emails[0],
  );
  const emailsToInvite = emails.filter(
    (email: string) => !alreadyInvitedEmails.includes(email),
  );

  console.log("======>  Emails to invite: ", emailsToInvite);
  const emailExists = currentProject?.members.some((member: IMember) =>
    emails.includes(member?.user.email!),
  );
  const teamMemberEmails = await checkTeamMemberEmails(currentProject.teamId!);
  console.log("---- Current Team has the following emails: ", teamMemberEmails);
  return {
    teamMemberEmails,
    emailExists,
    emailsToInvite,
  };
};
export default handler;
