"use client";

import { useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { cn } from "@/utils/undoActions/helperFuncs";
import Image from "next/image";

export default function OAuthSuccessPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const redirectUri = searchParams?.get("redirect_uri");
  const oauthCode = searchParams?.get("code");

  const [isRedirecting, setIsRedirecting] = useState(false);
  const [bindLoading, setBindLoading] = useState(false);
  const [bindError, setBindError] = useState<string | null>(null);

  const handleReturnToClient = useCallback(() => {
    if (!redirectUri || isRedirecting) return;
    setIsRedirecting(true);
    setTimeout(() => {
      window.location.href = redirectUri;
    }, 100);
  }, [redirectUri, isRedirecting]);

  const authorizeAndReturn = useCallback(async () => {
    if (!oauthCode || !redirectUri) return;
    setBindLoading(true);
    setBindError(null);
    try {
      const res = await fetch("/api/oauth/authorization-code/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: oauthCode,
          agentId: null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setBindError(data.error || "Failed to authorize");
        return;
      }
      setIsRedirecting(true);
      setTimeout(() => {
        window.location.href = redirectUri;
      }, 100);
    } catch {
      setBindError("Failed to authorize");
    } finally {
      setBindLoading(false);
    }
  }, [oauthCode, redirectUri]);

  const handleContinueToApp = () => {
    router.push("/");
  };

  const handleCancel = () => {
    router.push("/");
  };

  const primaryDisabled = isRedirecting || bindLoading;

  return (
    <div
      className={cn(
        "min-h-[100svh] w-full flex items-center justify-center",
        "bg-[#0a0012] text-white",
        "p-8"
      )}
    >
      <div className="w-full max-w-md flex flex-col items-center text-center">
        <Image
          src="/loginLogoMain.png"
          alt="Hypertask logo"
          className="object-contain mb-3"
          width={48}
          height={48}
        />

        <div className="flex flex-row items-center justify-center gap-3 mb-2">
          <h1 className="text-heading font-semibold text-white text-left">
            {"You're almost there"}
          </h1>
        </div>
        <p className="text-gray-400 text-content mb-6">
          {redirectUri
            ? "Your MCP client will now be able to access this account."
            : "Return to your MCP client to finish setup, or stay in Hypertask."}
        </p>

        {redirectUri ? (
          <>
            {bindError && (
              <p className="text-red-400 text-meta mb-3">{bindError}</p>
            )}

            {isRedirecting ? (
              <>
                <div className="mb-6">
                  <p className="text-gray-400 text-content mb-4">
                    Returning to your client…
                  </p>
                  <div className="flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-[#6C47FF] border-t-transparent rounded-full animate-spin" />
                  </div>
                </div>
                <button
                  onClick={handleContinueToApp}
                  className={cn(
                    "w-full py-3 px-6",
                    "bg-[#6C47FF] hover:bg-[#5a3ed6]",
                    "text-white font-medium rounded-lg",
                    "transition-colors"
                  )}
                >
                  Return to Hypertask
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={oauthCode ? authorizeAndReturn : handleReturnToClient}
                  disabled={primaryDisabled}
                  className={cn(
                    "w-full py-3 px-6 mb-3",
                    "bg-[#6C47FF] hover:bg-[#5a3ed6]",
                    "text-white font-medium rounded-lg",
                    "transition-colors",
                    primaryDisabled && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {bindLoading
                    ? "Authorizing…"
                    : oauthCode
                    ? "Authorize & return to client"
                    : "Return to client"}
                </button>

                <button
                  onClick={handleCancel}
                  disabled={isRedirecting}
                  className={cn(
                    "w-full py-3 px-6",
                    "bg-transparent border border-gray-600 hover:border-gray-500",
                    "text-gray-400 hover:text-white font-medium rounded-lg",
                    "transition-colors",
                    isRedirecting && "opacity-50 cursor-not-allowed"
                  )}
                >
                  Cancel
                </button>
              </>
            )}
          </>
        ) : (
          <button
            onClick={handleContinueToApp}
            className={cn(
              "w-full max-w-[288px] py-3 px-6",
              "bg-[#6C47FF] hover:bg-[#5a3ed6]",
              "text-white font-medium rounded-lg",
              "transition-colors"
            )}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
