import { IProject, ITask, IUser } from "@/models/model";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import UpdateKanban from "../MultiPages/useUpdateTaskInBoards";
import toast from "react-hot-toast";
import { useRecoilState } from "@/lib/state";
import { currentProjectAtom, currentUserAtom } from "@/store";

const useFollowerKanban = () => {
  const [currentUser, _] = useRecoilState(currentUserAtom);
  const [_currentProject, __] = useRecoilState(currentProjectAtom);
  const queryClient = useQueryClient();
  const { updateTaskInCache } = UpdateKanban();

  const addFollowerKanban = async (taskId: number) => {
    let task: ITask | undefined;
    const response = await axios.post(`/api/tasks/getTaskMinimal`, {
      id: taskId,
    });

    if (response.status === 200) task = response.data;
    if (!task) return;
    const followers: any = queryClient.getQueryData(["followersFor:", task.id]);
    const baseURL =
      String(process.env.NEXT_PUBLIC_BASEURL) ?? "https://app.hypertask.ai";
    const path = `${baseURL}/detail/project-${task.projectId}/${task.uniqueIndex}`;
    if (currentUser.id) {
      const check = followers?.some(
        (item: any) =>
          item?.userId === currentUser.id && item.taskId === task?.id
      );
      if (check) {
        console.log("already exist");
      } else {
        console.log("already exist not", task?.userId === currentUser.id);
        if (task?.userId === currentUser.id) {
          console.log("you are owner");
        } else {
          if (!task) return;
          try {
            await axios
              .post("/api/follower/createFollower", {
                userId: currentUser.id,
                taskId: task.id,
                mentionById: currentUser.id,
              })
              .then((response) => {
                if (response.status === 200 && task) {
                  toast("Added as follower");
                  queryClient.refetchQueries({
                    queryKey: ["followersFor:", taskId],
                  });
                  const taskToReturn = { _count: { notifications: 1 } };
                  updateTaskInCache(
                    taskToReturn,
                    task?.id,
                    task?.projectId,
                    task?.sectionId,
                    _currentProject
                  );
                  try {
                    axios.post("/api/notifications/sendEmailToFollower", {
                      receiver: currentUser.id,
                      sender: currentUser?.displayName,
                      taskTitle: task?.title,
                      taskLink: path,
                      taskId: task?.id,
                    });
                  } catch (error) {
                    console.log("error sending mail");
                  }
                } else if (response.status === 201) {
                  console.log("You are Already in Assignees");
                }
              });
          } catch (error) {
            console.log(error);
          }
        }
      }
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
              // getFollowerById();
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
