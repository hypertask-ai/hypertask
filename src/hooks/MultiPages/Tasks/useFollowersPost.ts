import { useGetAllFollowers } from "@/hooks/Task Detail/useGetFollowers";
import { ITask } from "@/models/model";
import { currentUserAtom } from "@/store";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useRecoilState } from "@/lib/state";

const useFollowers = (task: ITask) => {
  const [currentUser, _setCurrentUser] = useRecoilState(currentUserAtom);
  const { data: followers } = useGetAllFollowers(
    ["followersFor:", task.id],
    task.id,
  );
  const queryClient = useQueryClient();
  const path = `${process.env.NEXT_PUBLIC_BASEURL}/detail/project-${task.projectId}/${task.uniqueIndex}`;

  const PostFollower = async (userId: number, taskId: number) => {
    const check = followers?.some(
      (item: any) => item?.userId === userId && item.taskId === taskId,
    );
    if (check) return;
    if (parseInt(task.userId as string) === userId) return;

    try {
      const response = await axios.post("/api/follower/createFollower", {
        userId,
        taskId,
        mentionById: currentUser.id,
      });

      if (response.status === 200) {
        queryClient.refetchQueries({
          queryKey: ["followersFor:", task.id],
        });
        sendEmailToFollower({
          receiver: userId,
          sender: currentUser.displayName,
          taskTitle: task.title,
          taskLink: path,
          taskId: task.id,
        });
      }
    } catch (error) {
      console.log("🚀 ~ PostFollower ~ error:", error);
    }
  };

  const PostMention = (userId: number, taskId: number, commentId?: number) => {
    try {
      axios.post("/api/comments/createMention", {
        userId,
        taskId,
        mentionedBy: currentUser.id,
        taskTitle: task?.title,
        //Just letting ya'll know commentId is almost never provided to this function. The API might be getting it from somewhere else.
        //I just refactored and styled this page. I didn't fix it because it was out of my work scope.
        taskLink: path + `?commentId=${commentId}`,
        commentId,
        projectId: task.projectId,
      });

      sendEmailToFollower({
        receiver: userId,
        sender: currentUser?.displayName,
        taskTitle: task?.title,
        taskLink: path,
        mentionType: "mention", // to differentiate from follower emails
        taskId: task?.id,
      });
    } catch (error) {
      console.log("error creating mention notification", error);
    }
  };

  /** Adds agent as follower; Mentioned notification is created server-side in createFollower */
  async function handleAgentMention(agentId: string, taskId: number) {
    //I think we need to make this function seperate of the others perhaps.
    //Fuck it I'll duplicate it for now. This is in useCreateTaskModalstates and here
    try {
      const response = await axios.post("/api/follower/createFollower", {
        agentId,
        taskId,
        mentionById: currentUser.id,
      });
    } catch (error) {
      console.log("🚀 ~ handleAgentMention ~ error:", error);
    }
  }

  function sendEmailToFollower(body: {
    receiver: number;
    sender: string;
    taskTitle: string;
    taskLink: string;
    mentionType?: "mention";
    taskId?: number;
  }) {
    try {
      axios.post("/api/notifications/sendEmailToFollower", { ...body });
    } catch (error) {
      console.log("🚀 ~ sendEmailToFollower ~ error:", error);
    }
  }

  return {
    PostFollower,
    PostMention,
    handleAgentMention,
  };
};

export default useFollowers;
