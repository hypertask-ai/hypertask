import {
  ModalContainerCustom,
  ModalHeaderComp,
} from "@/components/Common/CommonModalComponents";
import ConfirmDialog from "@/components/Modals/Common Modals/ConfirmDialog";
import {
  taskDescriptionRestoreRoute,
  taskDescriptionVersionsRoute,
} from "@/lib/constants/APIRouteConstants";
import axios from "axios";
import { History, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

type DescriptionVersion = {
  id: number;
  version: number;
  contentText: string;
  createdAt: string;
  actor: { displayName: string; type: "agent" | "user" };
};

type VersionResponse = {
  current: { contentText: string };
  hasMore: boolean;
  versions: DescriptionVersion[];
};

type Props = {
  taskId: number;
  onClose: () => void;
  onRestored?: () => void;
};

const DescriptionPreview = ({ content }: { content: string }) => (
  <div className="min-h-[112px] whitespace-pre-wrap break-words rounded-sm bg-label-span px-3 py-2.5 text-dense text-white-black">
    {content.trim() || <span className="text-text-light-gray">Empty description</span>}
  </div>
);

const TaskDescriptionHistoryModal = ({ taskId, onClose, onRestored }: Props) => {
  const [data, setData] = useState<VersionResponse | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setSelectedId(null);
    setLoading(true);
    const loadVersions = async () => {
      try {
        const { data: response } = await axios.get<VersionResponse>(
          taskDescriptionVersionsRoute(String(taskId)),
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setData(response);
        setSelectedId(response.versions[0]?.id ?? null);
      } catch (error: unknown) {
        if (!axios.isCancel(error)) toast.error("Unable to load description versions");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void loadVersions();
    return () => controller.abort();
  }, [taskId]);

  const selected = useMemo(
    () => data?.versions.find((version) => version.id === selectedId) ?? null,
    [data?.versions, selectedId],
  );
  const restoreSelected = async () => {
    if (!selected || restoring) return;
    setRestoring(true);
    try {
      await axios.post(
        taskDescriptionRestoreRoute(String(taskId)),
        { version_id: selected.id },
      );
      onRestored?.();
      toast.success(`Restored description version ${selected.version}`);
      onClose();
    } catch (error: unknown) {
      const message = axios.isAxiosError<{ error?: string }>(error)
        ? error.response?.data?.error
        : undefined;
      toast.error(message ?? "Unable to restore description");
    } finally {
      setRestoring(false);
      setConfirmRestore(false);
    }
  };

  return (
    <ModalContainerCustom
      isOpen
      show
      id="task-description-history-modal"
      toggle={onClose}
      className="sm:min-w-[760px] sm:top-[96px]"
      contentClassName="overflow-hidden rounded-[5px]"
    >
      <div className="min-h-[420px] bg-modalBackground">
        <ModalHeaderComp header="Description version history" shouldShowSeparator>
          <button
            type="button"
            aria-label="Close description version history"
            onClick={onClose}
            className="rounded-sm p-1 text-text-light-gray hover:bg-active-modal-element hover:text-white-black"
          >
            <X size={16} />
          </button>
        </ModalHeaderComp>
        <div className="grid min-h-[372px] grid-cols-[240px_1fr]">
          <div className="border-r border-light-black-border-1 p-2">
            <div className="flex items-center gap-2 px-2 py-2 text-micro font-medium text-text-light-gray">
              <History size={13} /> Earlier versions
            </div>
            {loading ? (
              <p className="px-2 py-3 text-dense text-text-light-gray">Loading versions...</p>
            ) : data?.versions.length ? (
              <ul className="m-0 list-none space-y-1 p-0">
                {data.versions.map((version) => (
                  <li key={version.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(version.id)}
                      aria-pressed={selectedId === version.id}
                      className={`w-full rounded-sm px-3 py-2 text-left text-dense ${
                        selectedId === version.id
                          ? "bg-active-modal-element"
                          : "hover:bg-active-modal-element"
                      }`}
                    >
                      <span className="block font-medium">Version {version.version}</span>
                      <span className="block truncate text-micro text-text-light-gray">
                        {version.actor.displayName} · {new Date(version.createdAt).toLocaleString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-2 py-3 text-dense text-text-light-gray">No earlier versions yet.</p>
            )}
            {data?.hasMore && (
              <p className="px-2 py-2 text-micro text-text-light-gray">
                Showing the 100 most recent versions.
              </p>
            )}
          </div>
          <div className="space-y-4 p-4">
            <section>
              <h3 className="mb-2 text-dense font-medium text-text-light-gray">Current description</h3>
              <DescriptionPreview content={data?.current.contentText ?? ""} />
            </section>
            {selected && (
              <section>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="m-0 text-dense font-medium text-text-light-gray">
                    Version {selected.version}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setConfirmRestore(true)}
                    className="flex items-center gap-2 rounded-sm bg-active-modal-element px-3 py-1.5 text-dense text-white-black hover:bg-label-span"
                  >
                    <RotateCcw size={13} /> Restore this version
                  </button>
                </div>
                <DescriptionPreview content={selected.contentText} />
              </section>
            )}
          </div>
        </div>
      </div>
      {confirmRestore && selected && (
        <ConfirmDialog
          id="confirm-description-restore"
          icon={RotateCcw}
          message={`Restore description version ${selected.version}?`}
          confirmLabel="Restore version"
          loadingLabel="Restoring..."
          loading={restoring}
          onConfirm={() => void restoreSelected()}
          onCancel={() => setConfirmRestore(false)}
        />
      )}
    </ModalContainerCustom>
  );
};

export default TaskDescriptionHistoryModal;
