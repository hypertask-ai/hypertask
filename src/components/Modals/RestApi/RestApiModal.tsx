"use client"

import React, { useCallback, useEffect, useState } from "react"
import {
  ModalContainerCustom,
  ModalFooterComp,
  ModalHeaderComp,
} from "@/components/Common/CommonModalComponents"
import { ModalBody } from "reactstrap"
import { IoCheckmark, IoCopyOutline } from "react-icons/io5"
import toast from "react-hot-toast"
import { cn } from "@/utils/undoActions/helperFuncs"

const API_KEYS_URL = "/api/users/api-keys"
const DOCS_URL = "https://docs.hypertask.ai/api/rest-api/"
const CURL_SNIPPET =
  'curl -H "Authorization: Bearer htk_..." https://app.hypertask.ai/api/v1/tasks?project_id=...'

interface IProps {
  closeHandler: () => void
  onOpenMcp?: () => void
  onOpenCli?: () => void
}

interface ApiKeyItem {
  id: string
  name: string
  keyPrefix: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  expiresAt: string | null
}

interface ApiResponse {
  success?: boolean
  error?: string
  apiKeys?: ApiKeyItem[]
  apiKey?: ApiKeyItem & { key?: string }
}

function formatDate(value: string | null) {
  if (!value) return "Never"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Unknown"

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function CopyButton({
  value,
  successMessage = "Copied to clipboard!",
}: {
  value: string
  successMessage?: string
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success(successMessage)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Failed to copy")
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex-shrink-0 p-1.5 hover:bg-hover-active rounded transition-colors"
      title="Copy"
    >
      {copied ? (
        <IoCheckmark className="text-green-500" size={14} />
      ) : (
        <IoCopyOutline className="text-text-light-gray hover:text-white-black" size={14} />
      )}
    </button>
  )
}

function CommandRow({ command }: { command: string }) {
  return (
    <div className="flex items-center gap-2 bg-taskDetal-container rounded border-thin border-border-light-gray-thin p-2">
      <input
        type="text"
        readOnly
        value={command}
        className="flex-1 min-w-0 bg-transparent text-xs font-mono text-white-black border-none outline-none"
      />
      <CopyButton value={command} />
    </div>
  )
}

const RestApiModal: React.FC<IProps> = ({
  closeHandler,
  onOpenMcp,
  onOpenCli,
}) => {
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([])
  const [name, setName] = useState("")
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null)

  const fetchApiKeys = useCallback(async () => {
    try {
      setIsLoading(true)
      const response = await fetch(API_KEYS_URL)
      const data = (await response.json().catch(() => ({}))) as ApiResponse

      if (response.ok && data.success) {
        setApiKeys(data.apiKeys || [])
      } else {
        toast.error(data.error || "Failed to load API keys")
      }
    } catch (error) {
      console.error("Error loading API keys:", error)
      toast.error("Failed to load API keys")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchApiKeys()
  }, [fetchApiKeys])

  const handleCreate = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error("Enter a key name")
      return
    }

    try {
      setIsCreating(true)
      const response = await fetch(API_KEYS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName }),
      })
      const data = (await response.json().catch(() => ({}))) as ApiResponse

      if (response.ok && data.success && data.apiKey?.key) {
        setCreatedKey(data.apiKey.key)
        setName("")
        toast.success("API key created")
        await fetchApiKeys()
      } else {
        toast.error(data.error || "Failed to create API key")
      }
    } catch (error) {
      console.error("Error creating API key:", error)
      toast.error("Failed to create API key")
    } finally {
      setIsCreating(false)
    }
  }

  const handleRevoke = async (apiKey: ApiKeyItem) => {
    if (apiKey.revokedAt) return
    if (
      !confirm(
        `Revoke "${apiKey.name}"? Requests using this key will stop working immediately.`
      )
    ) {
      return
    }

    try {
      setRevokingKeyId(apiKey.id)
      const response = await fetch(`${API_KEYS_URL}/${apiKey.id}`, {
        method: "DELETE",
      })
      const data = (await response.json().catch(() => ({}))) as ApiResponse

      if (response.ok && data.success) {
        toast.success("API key revoked")
        await fetchApiKeys()
      } else {
        toast.error(data.error || "Failed to revoke API key")
      }
    } catch (error) {
      console.error("Error revoking API key:", error)
      toast.error("Failed to revoke API key")
    } finally {
      setRevokingKeyId(null)
    }
  }

  return (
    <ModalContainerCustom
      fade={false}
      show={true}
      isOpen={true}
      id="restApiModal"
      toggle={closeHandler}
      shouldCloseOnClickOutside={true}
      className="font-bold sm:min-w-[600px] sm:max-w-[600px] sm:w-[600px] sm:top-14 "
    >
      <ModalHeaderComp
        headerClassName="h-full"
        header="REST API"
        subHeadline="Create API keys for scripts, services, and direct HTTP integrations."
        subHeadlineClassName="text-text-light-gray block mt-1"
        className="px-[20px] h-full pb-0 text-xs"
      />
      <ModalBody className="px-4 max-h-[60vh] bg-inherit overflow-y-auto">
        <div className="mb-4">
          <label className="block text-sm font-medium text-white-black mb-1">
            Create key
          </label>
          <p className="text-xs text-text-light-gray mb-2">
            Name the key after the script or service that will use it.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleCreate()
                }
              }}
              placeholder="Production deploy script"
              maxLength={80}
              className="flex-1 min-w-0 bg-taskDetal-container text-sm text-white-black rounded border-thin border-border-light-gray-thin px-3 py-2 outline-none focus:border-[#3B82F6]"
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={isCreating || !name.trim()}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded transition-all",
                "bg-[#3B82F6] hover:bg-[#2563EB] text-white",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {isCreating ? "Creating..." : "Create"}
            </button>
          </div>
        </div>

        {createdKey && (
          <div className="mb-4 bg-cardBackground rounded p-4 border-thin border-border-light-gray-thin">
            <h3 className="text-sm font-medium text-white-black mb-1">
              Copy your new key
            </h3>
            <p className="text-xs text-text-light-gray mb-2">
              This key is shown once. Copy it now, because Hypertask will not
              show it again.
            </p>
            <div className="flex items-center gap-2 bg-taskDetal-container rounded border-thin border-border-light-gray-thin p-2">
              <input
                type="text"
                readOnly
                value={createdKey}
                className="flex-1 min-w-0 bg-transparent text-xs font-mono text-white-black border-none outline-none"
              />
              <CopyButton value={createdKey} successMessage="API key copied!" />
            </div>
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-medium text-white-black mb-1">
            API keys
          </label>
          <p className="text-xs text-text-light-gray mb-2">
            Revoke keys you no longer use.
          </p>

          {isLoading ? (
            <div className="text-center py-8 text-text-light-gray">Loading...</div>
          ) : apiKeys.length === 0 ? (
            <div className="text-center py-8 bg-cardBackground rounded border-thin border-border-light-gray-thin">
              <p className="text-sm font-medium text-white-black mb-1">
                No API keys yet
              </p>
              <p className="text-xs text-text-light-gray">
                Create a key to call the REST API.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {apiKeys.map((apiKey) => {
                const isExpired = Boolean(
                  !apiKey.revokedAt &&
                    apiKey.expiresAt &&
                    new Date(apiKey.expiresAt) <= new Date()
                )
                const isRevoked = !!apiKey.revokedAt
                return (
                  <div
                    key={apiKey.id}
                    className="flex items-center justify-between gap-3 p-3 bg-cardBackground rounded border-thin border-border-light-gray-thin"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-medium text-white-black truncate">
                          {apiKey.name}
                        </h4>
                        <span
                          className={cn(
                            "text-[11px] px-2 py-0.5 rounded-full",
                            isRevoked || isExpired
                              ? "bg-[#4F545C] text-text-light-gray"
                              : "bg-green-500/15 text-green-500"
                          )}
                        >
                          {isRevoked
                            ? "Revoked"
                            : isExpired
                            ? "Expired"
                            : "Active"}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-1 text-xs text-text-light-gray">
                        <span>
                          Prefix{" "}
                          <span className="font-mono text-white-black">
                            {apiKey.keyPrefix}
                          </span>
                        </span>
                        <span>Created {formatDate(apiKey.createdAt)}</span>
                        <span>Last used {formatDate(apiKey.lastUsedAt)}</span>
                        <span>Expires {formatDate(apiKey.expiresAt)}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRevoke(apiKey)}
                      disabled={isRevoked || revokingKeyId === apiKey.id}
                      className={cn(
                        "px-3 py-1.5 rounded text-sm transition-colors flex-shrink-0",
                        isRevoked
                          ? "bg-[#4F545C] text-text-light-gray cursor-not-allowed"
                          : "bg-[#EF4444] hover:bg-[#DC2626] text-white",
                        "disabled:opacity-50 disabled:cursor-not-allowed"
                      )}
                    >
                      {revokingKeyId === apiKey.id
                        ? "Revoking..."
                        : isRevoked
                        ? "Revoked"
                        : "Revoke"}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="pt-3.5 border-t border-border-light-gray-thin">
          <label className="block text-sm font-medium text-white-black mb-1">
            How to use
          </label>
          <p className="text-xs text-text-light-gray mb-2">
            Send your key as a bearer token.
          </p>
          <CommandRow command={CURL_SNIPPET} />
          <p className="text-xs text-text-light-gray mt-2">
            See the{" "}
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#3B82F6] hover:underline"
            >
              developer docs
            </a>{" "}
            for endpoint details.
          </p>
        </div>
      </ModalBody>
      <ModalFooterComp className="flex justify-between items-center px-4 py-3 border-t border-border-light-gray-thin">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {onOpenMcp && (
            <button
              type="button"
              onClick={onOpenMcp}
              className="text-sm text-[#3B82F6] hover:underline font-medium"
            >
              Connect AI assistants via MCP -&gt;
            </button>
          )}
          {onOpenCli && (
            <button
              type="button"
              onClick={onOpenCli}
              className="text-sm text-[#3B82F6] hover:underline font-medium"
            >
              Prefer the terminal? Install the CLI -&gt;
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={closeHandler}
          className="px-4 py-2 bg-[#5F646C] hover:bg-[#6B7280] text-white rounded-lg transition-colors text-sm font-medium"
        >
          Close
        </button>
      </ModalFooterComp>
    </ModalContainerCustom>
  )
}

export default RestApiModal
