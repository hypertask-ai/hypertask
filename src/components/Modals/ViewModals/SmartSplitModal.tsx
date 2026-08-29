import { useState } from "react";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Sparkles, Trash2, X } from "lucide-react";
import { ModalBody, ModalFooter } from "reactstrap";
import toast from "react-hot-toast";
import nookies from "nookies";

import {
  ModalContainerCustom,
  ModalHeaderComp,
} from "@/components/Common/CommonModalComponents";
import ConfirmDialog, { Kbd } from "@/components/Modals/Common Modals/ConfirmDialog";
import { projectLabelsPrefix } from "@/hooks/MultiPages/useGetAllProjectLabels";
import type { ILabel, IView } from "@/models/model";
import { currentProjectAtom } from "@/store";
import { useRecoilValue } from "@/lib/state";

type Props = {
  projectId: number;
  view?: IView;
  label?: ILabel;
  onClose: (refresh?: boolean) => void | Promise<void>;
};

const MAX_PROMPT_LENGTH = 1000;

const SmartSplitModal = ({ projectId, view, label, onClose }: Props) => {
  const queryClient = useQueryClient();
  const currentProject = useRecoilValue(currentProjectAtom);
  const editing = Boolean(view && label);
  const [name, setName] = useState(view?.title ?? "");
  const [prompt, setPrompt] = useState(label?.ai_prompt ?? "");
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const close = () => {
    if (!saving) onClose();
  };

  const refreshAndClose = async () => {
    await queryClient.refetchQueries({ queryKey: [projectLabelsPrefix, projectId] });
    await onClose(true);
  };

  const errorMessage = (error: unknown, fallback: string) =>
    axios.isAxiosError(error) && typeof error.response?.data?.message === "string"
      ? error.response.data.message
      : fallback;

  const updateActiveViewUrl = (slug?: string | null) => {
    const activeViewId = currentProject?.project_view?.user_project_views[0]?.appliedView?.id;
    if (!view || activeViewId !== view.id) return;
    nookies.destroy(null, "previousBoard", { path: "/" });
    if (slug) {
      nookies.set(null, "previousBoard", `project-${projectId}|&|${slug}`, {
        maxAge: 600 * 60 * 24 * 7,
        path: "/",
      });
    }
    window.history.replaceState(
      {},
      "",
      slug ? `/project?id=${projectId}&view=${slug}` : `/project?id=${projectId}`
    );
    void queryClient.refetchQueries({ queryKey: ["projectsAllMinimal"] });
  };

  const save = async () => {
    const trimmedName = name.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedName) return toast.error("Give the smart split a name");
    if (!trimmedPrompt) return toast.error("Describe which tasks should match");
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return toast.error("Keep the prompt to 1,000 characters or fewer");
    }

    setSaving(true);
    try {
      const body = {
        projectId,
        viewId: view?.id,
        name: trimmedName,
        prompt: trimmedPrompt,
      };
      if (editing) {
        const response = await axios.patch("/api/projects/views/smart-split", body);
        updateActiveViewUrl(response.data.slug);
      } else {
        await axios.post("/api/projects/views/smart-split", body);
      }
      toast.success(editing ? "Smart split updated" : "Smart split created");
      await refreshAndClose();
    } catch (error) {
      toast.error(errorMessage(error, "Could not save the smart split"));
    } finally {
      setSaving(false);
    }
  };

  const deleteSplit = async () => {
    if (!view) return;
    setShowDeleteConfirm(false);
    setSaving(true);
    try {
      await axios.delete("/api/projects/views/smart-split", {
        data: { projectId, viewId: view.id },
      });
      updateActiveViewUrl();
      toast.success("Smart split deleted");
      await refreshAndClose();
    } catch (error) {
      toast.error(errorMessage(error, "Could not delete the smart split"));
    } finally {
      setSaving(false);
    }
  };

  const closeIcon = editing ? ArrowLeft : X;
  const CloseIcon = closeIcon;

  return (
    <ModalContainerCustom
      id={editing ? "edit-smart-split-modal" : "create-smart-split-modal"}
      isOpen
      show
      fade={false}
      keyboard={!saving}
      toggle={close}
      className="paletteModalSizing sm:min-w-[560px] sm:top-[24%]"
    >
      <ModalHeaderComp header={editing ? "Edit smart split" : "Add smart split"}>
        <CloseIcon
          size={18}
          strokeWidth={1.75}
          aria-label={editing ? "Back to views" : "Close"}
          className="close cursor-pointer text-text-light-gray transition-colors hover:text-white-black"
          onClick={close}
        />
      </ModalHeaderComp>
      <ModalBody className="bg-modalBackground p-0 text-dense">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="grid border-b border-light-black-border-1 px-6 py-3">
            <span className="text-micro font-semibold uppercase tracking-wider text-text-light-gray">
              Name
            </span>
            <input
              autoFocus
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              data-form-type="other"
              value={name}
              disabled={saving}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name this split"
              className="mt-2 h-[32px] bg-transparent text-content font-normal text-white-black outline-none placeholder:text-text-light-gray disabled:opacity-50"
            />
          </label>
          <label className="grid px-6 py-3">
            <span className="flex items-center gap-2 text-micro font-semibold uppercase tracking-wider text-text-light-gray">
              <Sparkles
                size={13}
                strokeWidth={1.75}
                className="text-hypertasks-ai-purple"
                aria-hidden
              />
              Matching prompt
            </span>
            <textarea
              value={prompt}
              disabled={saving}
              maxLength={MAX_PROMPT_LENGTH + 1}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void save();
                }
              }}
              placeholder="Describe which tasks belong in this split"
              className="mt-2 min-h-[96px] w-full resize-y bg-transparent text-content font-normal text-white-black outline-none placeholder:text-text-light-gray disabled:opacity-50"
            />
            <span className="mt-2 flex items-center justify-between text-micro text-text-light-gray">
              <span>AI keeps the split updated as tasks change.</span>
              <span className={prompt.length > MAX_PROMPT_LENGTH ? "text-red-400" : undefined}>
                {prompt.length}/{MAX_PROMPT_LENGTH}
              </span>
            </span>
          </label>
        </form>

        {showDeleteConfirm && view && (
          <ConfirmDialog
            id="confirm-delete-smart-split"
            icon={Trash2}
            message={<>Delete <strong>{view.title}</strong>? Its hidden smart tag is also removed.</>}
            confirmLabel="Delete smart split"
            loading={saving}
            onConfirm={() => void deleteSplit()}
            onCancel={() => setShowDeleteConfirm(false)}
          />
        )}
      </ModalBody>
      <ModalFooter className="flex items-center justify-between border-t border-light-black-border-1 bg-modalBackground px-4 py-2">
        {editing ? (
          <button
            type="button"
            disabled={saving}
            className="border-0 bg-transparent p-0 text-dense text-red-400 transition-colors hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => setShowDeleteConfirm(true)}
          >
            Delete smart split
          </button>
        ) : <span />}
        <button
          type="button"
          disabled={saving || !name.trim() || !prompt.trim() || prompt.length > MAX_PROMPT_LENGTH}
          onClick={() => void save()}
          className="inline-flex h-[30px] items-center gap-2 rounded-sm border-0 bg-label-span px-3 text-dense font-medium text-white-black transition-colors hover:bg-hover-active disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>{saving ? "Saving…" : editing ? "Save" : "Create"}</span>
          <Kbd>CTRL+ENTER</Kbd>
        </button>
      </ModalFooter>
    </ModalContainerCustom>
  );
};

export default SmartSplitModal;
