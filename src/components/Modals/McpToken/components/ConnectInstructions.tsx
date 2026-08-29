"use client"

import React, { useState } from "react"
import { Check, Copy } from "lucide-react";
import {
  MCP_INTEGRATIONS,
  getConfigForIntegration,
  type IntegrationId,
} from "../utils"
import { IntegrationIcon } from "./IntegrationIcons"
import toast from "react-hot-toast"

interface ConnectInstructionsProps {
  integrationId: IntegrationId
  token: string | null
  useBearer: boolean
  onUseBearerClick: () => void
}

interface CopyableCodeBlockProps {
  value: string
  copyValue?: string
  errorMessage?: string
  successMessage?: string
  iconSize?: number
}

export function CopyableCodeBlock({
  value,
  copyValue,
  errorMessage,
  successMessage = "Copied to clipboard!",
  iconSize = 16,
}: CopyableCodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (errorMessage) {
      toast.error(errorMessage)
      return
    }

    await navigator.clipboard.writeText(copyValue ?? value)
    setCopied(true)
    toast.success(successMessage)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex items-center justify-between gap-2 bg-taskDetal-container rounded-lg p-2 border-thin border-border-light-gray-thin">
      <code className="flex-1 min-w-0 text-meta font-mono text-text-light-gray break-all whitespace-pre-wrap">
        {value}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        className="flex-shrink-0 p-1.5 hover:bg-hover-active rounded transition-colors"
        title="Copy"
      >
        {copied ? (
          <Check strokeWidth={1.75} className="text-green-500" size={iconSize} />
        ) : (
          <Copy strokeWidth={1.75} className="text-text-light-gray hover:text-white-black" size={iconSize} />
        )}
      </button>
    </div>
  )
}

export function ConnectInstructions({
  integrationId,
  token,
  useBearer,
  onUseBearerClick,
}: ConnectInstructionsProps) {
  const integration = MCP_INTEGRATIONS.find((i) => i.id === integrationId)

  if (!integration) return null

  const config = getConfigForIntegration(integrationId, useBearer, token)
  const hint = useBearer ? integration.bearerHint : integration.hint
  const tokenError =
    config === "Please generate a token first"
      ? "Please generate a token first"
      : undefined

  return (
    <div className="mt-3 pt-3">
      <div className="bg-cardBackground rounded p-4 border-thin border-border-light-gray-thin">
        <h4 className="text-content font-medium text-white-black mb-2 flex items-center gap-2">
          <IntegrationIcon id={integrationId} size={24} className="flex-shrink-0" />
          Connect with {integration.label}
        </h4>
        <p className="text-meta text-text-light-gray mb-2">{hint}</p>
        <CopyableCodeBlock value={config} errorMessage={tokenError} />
        {!useBearer && (
          <p className="text-meta text-text-light-gray mt-2">
            Or use a{" "}
            <button
              type="button"
              onClick={onUseBearerClick}
              className="text-[#3B82F6] hover:underline font-medium"
            >
              bearer token
            </button>{" "}
            for manual authentication.
          </p>
        )}
        {useBearer && (
          <p className="text-meta text-text-light-gray mt-2">
            <button
              type="button"
              onClick={onUseBearerClick}
              className="text-[#3B82F6] hover:underline font-medium"
            >
              Use command instead
            </button>
          </p>
        )}
      </div>
    </div>
  )
}
