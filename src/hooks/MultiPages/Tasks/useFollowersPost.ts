import { useGetAllFollowers } from "@/hooks/Task Detail/useGetFollowers";
import { ITask } from "@/models/model";
import { currentUserAtom } from "@/store";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useRecoilState } from "@/lib/state";
import { refreshTaskDetailReadAfterWrite } from "@/lib/taskDetailReads";
import toast from "react-hot-toast";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8199_FOLLOW_SHORTCUT_FEEDBACK_FLAG } from "@/lib/flags/definitions/htpr-8199-follow-shortcut-feedback";
import { followNote } from "@/lib/followers/followNote";

const useFollowers = (task: ITask) => {
  const [currentUser, _setCurrentUser] = useRecoilState(currentUserAtom);
  const { data: followers } = useGetAllFollowers(
    ["followersFor:", task.id],
    task.id,
  );
  const queryClient = useQueryClient();
  const followsWithNote = useFlag(HTPR_8199_FOLLOW_SHORTCUT_FEEDBACK_FLAG);
  const path = `${process.env.NEXT_PUBLIC_BASEURL}/detail/project-${task.projectId}/${task.uniqueIndex}`;

  const PostFollower = async (userId: number, taskId: number) => {
    const check = followers?.some(
      (item: any) => item?.userId === userId && item.taskId === taskId,
    );
    if (!followsWithNote) {
      if (check) return;
      if (parseInt(task.userId as string) === userId) return;
    }

    try {
      const response = await axios.post("/api/follower/createFollower", {
        userId,
        taskId,
        mentionById: currentUser.id,
      });

      if (response.status === 200) {
        if (currentUser?.id) refreshTaskDetailReadAfterWrite(queryClient, currentUser.id, taskId);
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
        if (followsWithNote) toast("Added as follower");
      } else if (followsWithNote) {
        toast(followNote(response.data));
      }
    } catch (error: any) {
      if (followsWithNote) toast(followNote(error?.response?.data));
      else console.log("🚀 ~ PostFollower ~ error:", error);
    }
  };

  const PostMention = (userId: number, taskId: number, commentId?: number) => {
    try {
      axios.post("/api/comments/createMention", {
        userId,
        taskId,
        mentionedBy: currentUser.id,
        taskTitle: task?.title,
        taskLink: path + `?commentId=${commentId}`,
        commentId,
        projectId: task.projectId,
      });

      sendEmailToFollower({
        receiver: userId,
        sender: currentUser?.displayName,
        taskTitle: task?.title,
        taskLink: path,
        mentionType: "mention",
        taskId: task?.id,
      });
    } catch (error) {
      console.log("error creating mention notification", error);
    }
  };

  async function handleAgentMention(agentId: string, taskId: number) {
    try {
      const response = await axios.post("/api/follower/createFollower", {
        agentId,
        taskId,
        mentionById: currentUser.id,
      });
      if (response.status === 200 && currentUser?.id) refreshTaskDetailReadAfterWrite(queryClient, currentUser.id, taskId);
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
