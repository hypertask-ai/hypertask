import { IProject, ITask, IUser } from "@/models/model";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import UpdateKanban from "../MultiPages/useUpdateTaskInBoards";
import toast from "react-hot-toast";
import { useRecoilState } from "@/lib/state";
import { currentProjectAtom, currentUserAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8199_FOLLOW_SHORTCUT_FEEDBACK_FLAG } from "@/lib/flags/definitions/htpr-8199-follow-shortcut-feedback";
import { followNote } from "@/lib/followers/followNote";

const useFollowerKanban = () => {
  const [currentUser, _] = useRecoilState(currentUserAtom);
  const [_currentProject, __] = useRecoilState(currentProjectAtom);
  const queryClient = useQueryClient();
  const { updateTaskInCache } = UpdateKanban();
  const followsWithNote = useFlag(HTPR_8199_FOLLOW_SHORTCUT_FEEDBACK_FLAG);

  const addFollowerKanban = async (taskId: number) => {
    let task: ITask | undefined;
    const response = await axios.post(`/api/tasks/getTaskMinimal`, {
      id: taskId,
    });

    if (response.status === 200) task = response.data;
    if (!task) return;
    const baseURL =
      String(process.env.NEXT_PUBLIC_BASEURL) ?? "https://app.hypertask.ai";
    const path = `${baseURL}/detail/project-${task.projectId}/${task.uniqueIndex}`;
    if (!currentUser.id) return;
    if (!followsWithNote && task.userId === currentUser.id) return;
    try {
      const follow = await axios.post("/api/follower/createFollower", {
        userId: currentUser.id,
        taskId: task.id,
        mentionById: currentUser.id,
      });
      if (follow.status !== 200) {
        if (followsWithNote) toast(followNote(follow.data));
        return;
      }
      toast("Added as follower");
      queryClient.refetchQueries({ queryKey: ["followersFor:", taskId] });
      updateTaskInCache(
        { _count: { notifications: 1 } },
        task.id,
        task.projectId,
        task.sectionId,
        _currentProject
      );
      try {
        axios.post("/api/notifications/sendEmailToFollower", {
          receiver: currentUser.id,
          sender: currentUser?.displayName,
          taskTitle: task.title,
          taskLink: path,
          taskId: task.id,
        });
      } catch (error) {
        console.log("error sending mail");
      }
    } catch (error: any) {
      if (followsWithNote) toast(followNote(error?.response?.data));
      else console.log(error);
    }
  };

  const removeFollowerKanban = async (taskId: number) => {
    const followers: any = queryClient.getQueryData(["followersFor:", taskId]);
    const matchedObject = followers.find(
      (item: any) => item.userId === currentUser?.id
    );

    if (matchedObject && matchedObject.id) {
      try {
        await axios
          .post("/api/follower/unFollowTask", {
            id: matchedObject.id,
          })
          .then((response) => {
            if (response.status === 200) {
              toast("Removed as follower");
              queryClient.refetchQueries({
                queryKey: ["followersFor:", taskId],
              });
            }
          });
      } catch (error) {
        console.log(error);
      }
    }
  };

  return { addFollowerKanban, removeFollowerKanban };
};

export default useFollowerKanban;
