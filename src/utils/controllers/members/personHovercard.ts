import prisma from "@/lib/prisma";
import type {
  PersonHovercardProfile,
  PersonHovercardSubject,
} from "@/models/personHovercard";

type PersonRow = {
  id: number;
  displayName: string | null;
  email: string;
  photoURL: string | null;
};

type AgentRow = {
  id: string;
  displayName: string;
  photoURL: string | null;
};

export type PersonHovercardStore = {
  project: {
    findFirst(args: unknown): Promise<{ ownerId: number } | null>;
  };
  user: {
    findUnique(args: unknown): Promise<PersonRow | null>;
  };
  member: {
    findFirst(args: unknown): Promise<
      | { user: PersonRow }
      | { agent: AgentRow | null }
      | null
    >;
  };
};

export type ResolvePersonHovercardResult =
  | { ok: true; profile: PersonHovercardProfile }
  | { ok: false; status: 403 | 404; message: string };

const optionalText = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const userProfile = (user: PersonRow): PersonHovercardProfile => ({
  kind: "user",
  id: user.id,
  displayName: optionalText(user.displayName) ?? "Unnamed user",
  ...(optionalText(user.email) ? { email: optionalText(user.email) } : {}),
  ...(optionalText(user.photoURL)
    ? { photoURL: optionalText(user.photoURL) }
    : {}),
});

const agentProfile = (agent: AgentRow): PersonHovercardProfile => ({
  kind: "agent",
  id: agent.id,
  displayName: optionalText(agent.displayName) ?? "Unnamed agent",
  ...(optionalText(agent.photoURL)
    ? { photoURL: optionalText(agent.photoURL) }
    : {}),
});

export async function resolvePersonHovercardWithStore(
  store: PersonHovercardStore,
  projectId: number,
  requestingUserId: number,
  subject: PersonHovercardSubject,
): Promise<ResolvePersonHovercardResult> {
  const project = await store.project.findFirst({
    where: {
      id: projectId,
      status: "Normal",
      OR: [
        { ownerId: requestingUserId },
        {
          members: {
            some: {
              userId: requestingUserId,
              agentId: null,
              status: "Accepted",
            },
          },
        },
      ],
    },
    select: { ownerId: true },
  });

  if (!project) {
    return { ok: false, status: 403, message: "Board access denied" };
  }

  if (subject.kind === "user") {
    let user: PersonRow | null | undefined;
    if (subject.id === project.ownerId) {
      user = await store.user.findUnique({
        where: { id: subject.id },
        select: {
          id: true,
          displayName: true,
          email: true,
          photoURL: true,
        },
      });
    } else {
      const membership = await store.member.findFirst({
        where: {
          projectId,
          userId: subject.id,
          agentId: null,
          status: "Accepted",
        },
        select: {
          user: {
            select: {
              id: true,
              displayName: true,
              email: true,
              photoURL: true,
            },
          },
        },
      });
      user = membership && "user" in membership ? membership.user : null;
    }

    return user
      ? { ok: true, profile: userProfile(user) }
      : { ok: false, status: 404, message: "Person not found on this board" };
  }

  const membership = await store.member.findFirst({
    where: {
      projectId,
      agentId: subject.id,
      status: "Accepted",
      agent: { revokedAt: null },
    },
    select: {
      agent: {
        select: {
          id: true,
          displayName: true,
          photoURL: true,
        },
      },
    },
  });
  const agent = membership && "agent" in membership ? membership.agent : null;

  return agent
    ? { ok: true, profile: agentProfile(agent) }
    : { ok: false, status: 404, message: "Person not found on this board" };
}

export function resolvePersonHovercard(
  projectId: number,
  requestingUserId: number,
  subject: PersonHovercardSubject,
) {
  return resolvePersonHovercardWithStore(
    prisma as unknown as PersonHovercardStore,
    projectId,
    requestingUserId,
    subject,
  );
}
