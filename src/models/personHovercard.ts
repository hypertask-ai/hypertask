export type PersonHovercardSubject =
  | { kind: "user"; id: number }
  | { kind: "agent"; id: string };

type PersonHovercardProfileBase = {
  displayName: string;
  photoURL?: string;
};

export type PersonHovercardProfile =
  | (PersonHovercardProfileBase & {
      kind: "user";
      id: number;
      email?: string;
    })
  | (PersonHovercardProfileBase & {
      kind: "agent";
      id: string;
    });
