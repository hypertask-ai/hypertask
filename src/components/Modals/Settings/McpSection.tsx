"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import ConfirmDialog from "@/components/Modals/Common Modals/ConfirmDialog";
import type { Connection } from "@/components/Modals/McpToken/types";
import {
  MCP_DOCS_URL,
  MCP_INTEGRATIONS,
  MCP_SERVER_URL,
  MCP_TOOLS,
  getConfigForIntegration,
  type IntegrationId,
} from "@/components/Modals/McpToken/utils";
import McpTokenControls, { useSettingsMcpToken } from "./McpTokenControls";
import ConnectYourAiSection from "./ConnectYourAiSection";
import SettingsCard from "./SettingsCard";
import SettingsCodeRow from "./SettingsCodeRow";
import SettingsSectionShell from "./SettingsSectionShell";

const McpSection = () => {
  const [selectedIntegration, setSelectedIntegration] =
    useState<IntegrationId>("claude-code");
  const [useBearer, setUseBearer] = useState(false);
  const [clientToRemove, setClientToRemove] = useState<Connection | null>(null);
  const tokenState = useSettingsMcpToken();
  const integration = MCP_INTEGRATIONS.find(
    (candidate) => candidate.id === selectedIntegration
  );
  const config = getConfigForIntegration(
    selectedIntegration,
    useBearer,
    tokenState.token
  );
  const removeClient = async () => {
    if (!clientToRemove) return;
    const removed = await tokenState.handleRemove(clientToRemove.client_id);
    if (removed) setClientToRemove(null);
  };

  return (
    <SettingsSectionShell title="MCP">
      <ConnectYourAiSection />

      <SettingsCard title="Token">
        <p className="px-2 text-dense font-medium leading-relaxed text-text-light-gray">
          Connect AI assistants to Hypertask with a bearer token. Renewing or
          revoking it disconnects clients using the previous token.
        </p>
        <McpTokenControls
          expiresAt={tokenState.expiresAt}
          isGenerating={tokenState.isGenerating}
          isLoading={tokenState.isLoading}
          onGenerate={tokenState.generateToken}
          onRevoke={tokenState.revokeToken}
          token={tokenState.token}
        />
      </SettingsCard>

      <SettingsCard title="Server">
        <p className="px-2 text-dense font-medium text-text-light-gray">
          Use this URL from any MCP client.
        </p>
        <SettingsCodeRow value={MCP_SERVER_URL} />
      </SettingsCard>

      <SettingsCard title="Connect">
        <div className="flex flex-wrap gap-2 px-2">
          {MCP_INTEGRATIONS.map((candidate) => (
            <button
              className={`rounded-[5px] px-2 py-2 text-dense font-semibold text-white-black hover:bg-hover-active focus-visible:outline-none ${
                selectedIntegration === candidate.id
                  ? "bg-hover-active"
                  : "bg-cardBackground"
              }`}
              key={candidate.id}
              onClick={() => setSelectedIntegration(candidate.id)}
              type="button"
            >
              {candidate.label}
            </button>
          ))}
        </div>
        {integration && (
          <div className="flex flex-col gap-2 px-2">
            <p className="text-dense font-semibold text-white-black">
              Connect with {integration.label}
            </p>
            <p className="text-dense font-medium text-text-light-gray">
              {useBearer ? integration.bearerHint : integration.hint}
            </p>
            <SettingsCodeRow value={config} />
            <button
              className="w-fit rounded-[5px] px-2 py-1 text-dense font-semibold text-white-black hover:bg-hover-active focus-visible:outline-none"
              onClick={() => setUseBearer((previous) => !previous)}
              type="button"
            >
              {useBearer ? "Use client command" : "Use bearer token"}
            </button>
          </div>
        )}
      </SettingsCard>

      <SettingsCard title="Available Tools">
        <div className="flex flex-col gap-1">
          {MCP_TOOLS.map((tool) => (
            <div
              className="flex items-start justify-between gap-4 rounded-[5px] px-2 py-2 hover:bg-hover-active"
              key={tool.name}
            >
              <span className="text-dense font-semibold text-white-black">
                {tool.name}
              </span>
              <span className="text-right text-dense font-medium text-text-light-gray">
                {tool.description}
              </span>
            </div>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="Connected Clients">
        {tokenState.isLoadingConnections ? (
          <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
            Loading connected clients
          </p>
        ) : tokenState.connections.length ? (
          <div className="flex flex-col gap-1">
            {tokenState.connections.map((connection) => (
              <div
                className="flex items-center justify-between gap-3 rounded-[5px] px-2 py-2 hover:bg-hover-active"
                key={connection.client_id}
              >
                <div className="min-w-0">
                  <p className="truncate text-dense font-semibold text-white-black">
                    {connection.client_name || "Unnamed AI tool"}
                  </p>
                  <p className="text-dense font-medium text-text-light-gray">
                    Connected {new Date(connection.lastAuthorized).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="rounded-[5px] px-2 py-1 text-dense font-semibold text-white-black hover:bg-hover-active focus-visible:outline-none disabled:text-text-light-gray"
                    disabled={
                      tokenState.revokingClientId === connection.client_id
                    }
                    onClick={() => tokenState.handleRevoke(connection.client_id)}
                    type="button"
                  >
                    {tokenState.revokingClientId === connection.client_id
                      ? "Disconnecting"
                      : "Disconnect"}
                  </button>
                  {connection.is_owner && (
                    <button
                      className="rounded-sm px-2 py-1 text-dense font-semibold text-white-black hover:bg-hover-active focus-visible:outline-none disabled:text-text-light-gray"
                      disabled={
                        tokenState.removingClientId === connection.client_id
                      }
                      onClick={() => setClientToRemove(connection)}
                      type="button"
                    >
                      {tokenState.removingClientId === connection.client_id
                        ? "Removing"
                        : "Remove"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
            No connected clients
          </p>
        )}
        <a
          className="w-fit rounded-[5px] px-2 py-1 text-dense font-semibold text-white-black hover:bg-hover-active"
          href={MCP_DOCS_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          Read the MCP docs
        </a>
      </SettingsCard>

      {clientToRemove && (
        <ConfirmDialog
          confirmLabel="Remove client"
          footerVerb="remove"
          icon={Trash2}
          id="confirm-remove-oauth-client"
          loading={
            tokenState.removingClientId === clientToRemove.client_id
          }
          loadingLabel="Removing client"
          message={`Remove ${clientToRemove.client_name || "this client"}? It disconnects now and must register again before it can reconnect.`}
          onCancel={() => setClientToRemove(null)}
          onConfirm={() => void removeClient()}
        />
      )}
    </SettingsSectionShell>
  );
};

export default McpSection;
