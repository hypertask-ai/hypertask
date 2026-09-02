/* eslint-disable react-hooks/exhaustive-deps */
import {
  processHtmlForTaskId,
  uploadAttachmentsDescription,
} from "@/components/Modals/CreateTaskGloballyModal/useSaveContentCreateTaskGlobal";
import {
  IForm,
  IParentTask,
  TCurrentFocusedElement,
  TEditModeCTModal,
  TFormKey,
} from "@/models/CreateTaskModalModels/model";
import { IProject, ITask } from "@/models/model";
import { purgeLegacyCreateTaskDrafts } from "@/lib/createTaskDraftCleanup";
import {
  currentProjectAtom,
  newTaskCreatedAtom,
  showCreateTaskModalAtom,
  uploadingStateCreateTaskModalAtom,
} from "@/store";
import createNewTaskGloballyAPIHandler from "@/utils/api/global/apiHelpers/createTaskGloballycontroller";
import { useCallback, useMemo, useRef, useState } from "react";
import { useRecoilState } from "@/lib/state";
import useAddDeleteTaskInBoards from "../useAddDeleteTaskInBoards";
import axios from "axios";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import { shouldShowGuestWriterIntro } from "@/lib/demo/guestBoardBuild";
import { getActiveFiltersFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import useCurrentUser from "@/hooks/General/useCurrentUserCheckFromCookies";
import { useGetAllProjectsMinimal } from "../useGetAllProjectsMinimal";
import { useHyperMention } from "./useHyperMention";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import { useGetUserPreferences } from "@/hooks/General/useGetUserPreferences";
import {
  defaultAiModelOption,
  getAiModelOptionById,
} from "@/lib/aiModelOptions";
import { getAiModelPreferenceIds } from "@/lib/aiModelPreferences";
import { buildTaskWriterRequestScope } from "@/lib/ai/taskWriterBoardContext";
import { deriveCurrentBoardBilling } from "@/lib/deriveCurrentBoardBilling";
import { taskWriterRoute } from "@/lib/constants/APIRouteConstants";
import { extractTitleAndDescription } from "@/utils/aiWriterUtils";
import {
  createAiTitleEditTracker,
  recordBoardMemorySignal,
} from "@/lib/ai/boardMemoryClient";
import { createDictationCoordinator } from "@/lib/dictationCoordinator";
import { appendTitleDictation } from "@/components/Modals/CreateTaskGloballyModal/titleDictation";
import { normalizeCreateTaskFormDate } from "@/lib/createTaskFormDate";
import {
  beginTaskCreatePerformanceTrace,
  type TaskCreateTraceScope,
} from "@/lib/analytics/productPerformance";
import { createAutoTitleGenerationCoordinator } from "@/lib/ai/autoTitleGeneration";

const descriptionText = (description: string) => {
  if (typeof DOMParser === "undefined") {
    return description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  return new DOMParser()
    .parseFromString(description, "text/html")
    .body.textContent?.replace(/\s+/g, " ")
    .trim() ?? "";
};

interface IProccessed {
  description: String;
  urlsToAdd: any[];
  relationsToAdd: any;
}

const useCreateTaskModalGlobalStates = () => {
  const [initializeDefaults, setInitializeDefaults] = useState(true);
  const [showAssignModal, setShowAssignModal] = useState<boolean>(false);
  const [showConfirmationModal, setShowConfirmationModal] =
    useState<boolean>(false);
  const [uploadInProgress, setUploadInProgress] = useState<boolean>(false);
  const [selectedProject, setSelectedProject] = useState<IProject>();
  const { resetCreateTaskGlobally } = useHypertasksRecoilStates();
  const [userInput, setUserInput] = useState<string>("");
  const [createTaskModal, setCreateTaskModal] = useRecoilState(
    showCreateTaskModalAtom
  );
  const [createTaskFromComment, setCreateTaskFromComment] = useState<
    { task: ITask; commentIndex: number } | undefined
  >(createTaskModal.column_payload?.createTaskFromComment);
  const [_currentProject, setCurrentProject] =
    useRecoilState(currentProjectAtom);
  // A guest's first create-task opening lands on the AI writer so the demo's
  // second beat happens inside a modal they opened themselves (HTPR-4937).
  // Only a plain opening: duplicates, create-from-comment and prefilled
  // payloads carry content the writer must not talk over.
  const guestWriterIntro =
    !createTaskModal.defaultEditFocus?.defaultEditMode &&
    !createTaskModal.duplicate &&
    !createTaskModal.column_payload?.createTaskFromComment &&
    !createTaskModal.column_payload?.prefilledTitle &&
    !createTaskModal.column_payload?.prefilledDescription &&
    shouldShowGuestWriterIntro();
  const [editMode, setEditMode] = useState<TEditModeCTModal>(
    createTaskModal.defaultEditFocus?.defaultEditMode ??
      (guestWriterIntro ? "Description-ai" : "title")
  );
  const [currentFocusedElement, setCurrentFocusedElement] =
    useState<TCurrentFocusedElement>(
      createTaskModal.defaultEditFocus?.defaultFocus ??
        (guestWriterIntro ? "Description" : "Title")
    );
  const [currentTask, setCurrentTask] = useState<ITask | undefined>(undefined);
  const [allProjects, setAllProjects] = useState<IProject[]>([]);
  const [_, setNewTaskCreated] = useRecoilState(newTaskCreatedAtom);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [taskWriterFilled, setTaskWriterFilled] = useState(false);
  const dictationCoordinatorRef = useRef<ReturnType<typeof createDictationCoordinator> | null>(null);
  if (!dictationCoordinatorRef.current) {
    dictationCoordinatorRef.current = createDictationCoordinator(setIsRecording);
  }
  const dictationCoordinator = dictationCoordinatorRef.current;
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  // Bumped whenever the composer is reset (discard, close, post-create). A
  // save that awaited title generation checks it before creating, so a task
  // can't materialize after the user already discarded the draft.
  const saveEpochRef = useRef(0);
  const generatedTitleTrackerRef = useRef(createAiTitleEditTracker());
  const autoTitleCoordinatorRef = useRef<ReturnType<
    typeof createAutoTitleGenerationCoordinator
  > | null>(null);
  if (!autoTitleCoordinatorRef.current) {
    autoTitleCoordinatorRef.current = createAutoTitleGenerationCoordinator({
      initialTitle:
        createTaskModal.duplicate?.title ??
        createTaskModal.column_payload?.prefilledTitle ??
        "",
    });
  }
  const autoTitleCoordinator = autoTitleCoordinatorRef.current;
  const lastDescriptionTextRef = useRef(
    descriptionText(
      createTaskModal.duplicate?.description ??
        createTaskModal.column_payload?.prefilledDescription ??
        "<p></p>",
    ),
  );
  const [titleGenerationError, setTitleGenerationError] = useState<string | null>(null);
  const [tempMentionProjectId, setTempMentionProjectId] = useState<string>("");
  const { postHyperMention } = useHyperMention();
  const { data: userPreferences } = useGetUserPreferences();
  const improveWritingOptionIds = getAiModelPreferenceIds(
    userPreferences.aiModelPreferences,
    "improveWriting",
    _currentProject?.teamId,
  );
  const improveWritingOption =
    getAiModelOptionById(improveWritingOptionIds.teamScoped) ??
    getAiModelOptionById(improveWritingOptionIds.global);
  const improveWritingModel =
    improveWritingOption?.id ??
    _currentProject?.ai_custom_instructions?.[0]?.model_selected ??
    defaultAiModelOption.id;
  const improveWritingSource =
    improveWritingOption?.source ??
    _currentProject?.ai_custom_instructions?.[0]?.source_selected ??
    defaultAiModelOption.source;
  const { goToProjectShortcut } = useProjectQuery()
  const pathname = usePathname();

  const defaultFormValues: IForm = useMemo(
    () => ({
      title:
        createTaskModal.duplicate?.title ??
        createTaskModal.column_payload?.prefilledTitle ??
        "",
      description:
        createTaskModal.duplicate?.description ??
        createTaskModal.column_payload?.prefilledDescription ??
        "<p></p>",
      assignees: [],
      attachments:
        createTaskModal.column_payload?.prefilledAttachments?.map(
          (attachment: any) => attachment
        ) ?? [],
      status: createTaskModal.duplicate
        ? {
          sectionId: createTaskModal.duplicate?.sectionId,
          sectionTitle: createTaskModal.duplicate?.section,
          position: "top",
        }
        : createTaskModal.column_payload!,
      priority:
        createTaskModal.duplicate?.priority ??
        createTaskModal.column_payload?.priority,
      estimate: createTaskModal.duplicate?.estimate ?? undefined,
      dueDate: normalizeCreateTaskFormDate(
        createTaskModal.column_payload?.prefilledDueDate,
      ),
      startDate: undefined,
      tags:
        createTaskModal.duplicate?.taskLabels.map(
          (taskLabel: any) => taskLabel.label
        ) ??
        getActiveFiltersFromProject(_currentProject).addedFilters.find(
          (filter) => filter.type === "Labels"
        )?.searchPayload,
      currentProject: _currentProject ?? undefined,
    }),
    [
      createTaskModal.duplicate, // Added missing dependency
      createTaskModal.column_payload, // Existing dependency
      _currentProject, // Added missing dependency
    ]
  );

  const parentTaskInfo: IParentTask | undefined = useMemo(
    () => createTaskModal.column_payload?.parentTask ?? undefined,
    []
  );
  const [formValues, setFormValues] = useState<IForm>(defaultFormValues);
  const formValuesRef = useRef(formValues);
  formValuesRef.current = formValues;
  const aiModelPreferencesRef = useRef(userPreferences.aiModelPreferences);
  aiModelPreferencesRef.current = userPreferences.aiModelPreferences;
  const [canSave, setUploadingStateCreateTaskModal] = useRecoilState(
    uploadingStateCreateTaskModalAtom
  );
  const currentUser = useCurrentUser();
  const { data: projectsFromTQ } = useGetAllProjectsMinimal([
    "projectsAllMinimal",
  ]);
  const { createTaskGlobally } = useAddDeleteTaskInBoards();
  const router = useRouter();
  const sectionDefaultsRequestRef = useRef<AbortController | null>(null);

  const toggleRecording = (val: boolean) => setIsRecording(val);

  const applyGeneratedTitle = useCallback((title: string) => {
    setTitleGenerationError(null);
    formValuesRef.current = { ...formValuesRef.current, title };
    setFormValues((current) => ({ ...current, title }));
    generatedTitleTrackerRef.current.record(title);
  }, []);

  const resetFormValues = () => {
    saveEpochRef.current += 1;
    generatedTitleTrackerRef.current.reset();
    autoTitleCoordinator.reset(defaultFormValues.title);
    lastDescriptionTextRef.current = descriptionText(defaultFormValues.description);
    formValuesRef.current = defaultFormValues;
    setIsGeneratingTitle(false);
    setTaskWriterFilled(false);
    setFormValues(defaultFormValues);
  };

  const handleChange = (key: TFormKey, value: any) => {
    if (key === "title") {
      autoTitleCoordinator.manualTitleChanged(String(value));
      if (String(value).trim()) setTitleGenerationError(null);
    }
    let nextValue = value;
    if (key === "dueDate" || key === "startDate") {
      const normalizedValue = normalizeCreateTaskFormDate(value);
      if (value !== null && value !== undefined && !normalizedValue) return;
      nextValue = normalizedValue;
    }
    formValuesRef.current = { ...formValuesRef.current, [key]: nextValue };
    setFormValues((prev) => ({ ...prev, [key]: nextValue }));
  };

  const appendDictationToTitle = useCallback((transcript: string) => {
    if (!transcript.trim()) return;
    const title = appendTitleDictation(formValuesRef.current.title, transcript);
    autoTitleCoordinatorRef.current?.manualTitleChanged(title);
    setTitleGenerationError(null);
    formValuesRef.current = {
      ...formValuesRef.current,
      title,
    };
    setFormValues((current) => ({
      ...current,
      title: appendTitleDictation(current.title, transcript),
    }));
  }, []);

  const applyTaskWriterTitle = useCallback((title: string) => {
    autoTitleCoordinator.taskWriterTitleApplied();
    applyGeneratedTitle(title);
  }, [applyGeneratedTitle, autoTitleCoordinator]);

  const enableAutoTitleGeneration = useCallback(() => {
    autoTitleCoordinator.enableFromTaskWriter();
  }, [autoTitleCoordinator]);

  const requestTitleFromDescription = useCallback(async (
    description: string,
    signal: AbortSignal,
  ) => {
    const project = formValuesRef.current.currentProject;
    if (!project) throw new Error("Choose a board before generating a title");

    const plainDescription = descriptionText(description);
    if (!plainDescription) throw new Error("Add a description or enter a title");

    // Derive the AI model from the board this request is for. The hook-level
    // improveWriting* values follow _currentProject, which lags behind
    // formValues.currentProject after a board switch in the composer.
    const titleOptionIds = getAiModelPreferenceIds(
      aiModelPreferencesRef.current,
      "improveWriting",
      project.teamId,
    );
    const titleOption =
      getAiModelOptionById(titleOptionIds.teamScoped) ??
      getAiModelOptionById(titleOptionIds.global);
    const titleModel =
      titleOption?.id ??
      project.ai_custom_instructions?.[0]?.model_selected ??
      defaultAiModelOption.id;
    const titleSource =
      titleOption?.source ??
      project.ai_custom_instructions?.[0]?.source_selected ??
      defaultAiModelOption.source;

    const response = await fetch(taskWriterRoute, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        ...buildTaskWriterRequestScope(project, deriveCurrentBoardBilling(project)),
        // The description must live inside the prompt. A bare instruction gets
        // echoed as the title instead of improving the user's task wording.
        PROMPT:
          "Write a title for the task described below. Use only details from the description, do not invent any. Keep the title under 80 characters.\n\nTask description:\n" +
          plainDescription,
        customInstructions:
          project.ai_custom_instructions?.[0]?.customInstruction ?? "",
        sourceSelected: titleSource,
        modelSelected: titleModel,
        modelOptionId: titleModel,
        aiMode: "AiTaskWriter",
        images64: [],
        pdfs64: [],
        docx64: [],
        taskIds: [],
        taskDescription: description,
        taskTitle: "",
      }),
    });
    if (!response.ok) throw new Error("Title generation is unavailable");

    const generatedHtml = await response.text();
    const generatedTitle = extractTitleAndDescription(generatedHtml).title
      ?.replace(/\s+/g, " ")
      .trim();
    if (!generatedTitle) throw new Error("No title was generated");
    return generatedTitle.slice(0, 80);
  }, []);

  const scheduleTitleGeneration = useCallback((description: string) => {
    const plainDescription = descriptionText(description);
    if (plainDescription === lastDescriptionTextRef.current) return;
    lastDescriptionTextRef.current = plainDescription;
    setTitleGenerationError(null);
    autoTitleCoordinator.schedule(plainDescription ? description : "", {
      generate: (signal) => requestTitleFromDescription(description, signal),
      apply: applyGeneratedTitle,
      onError: () =>
        setTitleGenerationError(
          "Couldn’t refresh the title. Keep writing or add one manually.",
        ),
    });
  }, [applyGeneratedTitle, autoTitleCoordinator, requestTitleFromDescription]);

  const generateTitleFromDescription = useCallback(async (description: string) => {
    const epochAtRequest = saveEpochRef.current;
    setIsGeneratingTitle(true);
    setTitleGenerationError(null);
    try {
      const title = await autoTitleCoordinator.generateNow(description, {
        generate: (signal) => requestTitleFromDescription(description, signal),
      });
      if (title === null || saveEpochRef.current !== epochAtRequest) return null;
      applyGeneratedTitle(title);
      return title;
    } catch (error) {
      if (saveEpochRef.current === epochAtRequest) {
        setTitleGenerationError("Couldn’t generate a title. Add one to save.");
      }
      throw error;
    } finally {
      if (saveEpochRef.current === epochAtRequest) setIsGeneratingTitle(false);
    }
  }, [applyGeneratedTitle, autoTitleCoordinator, requestTitleFromDescription]);

  const shouldGenerateTitleForSave = useCallback(
    (title: string, description: string) =>
      autoTitleCoordinator.needsGenerationForSave(
        title,
        descriptionText(description),
      ),
    [autoTitleCoordinator],
  );

  const getCurrentTitle = useCallback(
    () => formValuesRef.current.title.trim(),
    [],
  );

  const handleProjectChange = (project: IProject) => {
    // Generated titles carry the previous board's AI context. Manual titles do
    // not, so a board switch invalidates only generated title ownership.
    saveEpochRef.current += 1;
    setIsGeneratingTitle(false);
    generatedTitleTrackerRef.current.reset();
    const clearGeneratedTitle = autoTitleCoordinator.boardChanged();
    const tags = getActiveFiltersFromProject(project).addedFilters.find(
      (filter) => filter.type === "Labels"
    )?.searchPayload;
    formValuesRef.current = {
      ...formValuesRef.current,
      title: clearGeneratedTitle ? "" : formValuesRef.current.title,
      currentProject: project,
      assignees: [],
      tags,
      status: undefined,
    };
    setFormValues((prev) => ({
      ...prev,
      title: clearGeneratedTitle ? "" : prev.title,
      currentProject: project,
      assignees: [],
      tags,
      status: undefined,
    }));
    if (pathname === "/new") {
      router.replace(`/new?id=${project.id}&board=${project.title}`);
    };

    //Setting a projectId in localStorage for @mentions.
    localStorage.setItem("MENTION_PROJECT_ID", project.id.toString());
  };

  const focusOn = (el: TCurrentFocusedElement) => {
    setCurrentFocusedElement(el);
  };

  const handleSetUserInput = (input: string) => {
    setUserInput(input);
  };

  const onConfirmDiscard = () => {
    setShowConfirmationModal(false);
    resetFormValues();
    setTimeout(() => {
      setUploadingStateCreateTaskModal(undefined);
      if (pathname === "/new") goToProjectShortcut(formValues.currentProject?.id!, true);
      else resetCreateTaskGlobally();
    }, 10);
  };

  const onCancelDiscard = () => {
    setShowConfirmationModal(false);
  };

  const hasUnsavedChanges = useCallback(() => {
    const areFormValuesEqualToDefault =
      formValues.assignees.length === 0 &&
      formValues.attachments.length === 0 &&
      formValues.description?.replace(/(<p><\/p>)+/g, "") === "" &&
      formValues.title.trim().length === 0 &&
      !formValues.dueDate &&
      !formValues.startDate &&
      !formValues.priority?.priority_index &&
      !formValues.estimate &&
      (!formValues.tags || formValues.tags.length === 0) &&
      formValues.status?.sectionId === defaultFormValues.status?.sectionId;

    return !areFormValuesEqualToDefault;
  }, [formValues, defaultFormValues]);

  // Any draft written by the old persistence behaviour is dropped once, so a
  // returning user never sees a stale entry in a fresh composer (HTPR-5537).
  useEffect(() => {
    purgeLegacyCreateTaskDrafts();
  }, []);

  const closeHandler = useCallback(
    (save = true) => {
      if (!hasUnsavedChanges() || save) {
        saveEpochRef.current += 1;
        autoTitleCoordinator.cancelPending();
        setIsGeneratingTitle(false);
        if (pathname === "/new") {
          setUploadingStateCreateTaskModal(undefined);
          return goToProjectShortcut(formValues.currentProject?.id!, true)
        };
        setTimeout(() => {
          resetCreateTaskGlobally();
          setUploadingStateCreateTaskModal(undefined);
        }, 10);
      } else {
        setShowConfirmationModal((prev) => !prev);
        localStorage.setItem("MENTION_PROJECT_ID", tempMentionProjectId);
      }
    },
    [
      formValues,
      showConfirmationModal,
      hasUnsavedChanges,
      formValues.dueDate,
    ]
  );


  // ================================  Create task handler
  const CreateNewTask = useCallback(
    async (
      processed: IProccessed,
      titleOverride?: string,
      traceScope?: TaskCreateTraceScope | null,
    ) => {
      if (!currentUser?.id || !formValues.currentProject) return;
      // const inViewObjectId = inViewObject.taskProjectId
      const res = await createNewTaskGloballyAPIHandler(
        {
          userId: currentUser.id,
          projectId: formValues.currentProject?.id!,
          projectIdentifier:
            formValues.currentProject?.uniqueIdentifier ?? "TASK",
          title: titleOverride ?? formValues.title ?? "",
          ranking: formValues.status?.ranking,
          sectionId: formValues.status?.sectionId!,
          section_title: formValues.status?.sectionTitle!,
          priority: formValues.priority,
          estimate: formValues.estimate,
          dueDate: formValues.dueDate,
          startDate: formValues.startDate,
          tags: formValues.tags,
          parentTask: parentTaskInfo,
          assignees: formValues.assignees,
          createTaskFromComment,
          ...processed,
        },
        traceScope,
      );

      if (res?.error) return;
      return res?.resposne?.newTask;
    },
    [
      formValues.currentProject,
      currentUser?.id,
      formValues.title,
      formValues.status,
      formValues.priority,
      formValues.tags,
      formValues.estimate,
      formValues.dueDate,
      formValues.startDate,
      formValues.assignees,
      createTaskModal,
    ]
  );

  /** Function for creating a new task @type {*} */
  const CreateTaskAndDescription = useCallback(async (descriptionOverride?: string, titleOverride?: string) => {
    const traceScope =
      currentUser?.id && formValues.currentProject?.id
        ? beginTaskCreatePerformanceTrace({
            accountId: currentUser.id,
            projectId: formValues.currentProject.id,
          })
        : null;
    //Why do we have a seperate processHTML for create task modal when we can use the same one from useSaveContent.ts?
    //Im not changing the function right now but we should have the same one.

    // [Reply]
    // - Because the one in useSaveContent is where the task already exists, the taskId is already present as well, here its not,
    // - it would be better yeah to combine them both, it is technical debt indeed, good catch.
    const descriptionAtSave = descriptionOverride ?? formValues.description;
    const result = await processHtmlForTaskId(descriptionAtSave);
    const { AttachmentUrls } = uploadAttachmentsDescription(
      formValues.attachments
    );
    const updatedURLs = result.urls.map((url: any) => ({
      ...url,
    }));

    const processedPayload = {
      description: result.html,
      urlsToAdd: [...updatedURLs, ...AttachmentUrls],
      relationsToAdd: result.relations,
    };

    const task = await CreateNewTask(
      processedPayload,
      titleOverride,
      traceScope,
    );
    // Reject missing task results so every save mode uses its error path and
    // keeps the typed form instead of reporting a false success.
    if (!task) throw new Error("Task could not be created");
    const savedTitle = (titleOverride ?? formValues.title).trim();
    const titleEditSignal =
      generatedTitleTrackerRef.current.takeSignal(savedTitle);
    if (titleEditSignal) {
      void recordBoardMemorySignal(
        formValues.currentProject?.id,
        titleEditSignal
      );
    }
    localStorage.setItem(
      "MENTION_PROJECT_ID",
      (formValues.currentProject?.id ?? "").toString()
    );

    if (result.hyperMention)
      postHyperMention("Description", "Create", {
        ownerId: task.userId,
        projectId: task.project?.id ?? -1,
        teamId: task.project?.teamId ?? -1,
        text: result.html,
        currentUser: currentUser ?? undefined,
        teamTitle: task.project?.team?.title ?? "",
        taskIds: [
          task.id,
          task.parentTask?.id,
          ...(task.relatedTasks.json || []).flatMap(
            (item: any) => item.targetTask?.id
          ),
        ].filter(Boolean),
        sourceSelected:
          result.hyperMention.modelSource ?? improveWritingSource,
        modelSelected:
          result.hyperMention.modelOptionId ?? improveWritingModel,
        modelOptionId: result.hyperMention.modelOptionId,
        modelMentionLabel: result.hyperMention.modelLabel,
        attachments: formValues.attachments,
        taskDescription: result.html,
        taskTitle: task.title,
      });

    setNewTaskCreated(task);
    setCreateTaskFromComment(undefined);
    const taskUrl = `/detail/project-${formValues.currentProject?.id}/${task.uniqueIndex}`;
    router.prefetch(taskUrl);
    processFollowers(result, task);
    if (result.agentMentions && result.agentMentions.length > 0) {
      result.agentMentions.forEach((agentId: string) => {
        handleAgentMention(agentId, task.id);
      });
    }

    createTaskGlobally({
      task,
      sectionId: task.sectionId,
      position: createTaskModal.column_payload?.position ?? "top",
    });

    return taskUrl;
  }, [
    CreateNewTask,
    currentUser,
    formValues.assignees,
    formValues.attachments,
    formValues.description,
    formValues.title,
    improveWritingModel,
    improveWritingSource,
  ]);

  const processFollowers = (result: any, task: ITask) => {
    //remove duplicates
    const uniquePostFollowerBody = result.PostFollowerBody.filter(
      (x: any, index: number, self: any[]) =>
        index === self.findIndex((y: any) => y.userId === x.userId)
    );

    const updatedPostFollowerBody = uniquePostFollowerBody.map(
      (follower: any) => ({ ...follower, currentTaskId: task.id })
    );
    updatedPostFollowerBody.forEach((x: any) => {
      const userIdExists = formValues.assignees.some(
        (assignee: any) => assignee.id === x.userId
      );
      if (!userIdExists) {
        PostFollower(x.userId, task);
      }
    });
  };

  async function handleAgentMention(agentId: string, taskId: number) {
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

  const PostFollower = async (userId: number, task: ITask) => {
    const path = `${process.env.NEXT_PUBLIC_BASEURL}/detail/project-${formValues.currentProject?.id}/${task.uniqueIndex}`;

    const taskOwnerId = parseInt(task.userId as string);
    console.log("already exist not", taskOwnerId === userId);
    if (taskOwnerId === userId) {
      console.log("you are owner");
    } else {
      try {
        await axios
          .post("/api/follower/createFollower", {
            userId: userId,
            taskId: task.id,
            mentionById: currentUser?.id,
          })
          .then((response) => {
            if (response.status === 200) {
              try {
                axios.post("/api/notifications/sendEmailToFollower", {
                  receiver: userId,
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
  };

  const getSectionInformation = useCallback(async () => {
    const projectId = formValues.currentProject?.id;
    if (!Number.isInteger(projectId) || !projectId) return;

    sectionDefaultsRequestRef.current?.abort();
    const controller = new AbortController();
    sectionDefaultsRequestRef.current = controller;

    try {
      const response = await axios.get("/api/tasks/createGlobally", {
        params: {
          projectId,
          sectionId: formValues.status?.sectionId,
          position: createTaskModal.column_payload?.position ?? "top",
        },
        signal: controller.signal,
      });
      if (
        response.status === 200 &&
        sectionDefaultsRequestRef.current === controller
      ) {
        handleChange("status", {
          sectionId: response.data.sectionId,
          sectionIdx: 0,
          sectionTitle: response.data.section,
          ranking: response.data.ranking,
        });
        // initDefault ensures the opening payload is only set once.
        if (initializeDefaults) {
          setInitializeDefaults(false);
          setCreateTaskModal((prev) => ({
            ...prev,
            column_payload: {
              sectionId: response.data.sectionId,
              sectionTitle: response.data.section,
              position: "top",
            },
          }));
          setTempMentionProjectId(projectId.toString());
          localStorage.setItem("MENTION_PROJECT_ID", projectId.toString());
        }
      }
    } catch (error) {
      if (!axios.isCancel(error)) {
        console.error("Could not load create-task section defaults", error);
      }
    } finally {
      if (sectionDefaultsRequestRef.current === controller) {
        sectionDefaultsRequestRef.current = null;
      }
    }
  }, [initializeDefaults, handleChange]);

  useEffect(
    () => () => {
      sectionDefaultsRequestRef.current?.abort();
      saveEpochRef.current += 1;
      autoTitleCoordinator.cancelPending();
    },
    [autoTitleCoordinator]
  );

  //set All projects to be given to SetProjects Modal.
  const getAllProjects = async () => {
    const projectsData: IProject[] = projectsFromTQ ?? [];
    setAllProjects(projectsData);
    if (createTaskModal.column_payload?.projectId && initializeDefaults) {
      const project = projectsData.find(
        (item) => item.id === createTaskModal.column_payload?.projectId
      );
      if (project) handleProjectChange(project);
    }
  };

  useEffect(() => {
    getAllProjects();
  }, [projectsFromTQ, initializeDefaults]);

  useEffect(() => {
    getSectionInformation();
  }, [formValues.currentProject?.id, formValues.status?.sectionId]);

  useEffect(() => {
    setUserInput(userInput);
  }, [userInput]);

  return {
    handleChange,
    appendDictationToTitle,
    dictationCoordinator,
    formValues,
    currentTask,
    setCurrentTask,
    uploadInProgress,
    setUploadInProgress,
    editMode,
    setEditMode,
    showAssignModal,
    setShowAssignModal,
    currentFocusedElement,
    setCurrentFocusedElement,
    selectedProject,
    setSelectedProject,
    focusOn,
    closeHandler,
    CreateTaskAndDescription,
    applyTaskWriterTitle,
    enableAutoTitleGeneration,
    scheduleTitleGeneration,
    generateTitleFromDescription,
    shouldGenerateTitleForSave,
    getCurrentTitle,
    saveEpochRef,
    isGeneratingTitle,
    titleGenerationError,
    resetFormValues,
    showConfirmationModal,
    setShowConfirmationModal,
    onConfirmDiscard,
    onCancelDiscard,
    userInput,
    handleSetUserInput,
    parentTaskInfo,
    allProjects,
    handleProjectChange,
    toggleRecording,
    isRecording,
    hasUnsavedChanges,
    taskWriterFilled,
    setTaskWriterFilled,
  };
};

export default useCreateTaskModalGlobalStates;
