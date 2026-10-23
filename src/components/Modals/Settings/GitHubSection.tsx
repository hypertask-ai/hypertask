"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import toast from "react-hot-toast";
import OptionPickerModal from "@/components/Modals/OptionPicker";
import { useFlag } from "@/hooks/useFlag";
import { useRecoilValue } from "@/lib/state";
import { HTPR_7515_CONNECT_GITHUB_PER_BOARD_FLAG } from "@/lib/flags/definitions/htpr-7515-connect-github-per-board";
import { currentUserAtom } from "@/store";
import SettingsCard from "./SettingsCard";
import { BillingActionRow, settingsActionButtonClass } from "./SettingsBillingRow";
import SettingsSectionShell from "./SettingsSectionShell";

type ConnectedRepository = {
  repositoryId: string | null;
  fullName: string;
  provenance: "installed" | "legacy";
  installationId: string | null;
  isPrivate: boolean | null;
};

type GithubSettings = {
  projectId: number;
  version: string;
  canConnect: boolean;
  installations: {
    id: string;
    accountLogin: string;
    accountType: string;
    installedByMe: boolean;
  }[];
  connected: ConnectedRepository[];
  available: {
    repositoryId: string;
    fullName: string;
    installationId: string;
    isPrivate: boolean;
    onOtherBoard: boolean;
  }[];
  githubUnavailable: boolean;
};

const SAVE_ERRORS: Record<string, string> = {
  stale: "This board’s repositories changed. Reload them and choose again.",
  repo_on_other_board: "A selected repository is already connected to another board.",
  already_connected: "A selected repository is already connected to this board.",
  not_installer: "Only the person who installed the GitHub App can add repositories.",
  repo_not_installed: "The GitHub App no longer covers a selected repository. Reload and choose again.",
  github_unavailable: "GitHub is unavailable. Nothing changed; try again shortly.",
  board_access_denied: "Only a board GitHub admin can manage this connection.",
  not_signed_in: "Sign in again to manage this connection.",
  not_found: "GitHub connections are not available for this board.",
  invalid: "Choose no more than 50 repositories and try again.",
};

const GitHubSection = () => {
  const enabled = useFlag(HTPR_7515_CONNECT_GITHUB_PER_BOARD_FLAG);
  const searchParams = useSearchParams();
  const currentUser = useRecoilValue(currentUserAtom);
  const explicitProjectId = searchParams?.get("projectId");
  const projectId = explicitProjectId && /^[1-9][0-9]*$/.test(explicitProjectId)
    && Number.isSafeInteger(Number(explicitProjectId)) ? Number(explicitProjectId) : null;
  const queryClient = useQueryClient();
  const queryKey = ["boardGithubSettings", currentUser?.id, projectId];
  const [draft, setDraft] = useState<{ repositoryIds: string[]; version: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const settingsQuery = useQuery<GithubSettings>({
    queryKey,
    enabled: enabled && Boolean(projectId && currentUser?.id),
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/projects/${projectId}/github`, {
        cache: "no-store",
        signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(SAVE_ERRORS[body.error] ?? "Could not load this board’s GitHub connection.");
      }
      const data = await response.json() as GithubSettings;
      if (data.projectId !== projectId) throw new Error("GitHub returned a different board. Please reload.");
      return data;
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
  const settings = settingsQuery.data;
  const selectedIds = draft?.repositoryIds ?? settings?.connected
    .filter((repo) => repo.provenance === "installed" && repo.repositoryId !== null)
    .map((repo) => repo.repositoryId as string) ?? [];
  const pickerRepos = [
    ...settings?.connected.filter((repo) => repo.provenance === "installed" && repo.repositoryId !== null)
      .map((repo) => ({ ...repo, onOtherBoard: false })) ?? [],
    ...settings?.available ?? [],
  ];
  const save = async () => {
    if (!enabled || !projectId || !draft || saving || settingsQuery.isError) return;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/github`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await response.json();
      if (!response.ok) {
        setSaveError(SAVE_ERRORS[body.error] ?? "Could not save repositories. Nothing changed; try again.");
        return;
      }
      if (body.projectId !== projectId) throw new Error("Unexpected board");
      queryClient.setQueryData(queryKey, body);
      setDraft(null);
      toast.success("GitHub repositories saved");
    } catch {
      setSaveError("Could not save repositories. Reload to check the current connection before trying again.");
    } finally {
      setSaving(false);
    }
  };

  return enabled ? (
    <SettingsSectionShell
      title="Connect GitHub"
      description={projectId ? "GitHub repositories connected to the selected board." : "Open Connect GitHub from the board you want to connect."}
    >
      {projectId && (
        <SettingsCard title="GitHub App">
          {settingsQuery.isLoading && <p role="status" className="px-2 text-dense text-text-light-gray">Loading GitHub connection…</p>}
          {settingsQuery.isError && <p role="alert" className="px-2 text-dense text-text-light-gray">{settingsQuery.error.message}</p>}
          {settings && !settingsQuery.isError && (
            <>
              <BillingActionRow
                label={settings.installations.length ? "GitHub App installed" : "GitHub App not installed"}
                action={
                  <form action="/api/github/install" method="post">
                    <input type="hidden" name="projectId" value={projectId} />
                    <button type="submit" className={settingsActionButtonClass} disabled={saving || draft !== null}>
                      Install GitHub App
                    </button>
                  </form>
                }
              />
              {settings.installations.map((installation) => (
                <p key={installation.id} className="px-2 text-dense text-text-light-gray">
                  {installation.accountLogin}{installation.installedByMe ? " · Installed by you" : " · Installed by another admin"}
                </p>
              ))}
              <p className="px-2 text-dense text-text-light-gray">
                Choose which repositories belong to this board. Only the person who installed the GitHub App can add repositories; board GitHub admins can remove them.
              </p>
            </>
          )}
          {(settingsQuery.isError || saveError || settings?.githubUnavailable) && (
            <BillingActionRow label="Refresh connection" action={
              <button type="button" className={settingsActionButtonClass} disabled={saving || settingsQuery.isFetching} onClick={() => {
                setDraft(null);
                setSaveError(null);
                void settingsQuery.refetch();
              }}>Reload repositories</button>
            } />
          )}
          {searchParams?.get("github_error") && <p role="alert" className="px-2 text-dense text-text-light-gray">GitHub could not be connected. Check your GitHub permissions and try installing again.</p>}
          {searchParams?.get("github_status") === "pending" && <p role="status" className="px-2 text-dense text-text-light-gray">GitHub installation is awaiting approval. Reload after it is approved.</p>}
        </SettingsCard>
      )}
      {settings && !settingsQuery.isError && (
        <SettingsCard title="Connected repositories">
          {settings.connected.length === 0 && <p className="px-2 text-dense text-text-light-gray">No repositories connected to this board.</p>}
          {settings.connected.map((repo) => (
            <div key={repo.repositoryId ?? repo.fullName} className="flex min-w-0 items-center gap-2 px-2 py-2">
              <span className="min-w-0 break-all text-dense">{repo.fullName}</span>
              {repo.isPrivate && <span className="text-meta font-medium text-text-light-gray">Private</span>}
              {repo.provenance === "legacy" && <span className="text-meta font-medium text-text-light-gray">Legacy connection</span>}
            </div>
          ))}
          {settings.githubUnavailable && <p role="status" className="px-2 text-dense text-text-light-gray">GitHub is unavailable. You can still remove connected repositories, but cannot add any until GitHub is available.</p>}
          <BillingActionRow label="Repositories for this board" action={
            <button type="button" className={settingsActionButtonClass} disabled={saving || (!settings.canConnect && !settings.connected.some((repo) => repo.provenance === "installed"))} onClick={() => {
              if (!draft) setDraft({ repositoryIds: selectedIds, version: settings.version });
              setPickerOpen(true);
            }}>Choose repos</button>
          } />
          {draft && (
            <BillingActionRow label={`${draft.repositoryIds.length} selected · Unsaved changes`} action={
              <div className="flex items-center gap-2">
                <button type="button" className={settingsActionButtonClass} disabled={saving} onClick={() => { setDraft(null); setSaveError(null); }}>Cancel</button>
                <button type="button" className={settingsActionButtonClass} disabled={saving || settingsQuery.isFetching} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
              </div>
            } />
          )}
          {saveError && <p role="alert" className="px-2 text-dense text-text-light-gray">{saveError}</p>}
        </SettingsCard>
      )}
      {pickerOpen && settings && draft && (
        <OptionPickerModal
          header="Choose repositories"
          placeholder="Search repositories…"
          emptyMessage="No repositories available. Check the GitHub App’s repository access."
          options={pickerRepos.map((repo) => ({
            id: repo.repositoryId,
            label: repo.fullName,
            checked: selectedIds.includes(repo.repositoryId as string),
            hint: repo.onOtherBoard ? "Connected to another board" : repo.isPrivate ? "Private" : undefined,
          }))}
          onSelect={(option) => {
            const id = String(option.id);
            const repo = pickerRepos.find((candidate) => candidate.repositoryId === id);
            if (!repo || repo.onOtherBoard) {
              toast.error("This repository is connected to another board.");
              return;
            }
            const removing = selectedIds.includes(id);
            const alreadyConnected = settings.connected.some((candidate) => candidate.repositoryId === id && candidate.provenance === "installed");
            if (!removing && !alreadyConnected && (!settings.canConnect || settings.githubUnavailable)) {
              toast.error("Only the installer can add repositories while GitHub is available.");
              return;
            }
            if (!removing && selectedIds.length >= 50) {
              toast.error("Choose no more than 50 repositories.");
              return;
            }
            setDraft((current) => current ? {
              ...current,
              repositoryIds: current.repositoryIds.includes(id)
                ? current.repositoryIds.filter((selected) => selected !== id)
                : [...current.repositoryIds, id],
            } : null);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </SettingsSectionShell>
  ) : null;
};

export default GitHubSection;
