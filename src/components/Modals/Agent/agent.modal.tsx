"use client";

import React, { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import UserAvatar from "@/components/Common/UserAvatar";
import {
  ModalContainerCustom,
  ModalFooterComp,
  ModalHeaderComp,
} from "@/components/Common/CommonModalComponents";
import { ModalBody } from "reactstrap";
import toast from "react-hot-toast";
import { Trash2 } from "lucide-react";
import { base64ToFile } from "@/utils/api/Task Detail";
import {
  convertFileToBase64,
  cropToCircle,
} from "@/utils/helperFunctions/helperFunctions";
import type { IAgent } from "@/models/model";
import { useAgents } from "@/hooks/MultiPages/useAgents";
import { useRecoilValue } from "@/lib/state";
import { agentToEditAtom } from "@/store";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import GuestSignupOverlay from "@/components/Common/GuestLock/GuestSignupOverlay";
import { isGuestCookieUser } from "@/lib/demo/isGuestClient";
import SettingsToggle from "@/components/Modals/Settings/SettingsToggle";
import { hasCustomAvatar } from "@/lib/avatar";

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_PROMPT_CHARS = 8000;

const AGENT_PRESETS = [
  {
    id: "board-coordinator",
    label: "Board Coordinator",
    prompt:
      'You triage this board. Every hour, check Inbox and Triage for new tickets. Label anything ready to build as "ready". Ask a clarifying question in a comment if a ticket has no description. Flag tickets that have sat in In Progress for 5+ days without activity.',
  },
] as const;

export type AgentModalEditAgent = Pick<
  IAgent,
  "id" | "displayName" | "photoURL" | "postsToImportant" | "runtimeType" | "prompt"
>;

interface AgentModalProps {
  closeHandler: (newAgent?: IAgent) => void;
}

const AgentModal: React.FC<AgentModalProps> = ({ closeHandler }) => {
  const agent = useRecoilValue(agentToEditAtom);
  const { createAgent, updateAgent } = useAgents();
  const isEditMode = Boolean(agent?.id);

  const [displayName, setDisplayName] = useState("");
  /** Uploaded S3 URL; null means use the initials fallback. */
  const [customPhotoURL, setCustomPhotoURL] = useState<string | null>(null);
  const [postsToImportant, setPostsToImportant] = useState(true);
  /** Only meaningful in create mode; a native agent's runtime never changes after creation. */
  const [runtimeType, setRuntimeType] = useState<"EXTERNAL" | "NATIVE">(
    "EXTERNAL",
  );
  const [presetId, setPresetId] = useState<string>(AGENT_PRESETS[0].id);
  const [prompt, setPrompt] = useState<string>(AGENT_PRESETS[0].prompt);
  /** Blob URL while cropping/uploading for instant preview. */
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!agent?.id) {
      setDisplayName("");
      setCustomPhotoURL(null);
      setPostsToImportant(true);
      setRuntimeType("EXTERNAL");
      setPresetId(AGENT_PRESETS[0].id);
      setPrompt(AGENT_PRESETS[0].prompt);
      return;
    }
    setDisplayName(agent.displayName ?? "");
    setPostsToImportant(agent.postsToImportant !== false);
    setCustomPhotoURL(hasCustomAvatar(agent.photoURL) ? agent.photoURL : null);
    setRuntimeType(agent.runtimeType === "NATIVE" ? "NATIVE" : "EXTERNAL");
    setPrompt(agent.prompt ?? "");
  }, [
    agent?.id,
    agent?.displayName,
    agent?.photoURL,
    agent?.postsToImportant,
    agent?.runtimeType,
    agent?.prompt,
  ]);

  const isNative = isEditMode ? agent?.runtimeType === "NATIVE" : runtimeType === "NATIVE";

  const applyPreset = (id: string) => {
    setPresetId(id);
    const preset = AGENT_PRESETS.find((p) => p.id === id);
    if (preset) setPrompt(preset.prompt);
  };

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  const isUploading = objectUrl !== null;
  const previewSrc = objectUrl ?? customPhotoURL;
  const hasCustomPhoto = !!(customPhotoURL || objectUrl);

  const handleUploadClick = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.[0]) return;
    const file = files[0];
    event.target.value = "";

    if (file.size > MAX_PHOTO_BYTES) {
      toast.error("Image must be 2MB or smaller");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose a PNG or JPG image");
      return;
    }

    await toast.promise(
      (async () => {
        const circularImageBlob = await cropToCircle(file);
        const circularImageFile = new File(
          [circularImageBlob],
          "profileImage.png",
          { type: "image/png" },
        );
        const ou = URL.createObjectURL(circularImageFile);
        setObjectUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return ou;
        });

        const base64String = await convertFileToBase64(circularImageFile);
        const newUrl = await base64ToFile(
          base64String as string,
          "profileImage.png",
        );

        setCustomPhotoURL(newUrl);
        setObjectUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
      })().catch((err) => {
        setObjectUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
        throw err;
      }),
      {
        loading: "Uploading image…",
        success: "Image uploaded",
        error: "Failed to upload image",
      },
    );
  };

  const handleRemove = () => {
    setCustomPhotoURL(null);
    setObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  const submit = useCallback(async () => {
    if (isGuestCookieUser()) return;

    const name = displayName.trim();
    if (!name) {
      toast.error("Display name is required");
      return;
    }
    if (!isEditMode && runtimeType === "NATIVE" && !prompt.trim()) {
      toast.error("Add instructions for this agent");
      return;
    }
    setSaving(true);
    try {
      if (isEditMode && agent?.id) {
        await updateAgent.mutateAsync({
          id: agent.id,
          displayName: name,
          photoURL: customPhotoURL,
          postsToImportant,
          ...(isNative ? { prompt: prompt.trim() || null } : {}),
        });
        toast.success("Agent updated");
        closeHandler();
      } else {
        const newAgent = await createAgent.mutateAsync({
          displayName: name,
          photoURL: customPhotoURL ?? undefined,
          runtimeType,
          ...(runtimeType === "NATIVE" ? { prompt: prompt.trim() } : {}),
        });
        toast.success("Agent created");
        closeHandler(newAgent);
      }
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : isEditMode
            ? "Failed to update agent"
            : "Failed to create agent",
      );
    } finally {
      setSaving(false);
    }
  }, [
    displayName,
    customPhotoURL,
    postsToImportant,
    runtimeType,
    prompt,
    isNative,
    isEditMode,
    agent,
    updateAgent,
    createAgent,
    closeHandler,
  ]);

  async function handleKeyDown(e: KeyboardEvent) {
    if (e.keyCode === KeyCodes.ENTER) {
      submit();
    }
    if (e.keyCode === KeyCodes.ESCAPE) {
      closeHandler();
    }
  }

  useEffect(() => {

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [submit, closeHandler]);
  
  return (
    <ModalContainerCustom
      fade={false}
      show
      isOpen
      id={isEditMode ? "agentEditModal" : "agentCreateModal"}
      toggle={closeHandler}
      shouldCloseOnClickOutside
      className="sm:min-w-[440px] sm:max-w-[500px]"
    >
      <GuestSignupOverlay onSignup={() => closeHandler()}>
        <ModalHeaderComp header={isEditMode ? "Edit agent" : "Create an Agent"} />
        <ModalBody className="p-0">
          <section className="px-5 py-5">
            <div className="flex items-center gap-4">
              <UserAvatar
                alt="Agent photo preview"
                fallbackClassName="bg-active-elementBg text-emphasis"
                name={displayName || "Agent"}
                photoURL={previewSrc}
                size={72}
              />

              <div className="min-w-0 flex-1">
                <div className="text-emphasis font-medium text-white-black">
                  Profile photo
                </div>
                <p className="mt-0.5 text-meta text-text-light-gray">
                  Optional · PNG, JPG up to 2MB
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleUploadClick}
                    disabled={saving}
                    className="btn btn-secondary btn-sm rounded-[4px]"
                  >
                    Upload
                  </button>
                  <button
                    type="button"
                    onClick={handleRemove}
                    disabled={saving || !hasCustomPhoto}
                    className="btn btn-secondary btn-sm inline-flex items-center gap-1.5 rounded-[4px]"
                  >
                    <Trash2
                      strokeWidth={1.75}
                      className="h-3.5 w-3.5 opacity-80"
                      aria-hidden
                    />
                    Remove
                  </button>
                </div>
              </div>
            </div>
            <input
              id="agent-photo-upload"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/*"
              type="file"
              onChange={handleFileUpload}
              className="hidden"
              ref={fileInputRef}
            />
          </section>

          <section className="border-t border-light-black-border-1 px-5 py-5">
            <label
              className="mb-1 block text-meta font-medium text-text-light-gray"
              htmlFor="agent-display-name"
            >
              Display name
            </label>
            <input
              id="agent-display-name"
              className="w-full border-0 border-b border-light-black-border-1 bg-transparent px-0 py-2 text-content text-white-black outline-none placeholder:text-text-light-gray/80 focus:outline-none"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Research bot"
              maxLength={200}
              autoFocus
            />
          </section>

          {!isEditMode && (
            <section className="border-t border-light-black-border-1 px-5 py-5">
              <h3 className="mb-3 text-meta font-semibold uppercase tracking-wide text-text-light-gray">
                Runs
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRuntimeType("EXTERNAL")}
                  className={`rounded-[4px] border px-3 py-2.5 text-left transition-colors ${
                    runtimeType === "EXTERNAL"
                      ? "border-hypertasks-purple bg-active-modal-element"
                      : "border-light-black-border-1 hover:bg-hover-active"
                  }`}
                >
                  <div className="text-content font-medium text-white-black">
                    External
                  </div>
                  <div className="mt-0.5 text-meta text-text-light-gray">
                    Bring your own runtime (MCP token)
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setRuntimeType("NATIVE")}
                  className={`rounded-[4px] border px-3 py-2.5 text-left transition-colors ${
                    runtimeType === "NATIVE"
                      ? "border-hypertasks-purple bg-active-modal-element"
                      : "border-light-black-border-1 hover:bg-hover-active"
                  }`}
                >
                  <div className="text-content font-medium text-white-black">
                    Native
                  </div>
                  <div className="mt-0.5 text-meta text-text-light-gray">
                    Runs on Hypertask
                  </div>
                </button>
              </div>
            </section>
          )}

          {isNative && (
            <section className="border-t border-light-black-border-1 px-5 py-5">
              {!isEditMode && (
                <>
                  <label
                    className="mb-1 block text-meta font-medium text-text-light-gray"
                    htmlFor="agent-preset"
                  >
                    Preset
                  </label>
                  <select
                    id="agent-preset"
                    className="mb-3 w-full rounded-[4px] border border-light-black-border-1 bg-transparent px-2.5 py-2 text-content text-white-black outline-none"
                    value={presetId}
                    onChange={(e) => applyPreset(e.target.value)}
                  >
                    {AGENT_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <label
                className="mb-1 block text-meta font-medium text-text-light-gray"
                htmlFor="agent-instructions"
              >
                Instructions
              </label>
              <textarea
                id="agent-instructions"
                className="w-full resize-none rounded-[4px] border border-light-black-border-1 bg-transparent px-2.5 py-2 text-content text-white-black outline-none placeholder:text-text-light-gray/80"
                rows={4}
                maxLength={MAX_PROMPT_CHARS}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="What should this agent do, and when?"
              />
              <p className="mt-3 text-meta text-text-light-gray">
                Uses your team AI budget
              </p>
            </section>
          )}

          {isEditMode && (
            <section className="border-t border-light-black-border-1 px-5 py-5">
              <h3 className="mb-3 text-meta font-semibold uppercase tracking-wide text-text-light-gray">
                Inbox routing
              </h3>
              <SettingsToggle
                checked={postsToImportant}
                description="Off: everything this agent authors (comments, mentions, updates) stays in the Agents split. Mentions of you included."
                disabled={saving}
                inputId="agent-posts-to-important"
                label="Can post to Important"
                onChange={() => setPostsToImportant((current) => !current)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  setPostsToImportant((current) => !current);
                }}
              />
            </section>
          )}
        </ModalBody>
        <ModalFooterComp className="justify-end gap-2 border-t border-light-black-border-1">
          <button
            type="button"
            className="btn btn-sm rounded-[4px] bg-transparent text-text-light-gray hover:bg-hover-active hover:text-white-black"
            onClick={() => closeHandler()}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm rounded-[4px]"
            onClick={submit}
            disabled={saving || isUploading}
          >
            {saving
              ? "Saving…"
              : isUploading
                ? "Uploading…"
                : isEditMode
                  ? "Save"
                  : "Create"}
          </button>
        </ModalFooterComp>
      </GuestSignupOverlay>
    </ModalContainerCustom>
  );
};

export default AgentModal;
