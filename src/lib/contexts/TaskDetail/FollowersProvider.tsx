"use client";
import { useContext, createContext } from "react";
import { useTaskContext } from "./TaskProvider";
import { useGetAllFollowers } from "@/hooks/Task Detail/useGetFollowers";
import useFollowers from "@/hooks/MultiPages/Tasks/useFollowersPost";

interface FollowersContextProps {
  prefix: string;
  followers: any[];
  PostFollower: (userId: number, taskId: number) => Promise<void>;
  PostMention: (userId: number, taskId: number, commentId?: number) => void;
  handleAgentMention: (agentId: string, taskId: number) => Promise<void>;
}

export const FollowersProvider: React.FC<any> = ({ children }) => {
  const { currentTask } = useTaskContext();
  const { data: followers } = useGetAllFollowers(
    ["followersFor:", currentTask?.id],
    currentTask?.id!,
  );

  const { PostFollower, PostMention, handleAgentMention } = useFollowers(
    currentTask!,
  );

  const exportThis = {
    prefix: "followersFor:",
    followers,
    PostFollower,
    PostMention,
    handleAgentMention,
  };

  return (
    <FollowersContext.Provider value={exportThis}>
      {children}
    </FollowersContext.Provider>
  );
};
const FollowersContext = createContext<FollowersContextProps | undefined>(
  undefined,
);

export const useFollowersContext = () => {
  const context = useContext(FollowersContext);
  if (!context) {
    throw new Error(
      "usefollowerscontext must be used within a FollowersProvider",
    );
  }
  return context;
};
