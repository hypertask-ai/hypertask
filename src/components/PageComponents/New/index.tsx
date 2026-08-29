"use client";
import CreateTaskGlobally from "@/components/Modals/CreateTaskGloballyModal";
import { currentProjectAtom, showCreateTaskModalAtom } from "@/store";
import { useSetRecoilState } from "@/lib/state";
import { useEffect, useState } from "react";
import { IProject, ISection } from "@/models/model";

const NewTaskPage = ({
  currentProject,
  initialSection,
}: {
  currentProject: IProject;
  initialSection?: Pick<ISection, "id" | "section_title">;
}) => {
  const setCurrentProject = useSetRecoilState(currentProjectAtom);
  const setCreateTaskModal = useSetRecoilState(showCreateTaskModalAtom);
  const targetKey = `${currentProject.id}-${initialSection?.id ?? "default"}`;
  const [initializedTarget, setInitializedTarget] = useState<string>();

  useEffect(() => {
    setCurrentProject(currentProject);
    setCreateTaskModal({
      // GlobalProviders also renders the shared modal from this atom on /new.
      // This route owns the visible instance, so keep shared visibility off.
      show: false,
      column_payload:
        initialSection?.id == null
          ? undefined
          : {
              sectionId: initialSection.id,
              sectionTitle: initialSection.section_title,
              position: "top",
            },
    });
    setInitializedTarget(targetKey);
  }, [
    currentProject,
    initialSection?.id,
    initialSection?.section_title,
    setCreateTaskModal,
    setCurrentProject,
    targetKey,
  ]);

  if (initializedTarget !== targetKey) return null;

  return (
    <CreateTaskGlobally
      key={`new-task-composer-${targetKey}`}
      shouldShow={true}
      closeCallback={() => {}}
    />
  );
};

export default NewTaskPage;
