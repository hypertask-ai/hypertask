"use client";

import { useSignout } from "@/hooks/MultiPages/HTC/useSignout";
import { IUser } from "@/models/model";
import { createTeam } from "@/utils/api/Homepage";
import axios from "axios";
import { useState } from "react";
import toast from "react-hot-toast";

const NoBoardsEmptyState = ({ user }: { user: IUser }) => {
  const { handleHardReset } = useSignout();
  const [name, setName] = useState(
    `${user.displayName || (user.email ? user.email.split("@")[0] : "My")} workspace`,
  );
  const [creating, setCreating] = useState(false);

  const handleCreateBoard = async () => {
    if (!name.trim() || creating) return;

    setCreating(true);

    try {
      const teamRes = await createTeam({
        userId: user.id,
        teamTitle: name.trim(),
      });
      const { data: board } = await axios.post("/api/projects/create", {
        userId: user.id,
        title: name.trim(),
        teamId: teamRes.data.id,
        googleAccountId: teamRes.data.googleAccountId,
      });

      window.location.assign("/project?id=" + board.id);
    } catch {
      toast.error("Couldn't create board. Please try again.");
      setCreating(false);
    }
  };

  return (
    <main
      aria-label={`No boards available for ${user.displayName}`}
      className="flex h-SVH-full w-full items-center justify-center bg-pageBackground px-6 text-white-black"
    >
      <div className="flex flex-col items-center text-center">
        <h1 className="text-[20px] font-semibold">No boards yet</h1>
        <p className="mt-2 text-[14px] text-text-light-gray">
          Create your first board to get started.
        </p>

        <input
          type="text"
          aria-label="Workspace name"
          className="mt-6 w-64 rounded-[4px] border border-border bg-containerBackground px-3 py-2 text-[14px] text-white-black outline-none focus:border-border-active"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="button"
          className="mt-4 rounded-2xl bg-hypertasks-purple px-5 py-2 text-[14px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!name.trim() || creating}
          onClick={handleCreateBoard}
        >
          Create board
        </button>
        <button
          type="button"
          className="mt-4 text-[14px] text-text-light-gray hover:text-white-black"
          onClick={() => handleHardReset()}
        >
          Sign out
        </button>
      </div>
    </main>
  );
};

export default NoBoardsEmptyState;
