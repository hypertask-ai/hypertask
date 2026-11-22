"use client";

import { useState } from "react";
import ConfirmDialog from "@/components/Modals/Common Modals/ConfirmDialog";
import { useMcpConnections } from "@/components/Modals/McpToken/hooks/useMcpConnections";
import { useMcpToken } from "@/components/Modals/McpToken/hooks/useMcpToken";
import { isUsableMcpBearerToken } from "@/lib/mcp/bearerAuth";
import { cn } from "@/utils/undoActions/helperFuncs";
import toast from "react-hot-toast";

export const useSettingsMcpToken = () => {
  const tokenState = useMcpToken();
  const connectionState = useMcpConnections();

  const revokeToken = () =>
    connectionState.revokePageMcpToken(tokenState.clearToken);

  return { ...tokenState, ...connectionState, revokeToken };
};

const McpTokenControls = ({
  expiresAt,
  isGenerating,
  isLoading,
  isRevoking,
  onGenerate,
  revokeConfirmMessage,
  revokeToken,
  token,
}: {
  expiresAt: string | null;
  isGenerating: boolean;
  isLoading: boolean;
  isRevoking: boolean;
  onGenerate: () => void;
  revokeConfirmMessage?: string;
  revokeToken: () => Promise<boolean | void>;
  token: string | null;
}) => {
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const isActive = Boolean(token) && !isLoading;
  const confirmMcpTokenRevoke = async () => {
    const revoked = await revokeToken();
    if (revoked) setConfirmRevoke(false);
  };
  const copyToken = async () => {
    if (!isUsableMcpBearerToken(token)) {
      toast.error("Renew the token before copying it");
      return;
    }

    await navigator.clipboard.writeText(token);
    toast.success("Token copied to clipboard");
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 px-2 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              isActive ? "bg-hypertasks-green" : "bg-hover-active"
            )}
          />
          <div className="min-w-0">
            <p className="text-dense font-semibold text-white-black">
              {isLoading || isGenerating
                ? "Loading token"
                : isActive
                  ? "Token active"
                  : "Token inactive"}
            </p>
            {isActive && expiresAt && (
              <p className="text-dense font-medium text-text-light-gray">
                Expires {new Date(expiresAt).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isActive && (
            <>
              <TokenAction onClick={copyToken}>Copy</TokenAction>
              <TokenAction
                disabled={isRevoking}
                onClick={() => setConfirmRevoke(true)}
              >
                {isRevoking ? "Revoking" : "Revoke"}
              </TokenAction>
            </>
          )}
          <TokenAction
            disabled={isLoading || isGenerating}
            onClick={onGenerate}
          >
            {isGenerating ? "Generating" : isActive ? "Renew" : "Generate"}
          </TokenAction>
        </div>
      </div>

      {confirmRevoke && (
        <ConfirmDialog
          confirmLabel="Revoke token"
          footerVerb="revoke"
          id="confirm-revoke-mcp-page-token"
          loading={isRevoking}
          loadingLabel="Revoking token"
          message={
            revokeConfirmMessage ??
            "Revoke this bearer token? MCP clients using it stop working until you generate a new one."
          }
          onCancel={() => setConfirmRevoke(false)}
          onConfirm={() => void confirmMcpTokenRevoke()}
        />
      )}
    </div>
  );
};

const TokenAction = ({
  children,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) => (
  <button
    className="rounded-[5px] px-2 py-1 text-dense font-semibold text-white-black hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none disabled:cursor-not-allowed disabled:text-text-light-gray"
    disabled={disabled}
    onClick={onClick}
    type="button"
  >
    {children}
  </button>
);

export default McpTokenControls;
