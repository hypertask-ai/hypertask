import type { IAgent, IUser } from "@/models/model";

type SharePerson = IUser | IAgent;

const personFromRow = (row: unknown): SharePerson | null => {
  if (!row || typeof row !== "object") return null;
  const record = row as { user?: SharePerson | null; agent?: SharePerson | null };
  const person = record.user ?? record.agent;
  if (!person || (typeof person.id !== "number" && typeof person.id !== "string")) return null;
  return person;
};

export const shareFollowerPeople = (followers: unknown): SharePerson[] => {
  if (!Array.isArray(followers)) return [];
  return followers.flatMap((row) => {
    const person = personFromRow(row);
    return person ? [person] : [];
  });
};
