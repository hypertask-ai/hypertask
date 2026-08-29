import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import { useGetAllTeamsMinimal } from "@/hooks/MultiPages/useGetAllTeamsMinimal";
import { ITeam } from "@/models/model";

import {
  ChangeEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import toast from "react-hot-toast";
import { getCreateBoardPendingHeader } from "./createBoardStatus";

type Props = {
  createBoard: (
    mode: string,
    title: string,
    teamId: string | null,
    googleAccountId: string | null,
    teamTitle?: string
  ) => void;
  //payload is only for creating team
  payload?: {
    teamId: string;
    googleAccountId: string;
  };
};

const CreateBoard = (props: Props) => {
  const currentUser = useRecoilValue(currentUserAtom);
  const { createBoard, payload } = props;
  const [title, setTitle] = useState("");
  const [currentScreen, setCurrentScreen] = useState<
    "Create Board" | "Select Team"
  >("Create Board");
  const [creatingBoard, setCreatingTeam] = useState<boolean>(false);
  const [keyword, setKeyword] = useState("");
  const [filteredTeams, setFilteredTeams] = useState<ITeam[]>([]);
  const [selectedTeam, setSelectedTeam] = useState(filteredTeams[0]);
  const currentHoveredDiv = useRef<number | null>(null);
  const teamRef = useRef<HTMLDivElement>(null);
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
  const { data: teams } = useGetAllTeamsMinimal(currentUser?.id);

  const onKeyChangeSelectTeam = (e: ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setKeyword(text);
    const filteredTeams_ = teams.filter(
      (team: { title: string }) =>
        team.title.toLowerCase().indexOf(text.toLowerCase()) > -1
    );
    setFilteredTeams(filteredTeams_);
    setSelectedTeam(filteredTeams_[0]);
    document
      .getElementById(`command-0`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleGetTeams = () => {
    setSelectedTeam(teams[0]);
    setFilteredTeams(teams);
  };

  const enterHandler = () => {
    setCreatingTeam(true);
    if (filteredTeams.length > 0)
      createBoard(
        "Create Board",
        title,
        selectedTeam.id,
        selectedTeam.googleAccountId
      );
    else if (filteredTeams.length === 0)
      createBoard("CreateTeamBoard", title, null, null, keyword);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const index = filteredTeams.findIndex(
      (item) => item.id === selectedTeam.id
    );

    if (e.keyCode === KeyCodes.TAB) {
      e.preventDefault();
      return;
    }
    if (e.keyCode === KeyCodes.J || e.keyCode === KeyCodes.ARROW_DOWN) {
      if (selectedTeam) {
        if (index === -1 || index === filteredTeams.length - 1) {
          // No action needed
        } else {
          setSelectedTeam(filteredTeams[index + 1]);
          document
            .getElementById(`command-${index + 1}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    }

    if (e.keyCode === KeyCodes.K || e.keyCode === KeyCodes.ARROW_UP) {
      if (selectedTeam) {
        if (index <= 0) {
          // No action needed
        } else {
          setSelectedTeam(filteredTeams[index - 1]);
          document
            .getElementById(`command-${index - 1}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    }

    if (e.keyCode === KeyCodes.ENTER) {
      if (currentScreen === "Create Board") {
        if (payload) {
          setCreatingTeam(true);
          createBoard(
            "Create Board",
            title,
            payload.teamId,
            payload.googleAccountId
          );
        } else {
          if (title.length < 4) {
            toast.error("Board name must be atleast 4 characters long");
            return;
          }
          setCurrentScreen("Select Team");
          setSelectedTeam(teams[0]);
        }
      } else {
        enterHandler();
      }
    }
  };

  const handleMouseEnter = (index: number) =>
    (currentHoveredDiv.current = index);

  const handleMouseLeave = () => {
    // Clear any existing debounceTimeout
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
      debounceTimeout.current = null;
    }

    // Start a new debounceTimeout to remove focus after a short delay (e.g., 100ms)
    debounceTimeout.current = setTimeout(() => {
      if (currentHoveredDiv.current !== null && teamRef.current) {
        (teamRef.current as HTMLDivElement)?.blur();
        currentHoveredDiv.current = null;
      }
    }, 100);
  };

  const handleMouseMove = () => {
    // Clear any existing debounceTimeout
    if (debounceTimeout.current) {
      setSelectedTeam(
        filteredTeams[currentHoveredDiv.current ? currentHoveredDiv.current : 0]
      );
      clearTimeout(debounceTimeout.current);
      debounceTimeout.current = null;
    }
  };

  useEffect(() => {
    return () => {
      // Clear the debounceTimeout when the component unmounts
      if (debounceTimeout.current) {
        clearTimeout(debounceTimeout.current);
      }
    };
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [title, keyword, selectedTeam, filteredTeams, currentScreen]);

  useLayoutEffect(() => {
    handleGetTeams();
  }, [teams]);

  return (
    <ModalContainerCustom
      fade={false}
      show={true}
      isOpen={true}
      id="addColumnModal"
      className="paletteModalSizing sm:min-w-[560px] sm:top-[24%]"
    >
      <ModalHeaderComp
        className="px-[20px]"
        header={
          creatingBoard
            ? getCreateBoardPendingHeader(title)
            : currentScreen === "Create Board"
            ? "Add a Kanban Board"
            : "Which team does this board belong to?"
        }
      />

      {/* ---------------------- CREATE BOARD ----------------*/}
      {creatingBoard ? (
        <></>
      ) : currentScreen === "Create Board" ? (
        <div className="w-full overflow-hidden rounded-[5px] p-0">
          <ModalInput
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setTitle(e.target.value)
            }
            value={title}
            placeholder="Board name"
          />
        </div>
      ) : (
        //{/* ---------------------- SELECT TEAM ----------------*/}

        <div className="w-full overflow-hidden rounded-[5px] p-0">
          <ModalInput
            onChange={onKeyChangeSelectTeam}
            value={keyword}
            placeholder="Team name"
          />
          {filteredTeams.length > 0 ? (
            <div
              onMouseMove={handleMouseMove}
              className="max-h-[364px] overflow-y-scroll scrollbar-none"
            >
              {filteredTeams.map((team, index) => {
                return (
                  <ModalRowElementContainer
                    ref={teamRef}
                    key={team.id}
                    onMouseEnter={() => handleMouseEnter(index)}
                    handleMouseLeave={handleMouseLeave}
                    onClick={enterHandler}
                    id={`assignee-htc-option-${index}`}
                    index={index}
                    isSelected={selectedTeam.id === team.id}
                  >
                    <span>{team.title}</span>
                  </ModalRowElementContainer>
                );
              })}
            </div>
          ) : (
            <>
              <div
                ref={teamRef}
                className="mx-1.5 flex h-[36px] cursor-pointer items-center rounded-sm px-3 text-dense transition-all duration-75"
                id={`create-team`}
                onClick={enterHandler}
                key={keyword}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>Create Team &quot;{keyword}&quot;</span>
              </div>
            </>
          )}
        </div>
      )}
    </ModalContainerCustom>
  );
};

export default CreateBoard;
