"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { MCP_SERVER_URL } from "@/components/Modals/McpToken/utils";
import SettingsCard from "./SettingsCard";
import SettingsCodeRow from "./SettingsCodeRow";
import {
  CONNECT_PROVIDER_SETUP_URLS,
  CONNECT_PROVIDER_STEPS,
  type ConnectProvider,
  getOtherChatsCopy,
} from "./connectYourAi";

const PROVIDERS: Array<{ id: ConnectProvider; label: string }> = [
  { id: "claude", label: "Claude" },
  { id: "chatgpt", label: "ChatGPT" },
];

const ConnectYourAiSection = () => {
  const [activeProvider, setActiveProvider] = useState<ConnectProvider | null>(
    null,
  );
  const [copiedProvider, setCopiedProvider] =
    useState<ConnectProvider | null>(null);
  const [copyError, setCopyError] = useState(false);

  const handleAddProvider = async (provider: ConnectProvider) => {
    setActiveProvider(provider);
    setCopiedProvider(null);
    setCopyError(false);

    // Open the provider first. A browser only honours window.open while the
    // click gesture is still on the stack, and awaiting the clipboard ends it,
    // which is why the panel used to promise a tab it never opened.
    window.open(
      CONNECT_PROVIDER_SETUP_URLS[provider],
      "_blank",
      "noopener,noreferrer",
    );

    try {
      await navigator.clipboard.writeText(MCP_SERVER_URL);
      setCopiedProvider(provider);
    } catch {
      setCopyError(true);
    }
  };

  return (
    <SettingsCard title="Connect your AI">
      <div className="flex flex-col gap-3 px-2">
        <div>
          <p className="text-emphasis font-semibold text-white-black">
            Bring Hypertask to the AI you already use
          </p>
          <p className="mt-1 text-dense font-medium text-text-light-gray">
            Connect once, then ask your AI to read and update your board.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PROVIDERS.map((provider, index) => (
            <button
              aria-expanded={activeProvider === provider.id}
              className={`flex min-h-11 items-center justify-between gap-2 rounded-[5px] px-3 py-2 text-left text-dense font-semibold transition-colors focus-visible:bg-hover-active focus-visible:outline-none ${
                index === 0
                  ? "bg-shadcn-primary text-primary-foreground hover:opacity-90"
                  : "bg-cardBackground text-white-black hover:bg-hover-active"
              }`}
              key={provider.id}
              onClick={() => void handleAddProvider(provider.id)}
              type="button"
            >
              <span>Add to {provider.label}</span>
              {copiedProvider === provider.id ? (
                <Check aria-hidden size={16} strokeWidth={1.5} />
              ) : (
                <Copy aria-hidden size={16} strokeWidth={1.5} />
              )}
            </button>
          ))}
        </div>

        {activeProvider && (
          <div className="flex flex-col gap-3 rounded-[5px] bg-cardBackground px-3 py-3">
            <p className="text-dense font-semibold text-white-black">
              Connect {activeProvider === "claude" ? "Claude" : "ChatGPT"}
            </p>
            <ol className="flex flex-col gap-2 pl-5 text-dense font-medium text-text-light-gray">
              {CONNECT_PROVIDER_STEPS[activeProvider].map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <SettingsCodeRow value={MCP_SERVER_URL} />
            {copiedProvider === activeProvider && (
              <p className="flex items-center gap-1 text-meta font-semibold text-hypertasks-green">
                <Check aria-hidden size={14} strokeWidth={1.5} />
                Link copied. Finish setup in the new {activeProvider === "claude" ? "Claude" : "ChatGPT"} tab.
              </p>
            )}
            {copyError && (
              <p className="text-meta font-medium text-text-light-gray">
                Copy did not work. Use the Copy control above instead.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 pt-2">
          <p className="text-dense font-semibold text-white-black">
            For any other chat
          </p>
          <p className="text-dense font-medium text-text-light-gray">
            Paste this sentence into your chat:
          </p>
          <SettingsCodeRow value={getOtherChatsCopy(MCP_SERVER_URL)} />
        </div>
      </div>
    </SettingsCard>
  );
};

export default ConnectYourAiSection;
