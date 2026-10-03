"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";

import {
  createPageRoute,
  listPagesRoute,
} from "@/lib/constants/APIRouteConstants";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { createPageReturnHref } from "@/lib/navigation/pageReturn";

export type TaskPage = {
  publicId: string;
  id: number;
  title: string;
  parentPageId: number | null;
  updatedAt: string | null;
};

type CreatePageResult = {
  page: {
    publicId: string;
  };
};

type PagesState = {
  taskId: number | null;
  pages: TaskPage[];
  loading: boolean;
};

type TaskPagesContextValue = {
  pages: TaskPage[];
  loading: boolean;
  hasPages: boolean;
  createAndOpenPage: () => Promise<void>;
  refetch: () => void;
};

const TaskPagesContext = createContext<TaskPagesContextValue | undefined>(
  undefined
);

export const TaskPagesProvider = ({ children }: PropsWithChildren) => {
  const { currentTask } = useTaskContext();
  const router = useRouter();
  const taskId = currentTask?.id;
  const taskProjectId = currentTask?.projectId;
  const taskUniqueIndex = currentTask?.uniqueIndex;
  const [pagesState, setPagesState] = useState<PagesState>({
    taskId: null,
    pages: [],
    loading: false,
  });
  const [fetchVersion, setFetchVersion] = useState(0);
  const isCreatingRef = useRef(false);

  useEffect(() => {
    if (!taskId) {
      setPagesState({ taskId: null, pages: [], loading: false });
      return;
    }

    const controller = new AbortController();
    setPagesState({ taskId, pages: [], loading: true });

    const fetchPages = async () => {
      try {
        const response = await fetch(`${listPagesRoute}?task_id=${taskId}`, {
          signal: controller.signal,
        });
        const result = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(result?.error ?? "Unable to load pages");
        }

        setPagesState({
          taskId,
          pages: Array.isArray(result?.pages) ? result.pages : [],
          loading: false,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("[Task pages] Error:", error);
        setPagesState({ taskId, pages: [], loading: false });
      }
    };

    fetchPages();

    return () => controller.abort();
  }, [fetchVersion, taskId]);

  const createAndOpenPage = useCallback(async () => {
    if (!taskId || isCreatingRef.current) return;

    isCreatingRef.current = true;

    try {
      const result = await toast.promise(
        (async () => {
          const response = await fetch(createPageRoute, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              task_id: taskId,
              title: "Untitled",
              content: "",
              content_type: "html",
            }),
          });
          const responseBody = await response.json().catch(() => null);

          if (!response.ok || !responseBody?.page?.publicId) {
            throw new Error(responseBody?.error ?? "Unable to create page");
          }

          return responseBody as CreatePageResult;
        })(),
        {
          loading: "Creating page",
          success: "Page created",
          error: (error) => error?.message ?? "Error creating page",
        }
      );

      const plainPageHref = `/page/${result.page.publicId}`;
      if (taskProjectId && taskUniqueIndex) {
        const taskHref = `/detail/project-${taskProjectId}/${taskUniqueIndex}`;
        router.push(
          createPageReturnHref({
            pageHref: plainPageHref,
            taskHref,
            sourceHref: window.location.href,
            currentOrigin: window.location.origin,
            storage: window.sessionStorage,
            runtime: window,
            nonce: window.crypto.randomUUID(),
          })
        );
      } else {
        router.push(plainPageHref);
      }
    } catch (error) {
      console.error("[Create task page] Error:", error);
    } finally {
      isCreatingRef.current = false;
    }
  }, [router, taskId, taskProjectId, taskUniqueIndex]);

  const refetch = useCallback(() => {
    setFetchVersion((version) => version + 1);
  }, []);

  const isCurrentTask = pagesState.taskId === (taskId ?? null);
  const pages = isCurrentTask ? pagesState.pages : [];
  const loading = Boolean(taskId) && (!isCurrentTask || pagesState.loading);

  return (
    <TaskPagesContext.Provider
      value={{
        pages,
        loading,
        hasPages: pages.length > 0,
        createAndOpenPage,
        refetch,
      }}
    >
      {children}
    </TaskPagesContext.Provider>
  );
};

export const useTaskPages = () => {
  const context = useContext(TaskPagesContext);

  if (!context) {
    throw new Error("useTaskPages must be used within a TaskPagesProvider");
  }

  return context;
};
