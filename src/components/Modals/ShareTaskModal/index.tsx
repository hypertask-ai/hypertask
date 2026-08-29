import {
  ModalContainerCustom,
  ModalHeaderComp,
  HintKey,
} from "@/components/Common/CommonModalComponents";
import { MobileBottomSheet } from "@/components/Modals/Sheets";
import { currentUserAtom, inViewObjectAtom } from "@/store";
import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRecoilState } from "@/lib/state";
import styles from "@/styles/linksModal.module.scss";
import { ModalBody } from "reactstrap";
import { Check, Copy, Globe, Lock, X } from "lucide-react";
import { ITask } from "@/models/model";
import { useGetTaskShareLinks } from "@/hooks/Task Detail/useGetShareLinks";
import useCopyURL from "@/hooks/General/useCopyURL";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import axios from "axios";
import { KeyCodes } from "@/lib/constants/keyboard-handler";

type TProps = {
  closeHandler: () => void;
};

const ShareTaskModal: React.FC<TProps> = ({ closeHandler }) => {
  const [currentUser, __] = useRecoilState(currentUserAtom);
  const [currentTask, setCurrentTask] = useState<ITask | undefined>(undefined);

  const [inViewObject, _] = useRecoilState(inViewObjectAtom);
  const mbl = useContext(MobileViewContext);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(true);
  const mobileClosingRef = useRef(false);
  const mobileHistoryEntryRef = useRef(false);
  const { data: linkObj } = useGetTaskShareLinks(
    inViewObject.taskId!,
    inViewObject.taskProjectId!,
    currentUser?.id!
  );
  const {
    copySharedTaskFormattedURL,
    copySharedTaskURL,
    copyTaskFormattedURL,
    copyTaskURL,
  } = useCopyURL({ plainTextOnly: mbl });
  const isApple = useDeviceContext();

  const closeMobileSheet = useCallback(
    (fromHistory = false) => {
      if (mobileClosingRef.current) return;
      mobileClosingRef.current = true;
      setMobileSheetOpen(false);

      if (!fromHistory && mobileHistoryEntryRef.current) {
        mobileHistoryEntryRef.current = false;
        window.history.back();
      }
    },
    []
  );

  const baseURL =
    process.env.NEXT_PUBLIC_BASEURL || "https://app.hypertask.ai";

  const getPrivateURL = (): string => {
    if (!currentTask?.uniqueIndex || !currentTask?.projectId) return "";
    return `${baseURL}/detail/project-${currentTask.projectId}/${currentTask.uniqueIndex}`;
  };

  const getPrivateFormattedText = (): string => {
    if (!currentTask?.ticketNumber || !currentTask?.title) return "";
    const url = getPrivateURL();
    return `${currentTask.ticketNumber.toUpperCase()} | ${
      currentTask.title
    } | ${url}`;
  };

  const getPublicURL = (): string => {
    if (!linkObj?.id) return "";
    return `${baseURL}/share?id=${linkObj.id}`;
  };

  const getPublicFormattedText = (): string => {
    if (!currentTask?.ticketNumber || !currentTask?.title) return "";
    const url = getPublicURL();
    return `${currentTask.ticketNumber.toUpperCase()} | ${
      currentTask.title
    } | ${url}`;
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
    if (cmdControl && e.keyCode === KeyCodes.PERIOD && !e.shiftKey) {
      e.preventDefault();
      if (linkObj?.id) {
        copySharedTaskFormattedURL(
          linkObj.id,
          currentTask?.title ?? "",
          currentTask?.ticketNumber ?? ""
        );
      }
    }

    if (cmdControl && e.keyCode === KeyCodes.PERIOD && e.shiftKey) {
      e.preventDefault();
      if (linkObj?.id) {
        copySharedTaskURL(linkObj.id);
      }
    }

    if (
      cmdControl &&
      (e.keyCode === KeyCodes.COMMA || e.keyCode === KeyCodes.SEMICOLON) &&
      !e.shiftKey
    ) {
      e.preventDefault();
      copyTaskFormattedURL(
        currentTask?.title ?? "",
        currentTask?.ticketNumber!,
        currentTask?.uniqueIndex,
        currentTask?.projectId
      );
    }

    if (cmdControl && e.keyCode === KeyCodes.SEMICOLON && e.shiftKey) {
      e.preventDefault();
      copyTaskURL(currentTask?.uniqueIndex, currentTask?.projectId);
    }
  };

  const getTask = async () => {
    if (inViewObject) {
      const copied = await axios.post(`/api/tasks/getTaskMinimal`, {
        id: inViewObject.taskId,
      });

      setCurrentTask((previousTask) => ({
        ...previousTask,
        ...copied.data,
        project: copied.data.project ?? previousTask?.project,
      }));
    }
  };

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown, inViewObject, currentTask]);

  useEffect(() => {
    if (inViewObject) getTask();
  }, [inViewObject]);

  useEffect(() => {
    if (!mbl) return;

    window.history.pushState(
      { ...window.history.state, shareTaskSheet: true },
      "",
      window.location.href
    );
    mobileHistoryEntryRef.current = true;

    const handlePopState = () => {
      if (!mobileHistoryEntryRef.current) return;
      mobileHistoryEntryRef.current = false;
      closeMobileSheet(true);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeMobileSheet();
    };

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("keydown", handleEscape, true);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("keydown", handleEscape, true);
    };
  }, [closeMobileSheet, mbl]);

  if (mbl) {
    return (
      <MobileBottomSheet
        isOpen={mobileSheetOpen}
        onClose={() => closeMobileSheet()}
        onCloseEnd={closeHandler}
        ariaLabel="Share task"
        contentClassName="pb-[env(safe-area-inset-bottom)]"
      >
        <h2 className="px-4 pb-2 pt-1 text-subheading font-medium text-white-black">
          Share task
        </h2>
        <MobileShareSection
          icon={<Lock strokeWidth={1.75} size={14} />}
          title="Private (team only)"
          titlePlusUrlText={getPrivateFormattedText()}
          urlOnlyText={getPrivateURL()}
          onCopyTitlePlusUrl={() =>
            copyTaskFormattedURL(
              currentTask?.title ?? "",
              currentTask?.ticketNumber ?? "",
              currentTask?.uniqueIndex,
              currentTask?.projectId
            )
          }
          onCopyUrlOnly={() =>
            copyTaskURL(currentTask?.uniqueIndex, currentTask?.projectId)
          }
        />
        <MobileShareSection
          icon={<Globe strokeWidth={1.75} size={14} />}
          title="Public (anyone with link)"
          titlePlusUrlText={getPublicFormattedText()}
          urlOnlyText={getPublicURL()}
          onCopyTitlePlusUrl={() =>
            copySharedTaskFormattedURL(
              linkObj?.id ?? "",
              currentTask?.title ?? "",
              currentTask?.ticketNumber ?? ""
            )
          }
          onCopyUrlOnly={() => copySharedTaskURL(linkObj?.id ?? "")}
        />
      </MobileBottomSheet>
    );
  }

  return (
    <ModalContainerCustom
      id="shareTaskModal"
      isOpen={true}
      toggle={closeHandler}
      className={`paletteModalSizing sm:max-h-fit sm:top-[24%] sm:min-w-[560px] ${styles.links_modal}`}
      contentClassName="rounded-[5px] overflow-hidden"
    >
      <ModalHeaderComp shouldShowSeparator={false} header={`Share Task`} />
      <ModalBody className="p-0 rounded-b-[5px]">
        <ShareSection
          type="private"
          icon={<Lock strokeWidth={1.75} size={13} />}
          title="PRIVATE (TEAM ONLY)"
          titlePlusUrlText={getPrivateFormattedText()}
          urlOnlyText={getPrivateURL()}
          onCopyTitlePlusUrl={() =>
            copyTaskFormattedURL(
              currentTask?.title ?? "",
              currentTask?.ticketNumber!,
              currentTask?.uniqueIndex,
              currentTask?.projectId
            )
          }
          onCopyUrlOnly={() =>
            copyTaskURL(currentTask?.uniqueIndex, currentTask?.projectId)
          }
        />
        <ShareSection
          type="public"
          icon={<Globe strokeWidth={1.75} size={13} />}
          title="PUBLIC (ANYONE WITH LINK)"
          titlePlusUrlText={getPublicFormattedText()}
          urlOnlyText={getPublicURL()}
          onCopyTitlePlusUrl={() =>
            copySharedTaskFormattedURL(
              linkObj?.id ?? "",
              currentTask?.title ?? "",
              currentTask?.ticketNumber ?? ""
            )
          }
          onCopyUrlOnly={() => copySharedTaskURL(linkObj?.id ?? "")}
        />
        <div className="flex items-center gap-4 border-t border-light-black-border-1 px-4 py-2 text-micro text-text-light-gray">
          <span>
            <HintKey>{isApple ? "⌘," : "Ctrl+,"}</HintKey> copy private
          </span>
          <span>
            <HintKey>{isApple ? "⌘." : "Ctrl+."}</HintKey> copy public
          </span>
          <span>
            <HintKey>esc</HintKey> close
          </span>
        </div>
      </ModalBody>
    </ModalContainerCustom>
  );
};

const MobileShareSection = ({
  icon,
  title,
  titlePlusUrlText,
  urlOnlyText,
  onCopyTitlePlusUrl,
  onCopyUrlOnly,
}: {
  icon: React.ReactNode;
  title: string;
  titlePlusUrlText: string;
  urlOnlyText: string;
  onCopyTitlePlusUrl: () => Promise<boolean>;
  onCopyUrlOnly: () => Promise<boolean>;
}) => (
  <section className="pb-2">
    <h3 className="flex items-center gap-2 px-4 pb-1 pt-2 text-micro font-semibold uppercase tracking-wider text-text-light-gray">
      {icon}
      <span>{title}</span>
    </h3>
    <MobileShareRow
      label="Title + URL"
      value={titlePlusUrlText}
      onCopy={onCopyTitlePlusUrl}
    />
    <MobileShareRow label="URL only" value={urlOnlyText} onCopy={onCopyUrlOnly} />
  </section>
);

type CopyFeedback = "idle" | "copied" | "error";

const MobileShareRow = ({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => Promise<boolean>;
}) => {
  const [feedback, setFeedback] = useState<CopyFeedback>("idle");
  const resetTimerRef = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    },
    []
  );

  const handleCopy = () => {
    // Start the clipboard operation immediately so the browser still sees the
    // tap as an active user gesture. Feedback updates happen after this call.
    const copyOperation = onCopy();

    void copyOperation
      .then((copied) => {
        setFeedback(copied ? "copied" : "error");
      })
      .catch(() => {
        setFeedback("error");
      })
      .finally(() => {
        if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = window.setTimeout(
          () => setFeedback("idle"),
          2000
        );
      });
  };

  const feedbackContent =
    feedback === "copied" ? (
      <>
        <Check size={14} strokeWidth={1.75} aria-hidden />
        <span>Copied</span>
      </>
    ) : feedback === "error" ? (
      <>
        <X size={14} strokeWidth={1.75} aria-hidden />
        <span>Error</span>
      </>
    ) : (
      <>
        <Copy size={14} strokeWidth={1.75} aria-hidden />
        <span>Copy</span>
      </>
    );

  return (
    <div className="flex min-h-[64px] items-center gap-3 px-4 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-content text-white-black">{label}</p>
        <p className="truncate text-meta text-text-light-gray">{value}</p>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="flex min-w-[76px] items-center justify-center gap-1.5 rounded-[5px] bg-active-modal-element px-3 py-2 text-dense text-white-black transition-colors duration-150 hover:bg-hoverCardBackground"
        aria-live="polite"
      >
        {feedbackContent}
      </button>
    </div>
  );
};

const ShareSection = ({
  icon,
  title,
  titlePlusUrlText,
  urlOnlyText,
  onCopyTitlePlusUrl,
  onCopyUrlOnly,
}: {
  type: "private" | "public";
  icon: React.ReactNode;
  title: string;
  titlePlusUrlText: string;
  urlOnlyText: string;
  onCopyTitlePlusUrl: () => void;
  onCopyUrlOnly: () => void;
}) => {
  return (
    <div className="border-t border-light-black-border-1 px-4 py-3.5">
      <div className="flex items-center gap-2 pb-2.5 text-micro font-semibold uppercase tracking-wider text-text-light-gray">
        {icon}
        <span>{title}</span>
      </div>
      <div className="flex flex-col gap-2">
        <ShareRow
          label="Title + URL"
          value={titlePlusUrlText}
          onCopy={onCopyTitlePlusUrl}
        />
        <ShareRow label="URL only" value={urlOnlyText} onCopy={onCopyUrlOnly} />
      </div>
    </div>
  );
};

const ShareRow = ({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    onCopy();
    setCopied(true);
  };
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="flex items-center gap-3 w-full">
      <span className="w-[76px] shrink-0 text-content text-text-light-gray">
        {label}
      </span>
      <input
        type="text"
        readOnly
        value={value}
        className="min-w-0 flex-1 cursor-default truncate rounded bg-comment-description px-3 py-2 text-content text-white-black"
      />
      <button
        type="button"
        onClick={handleCopy}
        className="flex shrink-0 items-center gap-1.5 rounded bg-active-modal-element px-3 py-2 text-content text-white-black transition duration-150 ease-in-out hover:bg-hoverCardBackground"
      >
        {copied ? (
          <Check size={13} strokeWidth={2} className="keep-stroke" />
        ) : (
          <Copy size={13} strokeWidth={1.75} />
        )}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
};

export default ShareTaskModal;
