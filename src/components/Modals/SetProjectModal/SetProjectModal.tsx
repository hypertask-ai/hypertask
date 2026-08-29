import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import useHandleKeydownBasic from "@/hooks/General/useHandleKeydownBasic";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import { IProject } from "@/models/model";
import {
  BoardLastActivity,
  orderBoardsForSwitcher,
} from "@/lib/boardSwitcherOrder";
import React, { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { ModalBody } from "reactstrap";
const prefixId = "label-htc-option-";

interface ISetProjects {
  toggle: (project?: IProject) => void;
  currentProject?: IProject;
  allProjects: IProject[];
}

const SetProjectsModal: React.FC<ISetProjects> = ({
  toggle,
  currentProject,
  allProjects,
}) => {
  const [keyword, setKeyword] = useState<string>("");
  const [filteredOptions, setFilteredOptions] = useState<IProject[]>([]);
  const [defaultOptions, setDefaultOptions] = useState<IProject[]>([]);
  const [lastActivity, setLastActivity] = useState<BoardLastActivity>({});
  const { setSelectedIndex, selectedIndex, handleKeydown } =
    useHandleKeydownBasic(enterHandler);
  const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } =
    useHandleMouseGlobal({ setSelectedIndex });

  async function enterHandler(index: number) {
    if (currentProject?.id !== filteredOptions[index].id) {
      closeHandler(undefined, filteredOptions[index]);
    } else closeHandler();
  }

  const handleChange = (e: any) => {
    setKeyword(e.target.value);
    if (e.target.value.length > 0) {
      const filtered = defaultOptions.filter((option: IProject) =>
        option
          ?.title!.toLowerCase()
          .includes(e.target.value.toLocaleLowerCase())
      );
      setFilteredOptions(filtered);
    } else setFilteredOptions(defaultOptions);

    setSelectedIndex(0);
    document
      .getElementById(`${prefixId}${0}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const closeHandler = (refresh?: boolean, project?: IProject) => {
    if (project) toggle(project);
    else toggle();
  };

  // Activity is fetched when the switcher opens rather than carried on the
  // board payload, so a heavier board list never slows down board loads.
  // Until it lands the list keeps its previous order, so the modal is usable
  // from the first frame.
  useEffect(() => {
    const ordered = orderBoardsForSwitcher(
      allProjects,
      lastActivity,
      currentProject?.id,
    );
    setDefaultOptions(ordered);
    setFilteredOptions(
      keyword.length > 0
        ? ordered.filter((option: IProject) =>
            option?.title?.toLowerCase().includes(keyword.toLowerCase()),
          )
        : ordered,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allProjects, currentProject?.id, lastActivity]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/projects/lastActivity")
      .then((res) => (res.ok ? res.json() : {}))
      .then((data: BoardLastActivity) => {
        if (!cancelled && data && typeof data === "object") {
          setLastActivity(data);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const keydown = (e: KeyboardEvent) =>
      handleKeydown(e, filteredOptions.length, prefixId, closeHandler);
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [handleKeydown]);

  useEffect(() => {}, [keyword]);

  return (
    <ModalContainerCustom
      fade={false}
      show={true}
      isOpen={true}
      id="setProjectsModal"
      toggle={() => closeHandler()}
      shouldCloseOnClickOutside={true}
      className="font-bold"
    >
      <ModalHeaderComp header={`Change Board`} className="px-[20px]" />
      <ModalBody className="p-0">
        <ModalInput
          onChange={handleChange}
          value={keyword}
          placeholder="Search for a board"
          autofocus={true}
        />
        <ModalListContainer
          handleMouseMove={handleMouseMove}
          id="set-project-modal-container"
        >
          {filteredOptions.map((project: IProject, index) => (
            <ModalRowElementContainer
              key={`el-${index}`}
              onMouseEnter={() => handleMouseEnter(index)}
              handleMouseLeave={handleMouseLeave}
              onClick={() => enterHandler(index)}
              id={`${prefixId}${index}`}
              index={index}
              commandRef={elRef}
              isSelected={selectedIndex === index}
            >
              <ProjectTile title={project.title} />
              {/* {must check here if the current value of the scroll is you know, marked} */}
              {project.id === currentProject?.id && <Check strokeWidth={1.75} size={14} />}
            </ModalRowElementContainer>
          ))}
        </ModalListContainer>
      </ModalBody>
    </ModalContainerCustom>
  );
};

export default SetProjectsModal;

const ProjectTile = ({ title }: { title?: string }) => {
  return (
    <div className="flex items-center gap-2">
      <span>{title ?? ""}</span>
    </div>
  );
};
