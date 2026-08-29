"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IUser } from "@/models/model";
import { currentUserAtom } from "@/store";
import { useRecoilState } from "@/lib/state";
import { useProfilePicture } from "@/hooks/General/useProfilePicture";
import { useSignout } from "@/hooks/MultiPages/HTC/useSignout";
import SettingsCard from "./SettingsCard";
import { settingsActionButtonClass } from "./SettingsBillingRow";
import SettingsSectionShell from "./SettingsSectionShell";
import UserAvatar from "@/components/Common/UserAvatar";

const GeneralSection = () => {
  const [currentUserValue] = useRecoilState(currentUserAtom);
  const currentUser = currentUserValue as IUser | null;
  const {
    defaultImage,
    displayName,
    handleFileUpload,
    removeProfilePicture,
    updateDisplayName,
    uploadedFile,
  } = useProfilePicture(currentUser);
  const { handleHardReset } = useSignout();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState(displayName);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const uploadedImageUrl = useMemo(
    () => (uploadedFile ? URL.createObjectURL(uploadedFile) : undefined),
    [uploadedFile]
  );
  const visibleName = displayName || currentUser?.email || "User";
  const profileImageUrl =
    uploadedImageUrl ?? defaultImage ?? currentUser?.photoURL;

  useEffect(() => {
    setDisplayNameDraft(displayName);
  }, [displayName]);

  useEffect(
    () => () => {
      if (uploadedImageUrl) URL.revokeObjectURL(uploadedImageUrl);
    },
    [uploadedImageUrl]
  );

  const saveDisplayName = async () => {
    const nextDisplayName = displayNameDraft.trim();

    if (nextDisplayName === displayName) {
      setDisplayNameDraft(displayName);
      return;
    }

    try {
      await updateDisplayName(nextDisplayName);
    } catch {
      setDisplayNameDraft(displayName);
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    setDeleteError(null);

    try {
      const response = await fetch("/api/users/delete-account", {
        method: "POST",
      });

      if (!response.ok) throw new Error("Request failed");
    } catch {
      setDeleting(false);
      setDeleteError("Could not delete your account. Please try again.");
      return;
    }

    // handleHardReset clears local state/cookies and sends the browser to /login.
    await handleHardReset();
  };

  return (
    <SettingsSectionShell title="General">
      <SettingsCard title="Profile">
        <div className="flex flex-col items-start gap-3 rounded-[5px] px-2 py-2 hover:bg-hover-active sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <UserAvatar
              alt="Profile picture"
              fallbackClassName="text-dense"
              name={visibleName}
              photoURL={profileImageUrl}
              size={44}
              title={visibleName}
            />
            <div className="min-w-0">
              <p className="text-dense font-semibold text-white-black">
                Profile picture
              </p>
              <p className="truncate text-meta font-medium text-text-light-gray">
                Shown with your work across Hypertask
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
            <button
              className={settingsActionButtonClass}
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              Change
            </button>
            <button
              className={settingsActionButtonClass}
              onClick={() => void removeProfilePicture()}
              type="button"
            >
              Remove
            </button>
          </div>
          <input
            ref={fileInputRef}
            accept="image/*"
            className="hidden"
            id="upload-profile-input"
            onChange={handleFileUpload}
            type="file"
          />
        </div>

        <div className="flex items-center justify-between gap-4 border-b border-light-black-border-1 px-2 py-2">
          <label
            className="shrink-0 text-dense font-semibold text-white-black"
            htmlFor="settings-display-name"
          >
            Display name
          </label>
          <input
            id="settings-display-name"
            className="h-8 min-w-0 flex-1 rounded-[5px] border-0 bg-transparent px-2 text-right text-dense font-medium text-white-black outline-none placeholder:text-text-light-gray focus:bg-active-modal-element"
            onBlur={() => void saveDisplayName()}
            onChange={(event) => setDisplayNameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            placeholder="Display name"
            type="text"
            value={displayNameDraft}
          />
        </div>

        {currentUser?.email && (
          <div className="flex items-center justify-between gap-4 rounded-[5px] px-2 py-2">
            <span className="shrink-0 text-dense font-semibold text-white-black">
              Email
            </span>
            <span className="min-w-0 truncate text-right text-dense font-medium text-text-light-gray">
              {currentUser.email}
            </span>
          </div>
        )}
      </SettingsCard>

      <SettingsCard title="Danger zone">
        <div className="flex flex-col items-start gap-3 rounded-[5px] px-2 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-dense font-semibold text-white-black">
              Delete account
            </p>
            <p className="text-meta font-medium text-text-light-gray">
              Wipes your boards and data. Your email can sign up again from
              scratch.
            </p>
          </div>
          {!confirmDelete && (
            <button
              className={`${settingsActionButtonClass} shrink-0 !text-red-400`}
              onClick={() => setConfirmDelete(true)}
              type="button"
            >
              Delete account
            </button>
          )}
        </div>

        {confirmDelete && (
          <div className="flex flex-col gap-3 px-2 text-dense text-white-black">
            {deleting ? (
              <p className="font-medium text-text-light-gray">
                Deleting your account. Please wait.
              </p>
            ) : (
              <>
                <p className="font-medium text-text-light-gray">
                  This cannot be undone. Everything you own is wiped.
                </p>
                <div className="flex gap-2">
                  <button
                    className={settingsActionButtonClass}
                    onClick={() => {
                      setConfirmDelete(false);
                      setDeleteError(null);
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className={`${settingsActionButtonClass} !text-red-400`}
                    onClick={() => void deleteAccount()}
                    type="button"
                  >
                    Delete account
                  </button>
                </div>
              </>
            )}
            {deleteError && (
              <p className="font-medium text-red-400" role="alert">
                {deleteError}
              </p>
            )}
          </div>
        )}
      </SettingsCard>
    </SettingsSectionShell>
  );
};

export default GeneralSection;
