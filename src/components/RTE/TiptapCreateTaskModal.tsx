import React, {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import useTiptap from "./Tiptap";
import styles from "@/styles/tiptap.module.scss";

import TiptapBubbleMenu from "./Components/TiptapBubbleMenu";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { EditorContent } from "@tiptap/react";
import { useContextCreateTaskModal } from "@/lib/contexts/Multipages/CreateTaskGloballyContexts/useContextCreateTaskModal";
import { useContextCreateTaskInfoColumn } from "@/lib/contexts/Multipages/CreateTaskGloballyContexts/useContextCreateTaskGloballyInfoColumn";
import AttachmentsUpload from "../Common/AttachmentsUpload";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { TSendBackButtonParam } from "@/models/CreateTaskModalModels/model";
import toast from "react-hot-toast";
import {
  currentProjectAtom,
  showCreateTaskModalAtom,
  uploadingStateCreateTaskModalAtom,
} from "@/store";
import { useRecoilState } from "@/lib/state";
import { useAsyncRoutePush } from "@/hooks/General/useAsyncPush";
import { AITaskWriterWithProvider as AITaskWriterContainer } from "../PageComponents/TaskDetail/AI Task Writer/AITaskWriterContainer";
import DragHandle from "@tiptap/extension-drag-handle-react";
import { GripVertical } from "lucide-react";
import FileDragOverlay from "../Common/FileDragAndDrop";
import { TIPTAPUPDATECREATETASK } from "@/lib/constants/constants";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { aiTaskWriterConfig } from "@/lib/configs/aiTaskWriter.config";
import { isGuestCookieUser } from "@/lib/demo/isGuestClient";
import {
  GUEST_DEMO_TASK_PROMPT,
  GUEST_WRITER_SEEN_KEY,
  shouldShowGuestWriterIntro,
} from "@/lib/demo/guestBoardBuild";
import { DIV_ID_CONSTANTS } from "@/lib/configs/general.config";
import { useTourContext } from "@/lib/tours/context/TourContext";
import { usePathname } from "next/navigation";
import { closeBackDismissBeforeNavigation } from "@/lib/mobile/backDismiss";
import { useGetAllProjectLabels } from "@/hooks/MultiPages/useGetAllProjectLabels";
import { useGetAllMembersForAssign } from "@/hooks/MultiPages/useGetMembersForAssignees";
import type {
  ITaskWriterAttachment,
  ITaskWriterResult,
} from "@/models/AI_Task_writer_model";
import type { IAgent, IUser } from "@/models/model";
import { getActiveColumnsViewFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import {
  USER_PREFERENCES_QUERY_KEY,
  useGetUserPreferences,
  type IUserPreferences,
} from "@/hooks/General/useGetUserPreferences";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { userPreferencesRoute } from "@/lib/constants/APIRouteConstants";
import {
  buildTaskWriterAutoDraftPrompt,
  resolveCreateTaskWriterOpening,
  resolveTaskWriterDescription,
} from "@/lib/ai/taskWriterAutoDraft";
import {
  AUTO_DESCRIPTION_SUGGESTION_DELAY_MS,
  canApplyCreateDescriptionSuggestion,
  canUndoDescriptionTakeover,
  shouldSuggestCreateDescription,
  type AutoDescriptionTakeover,
} from "@/lib/ai/autoDescriptionSuggestion";
import {
  completeTaskCreatePerformanceTrace,
  completeTaskCreatePerformanceTraceAfterElementRemoved,
  completeTaskCreatePerformanceTraceAfterPaint,
  getTaskCreatePerformanceTraceScope,
  type TaskCreateTraceScope,
} from "@/lib/analytics/productPerformance";
const attachmentButtonId = "create-task-modal-attachmentUpload";

const hasTaskDescriptionContent = (value: string | null | undefined) => {
  if (!value) return false;
  if (/<(?:audio|embed|iframe|img|object|video)\b/i.test(value)) return true;
  return Boolean(
    value
      .replace(/<br\s*\/?>(?=.)/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&(?:nbsp|#160|#xA0);/gi, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
};

const TiptapCreateTaskModal = () => {
  const isMbl = useContext(MobileViewContext);
  const isApple = useDeviceContext();
  const {
    editMode,
    setEditMode,
    setCurrentFocusedElement,
    handleChange,
    formValues,
    resetFormValues,
    showAssignModal,
    setShowAssignModal,
    uploadInProgress,
    setUploadInProgress,
    CreateTaskAndDescription,
    handleSetUserInput,
    userInput,
    closeHandler,
    setShowConfirmationModal,
    toggleRecording,
    isRecording,
    applyTaskWriterTitle,
    enableAutoTitleGeneration,
    scheduleTitleGeneration,
    generateTitleFromDescription,
    shouldGenerateTitleForSave,
    getCurrentTitle,
    saveEpochRef,
    dictationCoordinator,
    setTaskWriterFilled,
  } = useContextCreateTaskModal();
  const { togglePriorityModal, toggleProjectsModal } =
    useContextCreateTaskInfoColumn();

  const { editor } = useTiptap({
    mode: "read-edit-description",
    defaultContent: formValues.description,
  });
  const asyncPush = useAsyncRoutePush();
  const [filesDropped, setFilesDropped] = useState<File[]>([]);
  const titleGenerationForSaveRef = useRef(false);
  const [toggleHighlight, setToggleHighlight] = useState<boolean>(false);
  const [trigger, setTrigger] = useState(false);
  const [newCommentAttachments, setNewCommentAttachments] = useState<any[]>(
    formValues.attachments
  );
  const [canSave, setUploadingStateCreateTaskModal] = useRecoilState(
    uploadingStateCreateTaskModalAtom
  );
  const { continueTourInModal, isTourActive, endTour } = useTourContext();
  const [shouldShowAiTaskWriter, setShouldShowAITaskWriter] = useState(
    editMode === "Description-ai" ? true : false
  );
  const [autoDescriptionVisible, setAutoDescriptionVisible] = useState(false);
  const [autoDescriptionDismissed, setAutoDescriptionDismissed] = useState(false);
  const [autoDescriptionTakeover, setAutoDescriptionTakeover] =
    useState<AutoDescriptionTakeover | null>(null);
  const autoDescriptionTakeoverRef = useRef<AutoDescriptionTakeover | null>(null);
  const autoDescriptionTitleRef = useRef("");
  const [hasOpenedClassicForm, setHasOpenedClassicForm] = useState(false);
  const openingSectionIdRef = useRef<number | undefined>(
    formValues.status?.sectionId,
  );
  const openingProjectIdRef = useRef<number | undefined>(
    formValues.currentProject?.id,
  );
  const [_currentProject, __] = useRecoilState(currentProjectAtom);
  const [createTaskModal] = useRecoilState(showCreateTaskModalAtom);
  // The seeded prompt belongs to one opening. Keep it stable while the writer
  // is mounted, then clear it when the writer closes.
  // A guest's first-ever opening gets the demo prompt (HTPR-4937) and marks
  // the intro as seen, so every later opening behaves normally.
  const isPlainOpening =
    !createTaskModal.duplicate &&
    !createTaskModal.column_payload?.createTaskFromComment &&
    !createTaskModal.column_payload?.prefilledTitle &&
    !createTaskModal.column_payload?.prefilledDescription;
  const aiPromptRef = useRef(
    createTaskModal.defaultEditFocus?.aiPrompt ??
      (isPlainOpening && shouldShowGuestWriterIntro()
        ? GUEST_DEMO_TASK_PROMPT
        : undefined)
  );
  const closeAiTaskWriter = () => {
    aiPromptRef.current = undefined;
    setShouldShowAITaskWriter(false);
  };
  const toggleAiTaskWriterVisibility = () => {
    if (shouldShowAiTaskWriter) aiPromptRef.current = undefined;
    setShouldShowAITaskWriter((current) => !current);
  };
  const seedPrompt = aiPromptRef.current;
  const taskWriterDescription = resolveTaskWriterDescription(
    editor?.getHTML(),
    formValues.description,
  );
  const autoDraftPrompt = buildTaskWriterAutoDraftPrompt({
    title: formValues.title,
    description: taskWriterDescription,
    board: formValues.currentProject?.title,
    status: formValues.status,
    assignees: formValues.assignees,
    tags: formValues.tags,
    priority: formValues.priority,
    estimate: formValues.estimate,
    dueDate: formValues.dueDate,
    startDate: formValues.startDate,
  });
  const taskWriterOpening = resolveCreateTaskWriterOpening(
    seedPrompt,
    autoDraftPrompt,
  );
  const queryClient = useQueryClient();
  const {
    data: userPreferences,
    isFetched: preferencesFetched,
    isSuccess: preferencesFetchSucceeded,
  } = useGetUserPreferences();
  const preferencesHydrated = preferencesFetched && preferencesFetchSucceeded;
  useEffect(() => {
    if (!shouldShowAiTaskWriter) return;
    enableAutoTitleGeneration();
    if (isGuestCookieUser()) {
      try {
        window.localStorage.setItem(GUEST_WRITER_SEEN_KEY, "true");
      } catch {
        // Storage blocked: the intro may repeat, nothing else breaks.
      }
    }
  }, [enableAutoTitleGeneration, shouldShowAiTaskWriter]);
  const pathname = usePathname();
  const projectForContext =
    formValues.currentProject ?? _currentProject ?? undefined;
  const projectId = projectForContext?.id;
  const { data: projectLabels } = useGetAllProjectLabels(
    projectId ?? undefined,
  );
  const { data: membersAndOwner } = useGetAllMembersForAssign(
    ["create-task-writer-assignees", projectId],
    projectId ?? 0,
  );
  const projectAssignees = React.useMemo(() => {
    const options: (IUser | IAgent)[] = [
      ...(membersAndOwner?.members?.map(({ user }: { user: IUser }) => user) ??
        []),
      ...(membersAndOwner?.owner ? [membersAndOwner.owner] : []),
      ...(membersAndOwner?.boardAgents ?? []),
    ];
    return Array.from(
      new Map(
        options.map((assignee) => [String(assignee.id), assignee]),
      ).values(),
    );
  }, [membersAndOwner]);
  const projectSections = React.useMemo(
    () => getActiveColumnsViewFromProject(projectForContext) ?? [],
    [projectForContext],
  );
  useEffect(() => {
    if (openingProjectIdRef.current !== formValues.currentProject?.id) {
      openingProjectIdRef.current = formValues.currentProject?.id;
      openingSectionIdRef.current = formValues.status?.sectionId;
      return;
    }
    if (
      openingSectionIdRef.current === undefined &&
      formValues.status?.sectionId !== undefined
    ) {
      openingSectionIdRef.current = formValues.status.sectionId;
    }
  }, [formValues.currentProject?.id, formValues.status?.sectionId]);
  const id = "create-task-tiptap-description";
  const divIds = {
    popoverContainer: "popover-wrapper-" + id,
    wrapperId: "main-wrapper-create-task-" + id,
    popoverId: "popoverId-" + id,
    popoverTriggerButtonId: "popover-button-" + id,
  };

  const addImage = (data: DataTransfer) => {
    const { files } = data;
    console.log(files);

    if (files && files.length > 0) {
      for (const file of Array.from(files)) {
        const [mime] = file.type.split("/");

        if (mime === "image") {
          const url = URL.createObjectURL(file);
          console.log("IMAGE URL  " + url);
          editor
            ?.chain()
            .focus()
            .setMedia({ "media-type": "img", src: url })
            .run();
        }
      }
    }
  };

  const toggleHighlightHandler = (state: boolean) => {
    setToggleHighlight(state);
  };

  const onDropHandler = (e: any) => {
    e.preventDefault();
    e.stopPropagation();
    addImage(e.dataTransfer);
  };
  const handleFocus = (forceFocus?: boolean) => {
    // console.log("focusing now")
    // console.log("🚀 ~ handleFocus ~ editor?.isFocused:", editor?.isFocused)
    if (editor?.isFocused || (shouldShowAiTaskWriter && !forceFocus))
      return false;
    editor?.commands.focus("end");
  };

  const onChangeHandler = () => {
    const description = editor?.getHTML() ?? "";
    handleChange("description", description);
    scheduleTitleGeneration(description);
    const takeover = autoDescriptionTakeoverRef.current;
    if (takeover && description !== takeover.inserted) {
      autoDescriptionTakeoverRef.current = null;
      setAutoDescriptionTakeover(null);
    }
    editor?.commands.setMeta("projectId", 2);
  };
  // ==================== get attachments from the componetn =============
  const getAttachments = async (files: File[]) => {
    // console.log("🚀 ~ file: TipTap.tsx:376 ~ getAttachments ~ files:", files)
    setNewCommentAttachments(files);
  };

  const handleFileDrop = async (droppedFiles: FileList) => {
    console.log("🚀 ~ handleFileDrop ~ droppedFiles:", droppedFiles);
    if (droppedFiles && droppedFiles.length > 0)
      setFilesDropped([...droppedFiles]);
  };

  const audioTiptapCallback = (text: string, setContent: boolean = false) => {
    if (editor) {
      if (setContent) {
        editor.chain().setContent(text).focus("end").run();
        handleChange("description", editor?.getHTML());
      } else editor.chain().focus().insertContent(text).run();
    }
  };

  const resetDropFiles = () => setFilesDropped([]);

  // whenever attachments are ALL uploaded, this function runs.
  // it runs as the FINAL call, not on each upload
  const callbackAttachments = async (attachmentsReturned: { id: number; file: { name: string; size: number; type: string; source: string } }[]) => {
    console.log("🚀 ~ callbackAttachments ~ attachmentsReturned:", attachmentsReturned)
    // get all the urls back
    // console.log("🚀 ~ callbackAttachments ~ attachmentsReturned:", attachmentsReturned)
    // this is confirmation that attachments are uploaded.
    // setTotalChecks(prev=>prev+1)
    handleChange("attachments", attachmentsReturned);
    setNewCommentAttachments(attachmentsReturned)
    setTrigger(prev=>!prev)
  };

  useEffect(() => {
    editor?.off("update");
    editor?.on("update", onChangeHandler);
  }, [editor, scheduleTitleGeneration]);

  const autoDescriptionTitle = formValues.title.trim();
  const autoDescriptionEligible = shouldSuggestCreateDescription({
    enabled: userPreferences.autoDescriptionSuggestions ?? true,
    isDesktop: !isMbl,
    title: autoDescriptionTitle,
    description: taskWriterDescription,
    preferencesHydrated,
    dismissed: autoDescriptionDismissed,
  });

  useEffect(() => {
    setAutoDescriptionVisible(false);
    autoDescriptionTitleRef.current = "";
    if (
      !autoDescriptionEligible ||
      shouldShowAiTaskWriter ||
      autoDescriptionTakeover
    ) {
      return;
    }

    const expectedTitle = autoDescriptionTitle;
    const timeout = window.setTimeout(() => {
      const currentDescription = editor?.getHTML() ?? formValues.description;
      if (
        !canApplyCreateDescriptionSuggestion(
          expectedTitle,
          formValues.title,
          currentDescription,
          userPreferences.autoDescriptionSuggestions ?? true,
          autoDescriptionDismissed,
        )
      ) {
        return;
      }
      autoDescriptionTitleRef.current = expectedTitle;
      setAutoDescriptionVisible(true);
    }, AUTO_DESCRIPTION_SUGGESTION_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [
    autoDescriptionDismissed,
    autoDescriptionEligible,
    autoDescriptionTakeover,
    autoDescriptionTitle,
    editor,
    formValues.currentProject?.id,
    formValues.description,
    shouldShowAiTaskWriter,
    userPreferences.autoDescriptionSuggestions,
  ]);

  const handleAutoDescriptionTakeover = (content: string) => {
    const currentDescription = editor?.getHTML() ?? formValues.description;
    if (
      !editor ||
      !canApplyCreateDescriptionSuggestion(
        autoDescriptionTitleRef.current,
        formValues.title,
        currentDescription,
        userPreferences.autoDescriptionSuggestions ?? true,
        autoDescriptionDismissed,
      )
    ) {
      setAutoDescriptionVisible(false);
      toast("Your description changed, so the AI draft was not inserted.");
      return;
    }

    const before = editor.getHTML();
    // Auto suggestions are text-only, so neither selected nor generated files change here.
    editor.commands.setContent(content, { emitUpdate: true });
    const inserted = editor.getHTML();
    handleChange("description", inserted);
    setAutoDescriptionVisible(false);
    const takeover = { before, inserted };
    autoDescriptionTakeoverRef.current = takeover;
    setAutoDescriptionTakeover(takeover);
  };

  const undoAutoDescriptionTakeover = () => {
    if (
      !editor ||
      !autoDescriptionTakeover ||
      !canUndoDescriptionTakeover(editor.getHTML(), autoDescriptionTakeover)
    ) {
      autoDescriptionTakeoverRef.current = null;
      setAutoDescriptionTakeover(null);
      return;
    }
    editor.commands.setContent(autoDescriptionTakeover.before, {
      emitUpdate: true,
    });
    handleChange("description", autoDescriptionTakeover.before);
    autoDescriptionTakeoverRef.current = null;
    setAutoDescriptionTakeover(null);
    setAutoDescriptionDismissed(true);
  };

  const turnOffAutoDescriptionsPermanently = async () => {
    const previous =
      queryClient.getQueryData<IUserPreferences>(USER_PREFERENCES_QUERY_KEY) ??
      userPreferences;
    queryClient.setQueryData<IUserPreferences>(
      USER_PREFERENCES_QUERY_KEY,
      (current) => ({
        ...(current ?? userPreferences),
        autoDescriptionSuggestions: false,
      }),
    );
    setAutoDescriptionVisible(false);
    try {
      const response = await axios.post(userPreferencesRoute, {
        autoDescriptionSuggestions: false,
      });
      if (response.status !== 200) throw new Error("Preference update failed");
    } catch {
      queryClient.setQueryData(USER_PREFERENCES_QUERY_KEY, previous);
      toast.error("Could not turn off description suggestions");
    }
  };

  const resetComposerAfterCreate = () => {
    resetFormValues();
    setEditMode("title");
    setCurrentFocusedElement("Title");
    setShowConfirmationModal(false);
    setFilesDropped([]);
    setNewCommentAttachments([]);
    setTrigger((current) => !current);
    handleSetUserInput("");
    aiPromptRef.current = undefined;
    autoDescriptionTitleRef.current = "";
    autoDescriptionTakeoverRef.current = null;
    setAutoDescriptionVisible(false);
    setAutoDescriptionDismissed(false);
    setAutoDescriptionTakeover(null);
    setHasOpenedClassicForm(false);
    setShouldShowAITaskWriter(false);
    editor?.chain().unsetHighlight().clearContent().run();
    setUploadingStateCreateTaskModal(undefined);
  };

  useLayoutEffect(() => {
    const handleEventTrigger = (event: CustomEvent) => onChangeHandler();

    window.addEventListener(
      TIPTAPUPDATECREATETASK,
      handleEventTrigger as EventListener
    );
    return () =>
      window.removeEventListener(
        TIPTAPUPDATECREATETASK,
        handleEventTrigger as EventListener
      );
  }, [editor]);

  // useEffect(() => {
  //   if (editMode==="Description") handleFocus()
  //   else editor?.commands.blur()
  // }, [editMode])
  const CtrlEnterHandler = async (param?: TSendBackButtonParam) => {
    console.log("🚀 ~ CtrlEnterHandler ~ canSave:", canSave);
    if (isRecording) return;
    // Without a save mode none of the branches below run, so bail out before
    // starting title generation or flipping the upload flag.
    if (!param) return;
    if (uploadInProgress) return toast("Please wait for the task to upload");
    if (canSave && !canSave?.canUpload)
      return toast(
        `Please wait for the upload to finish before submitting your ticket.`
      );

    // TipTap owns the freshest editor document. React state can still contain
    // the previous render when someone types and immediately saves, so every
    // save mode snapshots the editor instead of risking an empty description.
    let descriptionAtSave = editor?.getHTML() ?? formValues.description;
    let titleAtSave = getCurrentTitle();
    const epochAtSave = saveEpochRef.current;
    if (shouldGenerateTitleForSave(titleAtSave, descriptionAtSave)) {
      if (titleGenerationForSaveRef.current) return;
      titleGenerationForSaveRef.current = true;
      setUploadInProgress(true);
      try {
        // More writing invalidates the current request. Keep taking the latest
        // editor snapshot until one title matches what will actually be saved.
        while (shouldGenerateTitleForSave(titleAtSave, descriptionAtSave)) {
          const generatedTitle =
            await generateTitleFromDescription(descriptionAtSave);
          if (saveEpochRef.current !== epochAtSave) {
            setUploadInProgress(false);
            return;
          }
          descriptionAtSave = editor?.getHTML() ?? descriptionAtSave;
          if (generatedTitle === null) {
            titleAtSave = getCurrentTitle();
            continue;
          }
          titleAtSave = generatedTitle;
        }
      } catch (error) {
        console.log("Could not generate a title", error);
        setUploadInProgress(false);
        if (saveEpochRef.current !== epochAtSave) return;
        setEditMode("title");
        setCurrentFocusedElement("Title");
        toast.error("Couldn’t generate a title. Add one to save.");
        return;
      } finally {
        titleGenerationForSaveRef.current = false;
      }
    }
    if (!titleAtSave) {
      setUploadInProgress(false);
      setEditMode("title");
      setCurrentFocusedElement("Title");
      toast.error("Add a title to save.");
      return;
    }
    if (param === "Save") {
      setUploadInProgress(true);
      let traceScope: TaskCreateTraceScope | null = null;
      try {
        const createTask = CreateTaskAndDescription(descriptionAtSave, titleAtSave);
        traceScope = getTaskCreatePerformanceTraceScope();
        const taskUrl = await createTask;
        if (taskUrl) {
          // Next keeps the /new route in its client history. Clear the mounted
          // composer before leaving so Back restores a fresh creator rather than
          // the values that were just saved.
          resetComposerAfterCreate();
          setUploadInProgress(false);
          if (isMbl && pathname !== "/new") {
            await closeBackDismissBeforeNavigation(
              window,
              "createTaskModal",
              closeHandler,
            );
          }
          await asyncPush(taskUrl);
          if (!isMbl && pathname !== "/new") closeHandler();
          completeTaskCreatePerformanceTraceAfterPaint(
            "task_detail",
            traceScope,
          );
        }
      } catch (error) {
        completeTaskCreatePerformanceTrace("error", traceScope);
        console.log("🚀 ~ CreateTaskAndDescription ~ error:", error);
        setUploadInProgress(false);
        toast.error("Error when creating");
        return;
      }
    } else if (param === "SaveAndClose") {
      setUploadInProgress(true);
      const createTask = CreateTaskAndDescription(descriptionAtSave, titleAtSave);
      const traceScope = getTaskCreatePerformanceTraceScope();
      toast.promise(createTask, {
        loading: "Creating the task",
        success: () => {
          localStorage.removeItem("MENTION_PROJECT_ID");
          resetComposerAfterCreate();
          setUploadInProgress(false);
          // Creation has finished, so both the modal and /new can close without
          // a discard prompt. Passing false here would ask whether to discard a
          // task that has already been saved.
          closeHandler(true);
          completeTaskCreatePerformanceTraceAfterElementRemoved(
            "modal_closed",
            traceScope,
            divIds.wrapperId,
          );
          return `Succesfully created the task`;
        },
        error: (error) => {
          completeTaskCreatePerformanceTrace("error", traceScope);
          console.log("🚀 ~ toast.promise ~ error:", error);
          setUploadInProgress(false);
          return "error when creating";
        },
      });
    } else if (param === "SaveAndNew") {
      setUploadInProgress(true);
      const createTask = CreateTaskAndDescription(descriptionAtSave, titleAtSave);
      const traceScope = getTaskCreatePerformanceTraceScope();
      toast.promise(createTask, {
        loading: "Creating the task",
        success: () => {
          resetComposerAfterCreate();
          document.getElementById(DIV_ID_CONSTANTS.titleInputModal)?.focus();
          setUploadInProgress(false);
          completeTaskCreatePerformanceTraceAfterPaint(
            "composer_reset",
            traceScope,
          );
          return `Succesfully created the task`;
        },
        error: (error) => {
          completeTaskCreatePerformanceTrace("error", traceScope);
          console.log("🚀 ~ toast.promise ~ error:", error);
          setUploadInProgress(false);
          return "error when creating";
        },
      });
    }
  };

  const toggleAiTaskWriter = () => {
    // editor?.chain().focus().toggleHighlight({ color: "#b89bdd" });
    editor?.chain().selectAll().setHighlight({ color: "#F0D8FF" }).run();
    document.getElementById(divIds.popoverContainer)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    if (!shouldShowAiTaskWriter) setHasOpenedClassicForm(true);
    toggleAiTaskWriterVisibility();
    if (editMode === "Description" && !shouldShowAiTaskWriter)
      setEditMode("Description-ai");
  };

  const showClassicForm = useCallback(() => {
    setHasOpenedClassicForm(true);
    closeAiTaskWriter();
    editor?.commands.unsetHighlight();
    setEditMode(null);
    setCurrentFocusedElement("Description");
  }, [closeAiTaskWriter, editor, setCurrentFocusedElement, setEditMode]);

  const applyCreateTaskResult = useCallback(
    (
      result: ITaskWriterResult,
      attachments: ITaskWriterAttachment[] | undefined,
      responseProjectId: number | undefined,
    ) => {
      const currentProjectId = projectForContext?.id;
      // The provider's request scope identifies the board used by the model.
      // Never apply a response after the user has switched boards.
      if (
        !currentProjectId ||
        responseProjectId === undefined ||
        responseProjectId !== currentProjectId
      ) {
        // Do not leave the user behind in a writer whose response belongs to a
        // board they just left. The response is discarded by the caller.
        showClassicForm();
        return false;
      }

      const currentDescription = editor?.getHTML() ?? formValues.description;
      const hasDescription = hasTaskDescriptionContent(currentDescription);
      let changed = false;

      if (!formValues.title.trim() && result.title?.trim()) {
        applyTaskWriterTitle(result.title.trim());
        changed = true;
      }
      if (!hasDescription && hasTaskDescriptionContent(result.description)) {
        const description = result.description;
        editor?.commands.setContent(description);
        handleChange("description", description);
        changed = true;
      }
      if (!formValues.priority && result.priority) {
        handleChange("priority", result.priority);
        changed = true;
      }
      if (!formValues.estimate && result.estimate) {
        handleChange("estimate", result.estimate);
        changed = true;
      }
      if (
        (!formValues.tags || formValues.tags.length === 0) &&
        result.tags?.length
      ) {
        handleChange("tags", result.tags);
        changed = true;
      }
      if (formValues.assignees.length === 0 && result.assignees?.length) {
        handleChange("assignees", result.assignees);
        changed = true;
      }
      if (!formValues.dueDate && result.dueDate) {
        handleChange("dueDate", result.dueDate);
        changed = true;
      }
      if (!formValues.startDate && result.startDate) {
        handleChange("startDate", result.startDate);
        changed = true;
      }
      const currentSectionId = formValues.status?.sectionId;
      if (
        result.status &&
        (currentSectionId === undefined ||
          currentSectionId === openingSectionIdRef.current)
      ) {
        handleChange("status", {
          ...result.status,
          position: result.status.position ?? "top",
        });
        changed = true;
      }
      if (formValues.attachments.length === 0 && attachments?.length) {
        const mappedAttachments = attachments.map((attachment, index) => ({
          id: index,
          file: {
            name: attachment.file.name,
            size: attachment.file.size,
            type: attachment.file.type,
            source: attachment.preview,
          },
        }));
        callbackAttachments(mappedAttachments);
        changed = true;
      }

      setTaskWriterFilled(changed);
      showClassicForm();
      return changed;
    },
    [
      applyTaskWriterTitle,
      callbackAttachments,
      editor,
      formValues,
      handleChange,
      projectForContext,
      showClassicForm,
    ],
  );

  const mobileCreateFormDescription = editor?.getText().trim() || "";
  const mobileCreateFormProperties = [
    formValues.status?.sectionTitle &&
    formValues.status.sectionId !== openingSectionIdRef.current
      ? `Section: ${formValues.status.sectionTitle}`
      : undefined,
    formValues.priority?.Priority_Value
      ? `Priority: ${formValues.priority.Priority_Value}`
      : undefined,
    formValues.assignees.length
      ? `Assignee: ${formValues.assignees.map((assignee) => assignee.displayName).join(", ")}`
      : undefined,
    formValues.tags?.length
      ? `Labels: ${formValues.tags.map((tag) => tag.value).join(", ")}`
      : undefined,
    formValues.dueDate
      ? `Due: ${formValues.dueDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
      : undefined,
    formValues.estimate?.estimate_full_value
      ? `Size: ${formValues.estimate.estimate_full_value}`
      : undefined,
    formValues.startDate
      ? `Start: ${formValues.startDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
      : undefined,
  ].filter((value): value is string => Boolean(value));
  const mobileCreateAssigneeLabel = formValues.assignees.length
    ? formValues.assignees
        .map((assignee) => assignee.displayName)
        .join(", ")
    : "Assign";
  const mobileCreateFormTitle = formValues.title.trim() || undefined;
  const mobileCreateFormSummary =
    hasOpenedClassicForm &&
    (mobileCreateFormTitle ||
      mobileCreateFormDescription ||
      mobileCreateFormProperties.length > 0)
      ? {
          title: mobileCreateFormTitle,
          description: mobileCreateFormDescription || undefined,
          properties: mobileCreateFormProperties,
        }
      : undefined;
  const mobileCreateTask = isMbl
    ? {
        boardLabel: formValues.currentProject?.title ?? "Choose board",
        priorityLabel: formValues.priority?.Priority_Value ?? "None",
        assigneeLabel: mobileCreateAssigneeLabel,
        formSummary: mobileCreateFormSummary,
        onBoardClick: toggleProjectsModal,
        onPriorityClick: togglePriorityModal,
        onAssigneeClick: () => setShowAssignModal(true),
        onClassicForm: showClassicForm,
        onClose: () => closeHandler(false),
      }
    : undefined;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleKeyDown = (e: any) => {
    var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
    if (showAssignModal || isRecording) return;
    if (cmdControl && e.key === "Enter") {
      // When AI Task Writer is visible and focused, let it handle Ctrl+Enter to send the prompt
      if (shouldShowAiTaskWriter) {
        const aiWriterEl = document.getElementById(divIds.popoverId);
        if (aiWriterEl?.contains(document.activeElement)) {
          return; // Don't Save – AI Task Writer will send the prompt
        }
      }
      if (!e.altKey && !e.shiftKey) CtrlEnterHandler("Save");
      if (e.altKey && !e.shiftKey) CtrlEnterHandler("SaveAndClose");
      if (e.altKey && e.shiftKey) CtrlEnterHandler("SaveAndNew");
      return;
    }
    if (!editor?.isFocused) return;
    if (e.key === "Escape") {
      if (editMode === "Description-ai" && userInput.length > 0) {
        setShowConfirmationModal(false);
      } else {
        setEditMode(null);
        editor.commands.blur();
        return;
      }
    }
    // // [ctrl] + [j]
    if (cmdControl && e.keyCode === KeyCodes.J) {
      e.preventDefault();
      console.log("🚀 ~ handleKeyDown ~ endTour");
      endTour()
      document
        .getElementById(id)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      editor?.chain().focus().toggleHighlight({ color: "#b89bdd" });
      toggleAiTaskWriterVisibility();
    }
    // [Attachments] cmd/cntrl + shift + [1]
    if (e.shiftKey && cmdControl && e.keyCode === KeyCodes.ONE) {
      e.preventDefault();
      editor?.chain().focus().toggleHeading({ level: 1 }).run();
    }
    // [Attachments] cmd/cntrl + shift + [2]
    if (e.shiftKey && cmdControl && e.keyCode === KeyCodes.TWO) {
      e.preventDefault();
      editor?.chain().focus().toggleHeading({ level: 2 }).run();
    }
    if(e.keyCode === KeyCodes.C && e.shiftKey && cmdControl) {
      e.preventDefault();
      const selectAllIfNeeded = () => {
        const { from, to } = editor.state.selection ?? { from: 0, to: 0 };
        if (from === to) editor.chain().focus().selectAll().run();
        return editor.state.selection ?? { from: 0, to: 0 };
      };

      if (e.altKey) {
        const { from, to } = selectAllIfNeeded();
        const text = editor.state.doc.textBetween(from, to, "\n");
        editor.chain().focus().deleteSelection().insertContent({
          type: "codeBlock",
          content: text ? [{ type: "text", text }] : undefined,
          attrs: { language: "javascript" },
        }).run();
      } else {
        const { from, to } = editor.state.selection ?? { from: 0, to: 0 };
        editor.chain()
          .focus()
          .command(({ commands }) => (from === to ? commands.selectAll() : true))
          .setCode()
          .run();
      }
    }
    // [Attachments] cmd/cntrl + shift + a
    if (e.shiftKey && cmdControl && e.keyCode === KeyCodes.A) {
      e.preventDefault();
      document.getElementById(attachmentButtonId)?.click();
      setEditMode("Description");
      setCurrentFocusedElement("Description");
    }

    // [Audio button] cmd/ctrl + shift + d
    if (e.shiftKey && cmdControl && e.keyCode === KeyCodes.D) {
      e.preventDefault();
      if (isRecording) return;
      let elementId = "create-task-modal-audio-button";
      document.getElementById(elementId)?.click();
    }

    // [Audio button with improve] cmd/ctrl + shift + f
    if (e.shiftKey && cmdControl && e.keyCode === KeyCodes.F) {
      e.preventDefault();
      if (isRecording) return;
      let elementId = "create-task-modal-audio-button-improve";
      document.getElementById(elementId)?.click();
    }

    // [Audio button] alt+v
    if (e.altKey && e.keyCode === KeyCodes.V) {
      e.preventDefault();
      if (isRecording) return;
      document.getElementById("create-task-modal-audio-button")?.click();
    }

    //edit title [f2]
    if (e.keyCode === KeyCodes.F2) {
      e.preventDefault();
      setEditMode("title");
      setCurrentFocusedElement("Title");
    }
  };
  useEffect(() => {
    if (editMode === "Description" && !shouldShowAiTaskWriter) {
      handleFocus();
      if (_currentProject?.id === 2) {
        console.log("🚀 ~ useEffect ~ hereiam");

        editor?.setEditable(true);
        editor?.view.dispatch(editor?.view.state.tr);
      }
    } else if (editMode === "Description-ai") {
      setShouldShowAITaskWriter(true);
      editor?.chain().toggleHighlight({ color: "#b89bdd" });
      // setTimeout(() => {
      //   handleFocus();
      // }, 100);
    }
  }, [shouldShowAiTaskWriter, editMode, editor]);
  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [handleKeyDown]);

  useEffect(() => {
    const popover = document.getElementById(
      divIds.popoverId
    ) as HTMLElement | null;
    const targetDiv = document.getElementById(
      divIds.wrapperId
    ) as HTMLElement | null;
    const calculatePopoverPosition = (
      targetDiv: HTMLElement,
      popover: HTMLElement
    ) => {
      // Get the current height of the popover
      const popoverHeight = popover.offsetHeight;
      console.log("Size ===> new min height", popoverHeight + 30);
      // Set the min-height of the target div to be popover height + 30px
      targetDiv.style.minHeight = `${popoverHeight + 30}px`;
    };

    const resizeObserver = new ResizeObserver(() => {
      console.log("Size ==> is changing");
      if (!popover) return;

      if (targetDiv) {
        calculatePopoverPosition(targetDiv, popover);
      }
    });

    if (popover) resizeObserver.observe(popover);
    else {
      targetDiv!.style.minHeight = "unset";
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [shouldShowAiTaskWriter]);

  useEffect(() => {
    if (isRecording && editor) {
      editor.setEditable(false);
    } else if (!isRecording && editor) {
      editor.setEditable(true);
    }
  }, [editor, isRecording]);

  return (
    <>
      {
        <div
          // onKeyDown={handleKeyDown}
          id={divIds.wrapperId}
          className={`${styles.hellow} relative`}
          onFocus={() => handleFocus()}
        >
          <TiptapBubbleMenu
              hideMenu = {isMbl===true}
              currentProjectId={_currentProject?.id}
              editor={editor}
              allowPerks={true}
              toggleHighlight={toggleHighlight}
              toggleHighlightHandler={toggleHighlightHandler}
            />

          <div
            id={divIds.popoverContainer}
            className={`w-full absolute z-[1000] ${
              shouldShowAiTaskWriter ? "block h-full" : "hidden h-0"
            }`}
          >
            {shouldShowAiTaskWriter && (
              <AITaskWriterContainer
                id={divIds.popoverId}
                backgroundContent={taskWriterDescription}
                defaultMode="AiTaskWriter"
                // Existing ticket content drafts immediately. The guest intro
                // and prompts from explicit flows keep their existing behavior.
                autoTrigger={taskWriterOpening.autoTrigger}
                initialPrompt={taskWriterOpening.initialPrompt}
                projectLabels={projectLabels}
                projectSections={projectSections}
                projectAssignees={projectAssignees}
                mobileCreateTask={mobileCreateTask}
                applyCreateTaskResult={applyCreateTaskResult}
                project={projectForContext}
                EscapeHandler={() => {
                  closeAiTaskWriter();
                  editor?.commands.unsetHighlight();
                  setEditMode("Description");
                  handleFocus(true);
                }}
                AISaveHandler={(response, attachments) => {
                  closeAiTaskWriter();
                  editor?.commands.setContent(response);
                  const mappedAttachments =
                    attachments?.map((x, idx) => ({
                      id: idx,
                      file: {
                        name: x.file.name,
                        size: x.file.size,
                        type: x.file.type,
                        source: x.preview,
                      },
                    })) || [];
                  editor?.commands.unsetHighlight();
                  setEditMode("Description");
                  handleChange("description", response);
                  callbackAttachments(mappedAttachments);
                  handleFocus(true);
                }}
                returnTitleAndDescription={(title, description, props) => {
                  if (title) applyTaskWriterTitle(title);
                  if (props?.priority) handleChange("priority", props.priority);
                  if (props?.estimate) handleChange("estimate", props.estimate);
                  if (props?.tags) handleChange("tags", props.tags);
                  if (props?.status)
                    handleChange("status", {
                      ...props.status,
                      position: props.status.position ?? "top",
                    });
                  if (props?.assignees)
                    handleChange("assignees", props.assignees);
                  if (props?.dueDate) handleChange("dueDate", props.dueDate);
                  if (props?.startDate)
                    handleChange("startDate", props.startDate);
                }}
                attachments={newCommentAttachments}
                returnUserInputHandler={handleSetUserInput}
                toggleRecording={toggleRecording}
                isRecording={isRecording}
                dictationCoordinator={dictationCoordinator}
                createTask={true}
              />
            )}
          </div>

          <FileDragOverlay
            dropCallbackHandler={handleFileDrop}
            allowDrop={true}
            customClassName={`ml-[-20px] mr-[-16px] mb-[-4px] mt-[-42px] !rounded-[0.275rem]`}
          >
            {editor ? (
              <div
                id={id}
                className={`
                ${isMbl ? "text-emphasis" : "text-content"} text-white-black ${
                  styles.editorContainer
                }
                `}
              >
                <>
                  {_currentProject?.id === 2 && (
                    <DragHandle
                      editor={editor}
                      computePositionConfig={{
                        placement: "left" }}
                      className="cursor-grab"
                    >
                      <div className="pr-[6px]">
                        <div className="bg-selectionDark p-1 rounded-sm">
                          <GripVertical color="white" size={14} strokeWidth={1.75} />
                        </div>
                      </div>
                    </DragHandle>
                  )}
                  <EditorContent
                    id="create-task-tiptap-description"
                    // onFocus={handleFocus}
                    onDrop={onDropHandler}
                    className="max-h-[60svh] scrollbar-none max-w-full cursor-text pt-2 min-h-[80px] overflow-y-auto overflow-x-hidden"
                    editor={editor}
                  />
                </>
              </div>
            ) : (
              <div className="h-[21px]"></div>
            )}
            {autoDescriptionVisible &&
              autoDescriptionEligible &&
              autoDescriptionTitleRef.current === autoDescriptionTitle &&
              autoDraftPrompt &&
              !shouldShowAiTaskWriter && (
                <AITaskWriterContainer
                  key={`create-auto-description-${projectId}-${autoDescriptionTitle}`}
                  id="create-task-auto-description-writer"
                  backgroundContent=""
                  EscapeHandler={() => setAutoDescriptionVisible(false)}
                  AISaveHandler={handleAutoDescriptionTakeover}
                  returnTitleAndDescription={() => undefined}
                  defaultMode="AiTaskWriter"
                  autoTrigger
                  initialPrompt={autoDraftPrompt}
                  project={projectForContext}
                  presentation="description-suggestion"
                  requestKind="auto-description"
                  onTurnOffTask={() => {
                    setAutoDescriptionDismissed(true);
                    setAutoDescriptionVisible(false);
                  }}
                  onTurnOffPermanently={turnOffAutoDescriptionsPermanently}
                  toggleRecording={toggleRecording}
                  isRecording={isRecording}
                />
              )}
            {!autoDescriptionVisible && autoDescriptionTakeover && (
              <div className="mt-3 flex items-center gap-2 rounded-[4px] bg-cardBackground px-3 py-2 text-dense text-text-light-gray">
                <span>Draft moved into the description.</span>
                <button
                  type="button"
                  className="font-semibold text-hypertasks-ai-purple"
                  onClick={undoAutoDescriptionTakeover}
                >
                  Undo
                </button>
              </div>
            )}
            <AttachmentsUpload
              hasTitle={formValues.title.trim().length > 0}
              filesFromParent={newCommentAttachments}
              trigger={trigger}
              callback={getAttachments}
              mode={"create-task-modal"}
              droppedFiles={filesDropped}
              resetDropFiles={resetDropFiles}
              sendOnClick={CtrlEnterHandler}
              editor={editor}
              returnUploadedAttachments={callbackAttachments}
              audioTiptapCallback={audioTiptapCallback}
              audioDefaultContent={editor?.getText()}
              toggleRecording={toggleRecording}
              isRecording={isRecording}
              dictationCoordinator={dictationCoordinator}
              toggleAiTaskWriter={toggleAiTaskWriter}
              isAiTaskWriterOpen={shouldShowAiTaskWriter}
            />
          </FileDragOverlay>
        </div>
      }
      <button
        className="hidden"
        onClick={toggleAiTaskWriterVisibility}
        id={divIds.popoverTriggerButtonId}
      />
      <button
        className="hidden"
        onClick={toggleAiTaskWriter}
        id={aiTaskWriterConfig.elementIds.createTaskModalTrigger}
      />
    </>
  );
};

export default TiptapCreateTaskModal;
