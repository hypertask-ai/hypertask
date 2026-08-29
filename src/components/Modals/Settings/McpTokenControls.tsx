"use client";

import { useMcpConnections } from "@/components/Modals/McpToken/hooks/useMcpConnections";
import { useMcpToken } from "@/components/Modals/McpToken/hooks/useMcpToken";
import { cn } from "@/utils/undoActions/helperFuncs";
import toast from "react-hot-toast";

export const useSettingsMcpToken = () => {
  const tokenState = useMcpToken();
  const connectionState = useMcpConnections();

  const revokeToken = () => {
    connectionState.handleRevokeAll(tokenState.clearToken);
  };

  return { ...tokenState, ...connectionState, revokeToken };
};

const McpTokenControls = ({
  expiresAt,
  isGenerating,
  isLoading,
  onGenerate,
  onRevoke,
  token,
}: {
  expiresAt: string | null;
  isGenerating: boolean;
  isLoading: boolean;
  onGenerate: () => void;
  onRevoke: () => void;
  token: string | null;
}) => {
  const isActive = Boolean(token) && !isLoading;
  const copyToken = async () => {
    if (!token || token === "***") {
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
              <TokenAction onClick={onRevoke}>Revoke</TokenAction>
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
