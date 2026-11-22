"use client";

import { useState } from "react";
import ConfirmDialog from "@/components/Modals/Common Modals/ConfirmDialog";
import McpTokenControls, { useSettingsMcpToken } from "./McpTokenControls";
import SettingsCard from "./SettingsCard";
import SettingsCodeRow from "./SettingsCodeRow";
import SettingsSectionShell from "./SettingsSectionShell";

const API_BASE_URL = "https://app.hypertask.ai/api/mcp";
const CURL_EXAMPLE = `curl "${API_BASE_URL}/projects" \\
  -H "Authorization: Bearer $HYPERTASK_TOKEN"`;

const ApiSection = () => {
  const [confirmRevokeToken, setConfirmRevokeToken] = useState(false);
  const tokenState = useSettingsMcpToken();

  const confirmMcpTokenRevoke = async () => {
    const revoked = await tokenState.revokeToken();
    if (revoked) setConfirmRevokeToken(false);
  };

  return (
    <SettingsSectionShell title="REST API">
      <SettingsCard title="Authentication">
        <p className="px-2 text-dense font-medium leading-relaxed text-text-light-gray">
          The REST API uses the same bearer token as MCP. Send it in the
          Authorization header with every request.
        </p>
        <McpTokenControls
          expiresAt={tokenState.expiresAt}
          isGenerating={tokenState.isGenerating}
          isLoading={tokenState.isLoading}
          isRevoking={tokenState.isRevokingAll}
          onGenerate={tokenState.generateToken}
          onRevoke={() => setConfirmRevokeToken(true)}
          token={tokenState.token}
        />
      </SettingsCard>

      <SettingsCard title="Base URL">
        <SettingsCodeRow value={API_BASE_URL} />
      </SettingsCard>

      <SettingsCard title="Example">
        <p className="px-2 text-dense font-medium text-text-light-gray">
          List the projects available to the authenticated account.
        </p>
        <SettingsCodeRow value={CURL_EXAMPLE} />
      </SettingsCard>

      <SettingsCard title="Documentation">
        <p className="px-2 text-dense font-medium text-text-light-gray">
          Browse endpoint details, request fields, and response examples.
        </p>
        <a
          className="w-fit rounded-[5px] px-2 py-1 text-dense font-semibold text-white-black hover:bg-hover-active"
          href="https://docs.hypertask.ai/"
          rel="noopener noreferrer"
          target="_blank"
        >
          Read the API docs
        </a>
      </SettingsCard>

      {confirmRevokeToken && (
        <ConfirmDialog
          confirmLabel="Revoke token"
          footerVerb="revoke"
          id="confirm-revoke-api-mcp-token"
          loading={tokenState.isRevokingAll}
          loadingLabel="Revoking token"
          message="Revoke this bearer token? API and MCP clients using it stop working until you generate a new one."
          onCancel={() => setConfirmRevokeToken(false)}
          onConfirm={() => void confirmMcpTokenRevoke()}
        />
      )}
    </SettingsSectionShell>
  );
};

export default ApiSection;
