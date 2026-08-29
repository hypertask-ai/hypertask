import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalHintBar,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import { useGetAllProjectsMinimal } from "@/hooks/MultiPages/useGetAllProjectsMinimal";
import { IProject, ITask } from "@/models/model";
import axios from "axios";
import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ModalBody } from "reactstrap";

type Props = {
  closeHandler: () => void;
  currentTaskId?: number;
  header?: string;
  onSelect: (task: ITask) => Promise<void> | void;
};

const prefixId = "task-search-option-";

const SearchTasks = ({
  closeHandler,
  currentTaskId,
  header = "Search all tasks",
  onSelect,
}: Props) => {
  const { data: projects = [], isFetching: projectsLoading } =
    useGetAllProjectsMinimal(["projectsAllMinimal"]);
  const [keyword, setKeyword] = useState("");
  const [tasks, setTasks] = useState<ITask[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const projectIds = useMemo(
    () =>
      (Array.isArray(projects) ? projects : []).map(
        (project: IProject) => project.id
      ),
    [projects]
  );

  useEffect(() => {
    const searchQuery = keyword.trim();
    if (projectIds.length === 0) {
      setTasks([]);
      setLoading(projectsLoading);
      setLoadError(false);
      return;
    }

    let active = true;
    setTasks([]);
    setLoading(true);
    setLoadError(false);
    const timeout = setTimeout(async () => {
      try {
        const response = await axios.post("/api/tasks/searchAll", {
          projectIds,
          ...(searchQuery
            ? { searchQuery }
            : { mode: "recent", currentTaskId }),
        });
        if (!active) return;
        const results = Array.isArray(response.data) ? response.data : [];
        setTasks(
          results.filter((task: ITask) => task.id !== currentTaskId)
        );
        setSelectedIndex(0);
      } catch {
        if (active) {
          setTasks([]);
          setLoadError(true);
        }
      } finally {
        if (active) setLoading(false);
      }
    }, searchQuery ? 150 : 0);

    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [currentTaskId, keyword, projectIds, projectsLoading]);

  const selectTask = useCallback(
    async (index: number) => {
      const task = tasks[index];
      if (!task || submitting) return;
      setSubmitting(true);
      try {
        await onSelect(task);
      } finally {
        setSubmitting(false);
      }
    },
    [onSelect, submitting, tasks]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeHandler();
      } else if (event.key === "Enter") {
        event.preventDefault();
        void selectTask(selectedIndex);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((current) =>
          Math.min(current + 1, Math.max(tasks.length - 1, 0))
        );
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((current) => Math.max(current - 1, 0));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeHandler, selectTask, selectedIndex, tasks.length]);

  useEffect(() => {
    document
      .getElementById(`${prefixId}${selectedIndex}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedIndex]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setKeyword(event.target.value);
    setSelectedIndex(0);
  };

  return (
    <ModalContainerCustom
      id="task-search-modal"
      isOpen={true}
      show={true}
      toggle={closeHandler}
      shouldCloseOnClickOutside={true}
      className="paletteModalSizing sm:min-w-[560px] sm:top-[24%] sm:max-h-[520px]"
    >
      <ModalHeaderComp header={header} headerClassName="w-full" />
      <ModalBody className="p-0 rounded-b-[4px]">
        <ModalInput
          aria-label="Search for a task"
          placeholder="Search for a task"
          onChange={handleChange}
          value={keyword}
        />
        <ModalListContainer
          id="task-search-modal-list"
          className="max-h-[364px]"
        >
          {!loading && tasks.length > 0 && !keyword.trim() && (
            <li className="px-4 pb-1 pt-2 text-micro font-medium text-text-light-gray">
              Recently worked
            </li>
          )}
          {tasks.map((task, index) => (
            <ModalRowElementContainer
              id={`${prefixId}${index}`}
              index={index}
              isSelected={selectedIndex === index}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={selectTask}
              key={task.id}
            >
              <div className="flex w-full min-w-0 items-center gap-3 font-normal">
                <span className="min-w-0 flex-1 truncate text-white-black font-medium">
                  {task.ticketNumber?.toUpperCase() && (
                    <span className="mr-1.5 text-text-light-gray font-normal">
                      {task.ticketNumber.toUpperCase()}
                    </span>
                  )}
                  {task.title}
                </span>
                <span className="max-w-[32%] shrink-0 truncate text-micro text-text-light-gray">
                  {task.project?.title}
                </span>
              </div>
            </ModalRowElementContainer>
          ))}
          {loading && (
            <li className="px-4 py-4 text-dense font-normal text-text-light-gray">
              Loading tasks…
            </li>
          )}
          {!loading && loadError && (
            <li className="px-4 py-4 text-dense font-normal text-text-light-gray">
              Couldn&apos;t load tasks. Try searching again.
            </li>
          )}
          {!loading && !loadError && tasks.length === 0 && (
            <li className="px-4 py-4 text-dense font-normal text-text-light-gray">
              {keyword.trim()
                ? "No matching tasks"
                : "No recently worked tasks yet"}
            </li>
          )}
        </ModalListContainer>
        <ModalHintBar />
      </ModalBody>
    </ModalContainerCustom>
  );
};

export default SearchTasks;
