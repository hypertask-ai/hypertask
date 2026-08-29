import { IAgent } from "@/models/model";
import UserAvatar from "@/components/Common/UserAvatar";

interface AgentSettingsListProps {
  agents: IAgent[];
  emptyLabel: string;
  isLoading: boolean;
  showBoards?: boolean;
}

const AgentSettingsList: React.FC<AgentSettingsListProps> = ({
  agents,
  emptyLabel,
  isLoading,
  showBoards = false,
}) => {
  if (isLoading) {
    return (
      <div className="rounded-[5px] px-2 py-2 text-dense font-medium text-text-light-gray">
        Loading agents
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="rounded-[5px] px-2 py-2 text-dense font-medium text-text-light-gray">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {agents.map((agent) => {
        const boards = agent.boards ?? [];

        return (
          <div
            className="flex items-center gap-3 rounded-[5px] px-2 py-2 hover:bg-hover-active"
            key={agent.id}
          >
            <UserAvatar
              alt=""
              name={agent.displayName}
              photoURL={agent.photoURL}
              size={24}
              title={agent.displayName}
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-dense font-medium text-white-black">
                  {agent.displayName}
                </span>
                {agent.revokedAt && (
                  <span className="shrink-0 rounded-[4px] bg-active-modal-element px-1.5 py-[1px] text-micro font-medium text-text-light-gray">
                    Disabled
                  </span>
                )}
              </div>
              {showBoards && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {boards.map((board) => (
                    <span
                      className="max-w-40 truncate rounded-[4px] bg-active-modal-element px-1.5 py-[1px] text-micro font-medium text-text-light-gray"
                      key={board.id}
                      title={board.name}
                    >
                      {board.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default AgentSettingsList;
