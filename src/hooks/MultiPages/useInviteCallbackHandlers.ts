import { CreateInviteInterface, IAgent, IProject, IUser } from "@/models/model";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { boardAgentsQueryKey } from "@/hooks/MultiPages/useAgents";

const useInviteCallbackHandlers = () => {
  const router = useRouter();
  const queryClient = useQueryClient();

  const inviteNewMembersToBoard = async (
    emails: string[],
    _currentProject: IProject,
    currentUser: IUser
  ) => {
    if (!_currentProject) return;

    const body: CreateInviteInterface = {
      userId: currentUser.id,
      projectId: _currentProject.id,
      emails: emails,
      projectName: _currentProject.title ?? "",
      invitedBy: currentUser.displayName ?? "",
    };
    const response = await axios.post("/api/invite/createInviteLink", body);
    if (response.status === 200) {
      toast("Invitation Sent Successfully");
      queryClient.refetchQueries({ queryKey: ["projectsAll"] });
    }

    router.refresh();
  };

  const removeMemberFromBoard = async (member: IUser, _currentProject: IProject) => {
    if (!_currentProject) return;

    axios.post("/api/projects/removeMember", {
      projectId: _currentProject.id,
      userId: member.id,
    });
    toast(
      `${member.displayName} has been successfully removed from ${_currentProject.title}`
    );
    queryClient.refetchQueries({ queryKey: ["projectsAll"] });
    queryClient.refetchQueries({ queryKey: ["getAllTeamsMinimal"] });
    queryClient.refetchQueries({ queryKey: ["getAllFavorites"] });
    router.refresh();
  };

  const changeMemberRole = async (
    member: IUser,
    role: "Admin" | "Member",
    _currentProject: IProject
  ) => {
    if (!_currentProject) return;

    await axios.post("/api/projects/setMemberRole", {
      projectId: _currentProject.id,
      targetUserId: member.id,
      role,
    });
    toast(
      role === "Admin"
        ? `${member.displayName} is now a board Admin`
        : `${member.displayName} is no longer a board Admin`
    );
    queryClient.refetchQueries({ queryKey: ["projectsAll"] });
    router.refresh();
  };

  const addAgentToBoard = async (agent: IAgent, _currentProject: IProject) => {
    if (!_currentProject) return;

    const response = await axios.post("/api/members/addAgent", {
      projectId: _currentProject.id,
      agentId: agent.id,
    });
    if (response.status === 200) {
      toast(`${agent.displayName} was added to ${_currentProject.title}`);
      queryClient.refetchQueries({ queryKey: ["projectsAll"] });
      queryClient.refetchQueries({
        queryKey: boardAgentsQueryKey(_currentProject.id),
      });
      queryClient.refetchQueries({ queryKey: ["agents"] });
      queryClient.refetchQueries({
        queryKey: ["assign", _currentProject.id],
      });
      router.refresh();
    }
  };

  const removeAgentFromBoard = async (
    agent: IAgent,
    _currentProject: IProject
  ) => {
    if (!_currentProject) return;

    await axios.post("/api/members/removeAgent", {
      projectId: _currentProject.id,
      agentId: agent.id,
    });
    toast(
      `${agent.displayName} was removed from ${_currentProject.title}`
    );
    queryClient.refetchQueries({ queryKey: ["projectsAll"] });
    queryClient.refetchQueries({
      queryKey: boardAgentsQueryKey(_currentProject.id),
    });
    queryClient.refetchQueries({ queryKey: ["agents"] });
    queryClient.refetchQueries({
      queryKey: ["assign", _currentProject.id],
    });
    router.refresh();
  };

  const reSendInvite = async (
    email: string,
    _currentProject: IProject,
    currentUser: IUser
  ) => {
    if (!_currentProject) return;
    axios.post("/api/invite/reSendInvite", {
      projectId: _currentProject.id,
      email,
      userId: currentUser.id,
    });
    toast(`${email} was sent another invite for: ${_currentProject.title}`);
  };

  const cancelInvite = async (email: string, _currentProject: IProject) => {
    if (!_currentProject) return;
    axios.post("/api/invite/cancelInvite", {
      projectId: _currentProject.id,
      email,
    });
    toast(`Invite successfully cancelled`);
  };

  return {
    removeMemberFromBoard,
    changeMemberRole,
    inviteNewMembersToBoard,
    addAgentToBoard,
    removeAgentFromBoard,
    reSendInvite,
    cancelInvite,
  };
};

export default useInviteCallbackHandlers;
