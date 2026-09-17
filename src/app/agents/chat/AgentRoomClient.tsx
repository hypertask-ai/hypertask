/* eslint-disable @next/next/no-img-element */
"use client";

import type { Editor } from "@tiptap/react";
import { ArrowLeft, Hash, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import toast from "react-hot-toast";
import { AI_Tiptap_Container } from "@/components/AI_CHAT/AI_Tiptap_Container";
import AgentAvatar from "@/components/Agents/AgentAvatar";
import { TypingIndicator } from "@/components/AI_CHAT/TypingIndicator";
import { markdownToHtml } from "@/utils/helperFunctions/markdownToHtml";
import { wrapTablesInMessageHtml } from "@/utils/helperFunctions/messageHtmlLinks";
import formatDateDifference from "@/utils/generateTime";
import { cn } from "@/utils/undoActions/helperFuncs";
import { appendTitleDictation } from "@/components/Modals/CreateTaskGloballyModal/titleDictation";

const ROOM_POLL_MS = 4_000;

type RoomAgent = {
  id: string;
  displayName: string;
  photoURL: string | null;
};

type RoomSummary = {
  id: string | null;
  projectId: number;
  name: string;
  agents: RoomAgent[];
};

type RoomMessage = {
  id: string;
  role: "human" | "assistant" | "system";
  content: string;
  createdAt: string;
  stoppedAt: string | null;
  author: {
    type: "user" | "agent";
    id: string;
    displayName: string;
    photoURL: string | null;
  } | null;
  task: { id: number; ticketNumber: string | null; title: string } | null;
};

type RoomDetails = {
  room: { id: string; projectId: number; name: string };
  agents: RoomAgent[];
  messages: RoomMessage[];
  budget: { used: number; limit: number };
  pending: Array<{
    messageId: string;
    agent: { id: string; displayName: string };
  }>;
};

function RoomMessageBubble({ message }: { message: RoomMessage }) {
  if (message.role === "system") {
    return (
      <p className="text-center text-meta text-text-light-gray">
        {message.content}
      </p>
    );
  }
  const human = message.role === "human";
  return (
    <div className={cn("flex gap-2", human && "flex-row-reverse")}>
      {message.author?.type === "agent" ? (
        <AgentAvatar
          agentId={message.author.id}
          name={message.author.displayName}
          photoURL={message.author.photoURL}
          size={28}
          className="shrink-0 text-[10px]"
        />
      ) : message.author?.photoURL ? (
        <img
          src={message.author.photoURL}
          alt=""
          className="h-7 w-7 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-hoverCardBackground text-micro">
          {message.author?.displayName.slice(0, 1).toUpperCase() ?? "?"}
        </span>
      )}
      <div className={cn("flex max-w-[80%] flex-col", human && "items-end")}>
        <div className="mb-1 flex items-center gap-2 text-micro text-text-light-gray">
          <span>{message.author?.displayName ?? "Room"}</span>
          {message.task?.ticketNumber && (
            <span className="font-medium text-hypertasks-purple">
              {message.task.ticketNumber}
            </span>
          )}
        </div>
        {human ? (
          <div className="rounded-[4px] bg-shadcn-primary px-3 py-2 text-dense text-primary-foreground whitespace-pre-wrap break-words">
            {message.content}
          </div>
        ) : (
          <div
            className="rounded-[4px] bg-cardBackground px-3 py-2 text-dense break-words [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_code]:rounded-[3px] [&_code]:bg-hoverCardBackground [&_code]:px-1"
            dangerouslySetInnerHTML={{
              __html: wrapTablesInMessageHtml(markdownToHtml(message.content)),
            }}
          />
        )}
        <time
          dateTime={message.createdAt}
          title={new Date(message.createdAt).toLocaleString()}
          className="mt-0.5 text-[10px] text-text-light-gray"
        >
          {formatDateDifference(new Date(message.createdAt))}
        </time>
      </div>
    </div>
  );
}

export default function AgentRoomClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedProjectId = Number(searchParams?.get("board"));
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    Number.isSafeInteger(requestedProjectId) && requestedProjectId > 0
      ? requestedProjectId
      : null,
  );
  const [details, setDetails] = useState<RoomDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isDictationProcessing, setIsDictationProcessing] = useState(false);
  const [sending, setSending] = useState(false);
  const [stoppingMessageId, setStoppingMessageId] = useState<string | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const composerEditorRef = useRef<Editor | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const selectedSummary = useMemo(
    () => rooms?.find((room) => room.projectId === selectedProjectId) ?? null,
    [rooms, selectedProjectId],
  );

  const loadRooms = useCallback(async () => {
    const response = await fetch("/api/agent-rooms", { cache: "no-store" });
    const body = (await response.json()) as {
      success?: boolean;
      rooms?: RoomSummary[];
      error?: string;
    };
    if (!response.ok || !body.success || !body.rooms) {
      throw new Error(body.error ?? "Failed to load board rooms");
    }
    setRooms(body.rooms);
    setSelectedProjectId((current) => current ?? body.rooms?.[0]?.projectId ?? null);
  }, []);

  const ensureRoom = useCallback(async (summary: RoomSummary) => {
    if (summary.id) return summary.id;
    const response = await fetch("/api/agent-rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: summary.projectId }),
    });
    const body = (await response.json()) as {
      success?: boolean;
      room?: { id: string };
      error?: string;
    };
    if (!response.ok || !body.success || !body.room) {
      throw new Error(body.error ?? "Failed to open board room");
    }
    setRooms((current) =>
      current?.map((room) =>
        room.projectId === summary.projectId
          ? { ...room, id: body.room!.id }
          : room,
      ) ?? null,
    );
    return body.room.id;
  }, []);

  const loadDetails = useCallback(async (roomId: string) => {
    const response = await fetch(`/api/agent-rooms/${roomId}`, {
      cache: "no-store",
    });
    const body = (await response.json()) as RoomDetails & {
      success?: boolean;
      error?: string;
    };
    if (!response.ok || !body.success) {
      throw new Error(body.error ?? "Failed to load board room");
    }
    setDetails(body);
    setError(null);
  }, []);

  useEffect(() => {
    loadRooms()
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "Failed to load rooms"),
      )
      .finally(() => setLoading(false));
  }, [loadRooms]);

  useEffect(() => {
    if (!selectedSummary) {
      setDetails(null);
      return;
    }
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    setLoading(true);
    ensureRoom(selectedSummary)
      .then(async (roomId) => {
        if (cancelled) return;
        await loadDetails(roomId);
        if (!cancelled) {
          interval = setInterval(() => void loadDetails(roomId), ROOM_POLL_MS);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(
            reason instanceof Error ? reason.message : "Failed to open room",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [ensureRoom, loadDetails, selectedSummary]);

  useEffect(() => {
    messageListRef.current?.scrollTo({
      top: messageListRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [details?.messages.length]);

  const selectRoom = (projectId: number) => {
    setSelectedProjectId(projectId);
    setDetails(null);
    router.replace(`/agents/chat?view=rooms&board=${projectId}`);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || !details || sending) return;
    setSending(true);
    setDraft("");
    try {
      const response = await fetch(
        `/api/agent-rooms/${details.room.id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        },
      );
      const body = (await response.json()) as {
        success?: boolean;
        error?: string;
      };
      if (!response.ok || !body.success) {
        throw new Error(body.error ?? "Failed to send message");
      }
      await loadDetails(details.room.id);
    } catch (reason) {
      setDraft(text);
      toast.error(reason instanceof Error ? reason.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const stop = async (messageId: string) => {
    if (!details || stoppingMessageId) return;
    setStoppingMessageId(messageId);
    try {
      const response = await fetch(
        `/api/agent-rooms/${details.room.id}/messages/${messageId}/stop`,
        { method: "POST" },
      );
      const body = (await response.json()) as {
        success?: boolean;
        error?: string;
      };
      if (!response.ok || !body.success) {
        throw new Error(body.error ?? "Failed to stop turn");
      }
      await loadDetails(details.room.id);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Failed to stop turn");
    } finally {
      setStoppingMessageId(null);
    }
  };

  const insertDictation = useCallback((transcript: string) => {
    const editor = composerEditorRef.current;
    if (editor) {
      const prefix = editor.getText().trim() ? " " : "";
      editor.chain().focus("end").insertContent(prefix + transcript).run();
      return;
    }
    setDraft((current) => appendTitleDictation(current, transcript));
    composerRef.current?.focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex h-[100dvh] min-h-0 bg-modalBackground text-white-black">
      <aside
        className={cn(
          "w-[300px] shrink-0 border-r border-comment-description-border",
          selectedProjectId && "hidden md:flex",
          "flex-col",
        )}
      >
        <div className="border-b border-comment-description-border px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-[16px] font-semibold">Board rooms</h1>
            <button
              type="button"
              onClick={() => router.push("/agents/chat")}
              className="text-meta text-hypertasks-purple hover:underline"
            >
              Direct chats
            </button>
          </div>
          <p className="mt-1 text-meta text-text-light-gray">
            One shared transcript for every bot on a board.
          </p>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
          {rooms?.map((room) => (
            <button
              key={room.projectId}
              type="button"
              onClick={() => selectRoom(room.projectId)}
              className={cn(
                "rounded-[4px] px-3 py-2 text-left hover:bg-hoverCardBackground",
                room.projectId === selectedProjectId && "bg-hoverCardBackground",
              )}
            >
              <span className="flex items-center gap-2 text-dense font-medium">
                <Hash size={14} />
                <span className="truncate">{room.name}</span>
              </span>
              <span className="mt-1 block truncate text-meta text-text-light-gray">
                {room.agents.length} bot{room.agents.length === 1 ? "" : "s"}
              </span>
            </button>
          ))}
          {!loading && rooms?.length === 0 && (
            <p className="px-2 py-3 text-meta text-text-light-gray">
              No board rooms available.
            </p>
          )}
        </div>
      </aside>

      {selectedProjectId ? (
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="shrink-0 border-b border-comment-description-border px-4 py-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedProjectId(null);
                  router.replace("/agents/chat?view=rooms");
                }}
                aria-label="Back to board rooms"
                className="md:hidden"
              >
                <ArrowLeft size={16} />
              </button>
              <Hash size={16} className="text-text-light-gray" />
              <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                {details?.room.name ?? selectedSummary?.name ?? "Board room"}
              </h2>
              {details && (
                <span className="text-meta text-text-light-gray">
                  {details.budget.used}/{details.budget.limit} turns today
                </span>
              )}
            </div>
            <div className="mt-2 flex items-center gap-2 overflow-x-auto">
              <Users size={13} className="shrink-0 text-text-light-gray" />
              {(details?.agents ?? selectedSummary?.agents ?? []).map((agent) => (
                <span
                  key={agent.id}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-cardBackground px-2 py-1 text-micro"
                >
                  <AgentAvatar
                    agentId={agent.id}
                    name={agent.displayName}
                    photoURL={agent.photoURL}
                    size={18}
                    className="text-[8px]"
                  />
                  {agent.displayName}
                </span>
              ))}
            </div>
          </header>

          <div
            ref={messageListRef}
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
          >
            {error && <p className="text-meta text-red-500">{error}</p>}
            {loading && !details && (
              <p className="text-meta text-text-light-gray">Loading room…</p>
            )}
            {details?.messages.length === 0 && (
              <p className="m-auto max-w-[340px] text-center text-dense text-text-light-gray">
                Message Product Bot to start. Product Bot can call in another bot by name.
              </p>
            )}
            {details?.messages.map((message) => (
              <RoomMessageBubble key={message.id} message={message} />
            ))}
            {details?.pending.map((pending) => (
              <div
                key={`${pending.messageId}-${pending.agent.id}`}
                className="flex items-center gap-2 text-meta text-text-light-gray"
                role="status"
              >
                <TypingIndicator />
                <span>{pending.agent.displayName} is working</span>
                <button
                  type="button"
                  onClick={() => void stop(pending.messageId)}
                  disabled={stoppingMessageId !== null}
                  className="font-medium hover:text-white-black disabled:opacity-50"
                >
                  {stoppingMessageId === pending.messageId ? "Stopping…" : "Stop"}
                </button>
              </div>
            ))}
          </div>

          {details && (
            <div className="shrink-0 border-t border-comment-description-border">
              <AI_Tiptap_Container
                controlledComposer={{
                  value: draft,
                  inputRef: composerRef,
                  editorRef: composerEditorRef,
                  useTiptapEditor: true,
                  onChange: (value) => setDraft(value),
                  onKeyDown: handleKeyDown,
                  placeholder: "Message Product Bot and the room",
                  ariaLabel: "Message board agent room",
                  isRecording,
                  isProcessing: isDictationProcessing,
                  onRecordingChange: setIsRecording,
                  onProcessingChange: setIsDictationProcessing,
                  onDictation: insertDictation,
                  dictationDisabled: sending,
                  projectId: details.room.projectId,
                  sendDisabled:
                    !draft.trim() ||
                    sending ||
                    isRecording ||
                    isDictationProcessing,
                  queueMode: false,
                  onSend: () => void send(),
                }}
              />
            </div>
          )}
        </main>
      ) : (
        <div className="hidden flex-1 items-center justify-center text-dense text-text-light-gray md:flex">
          Choose a board room.
        </div>
      )}
    </div>
  );
}
