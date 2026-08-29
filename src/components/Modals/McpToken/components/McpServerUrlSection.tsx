"use client"

import React, { useState } from "react"
import { Check, Copy } from "lucide-react";
import { MCP_SERVER_URL } from "../utils"
import toast from "react-hot-toast"

export function McpServerUrlSection() {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(MCP_SERVER_URL)
    setCopied(true)
    toast.success("URL copied to clipboard!")
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mb-4">
      <label className="block text-content font-medium text-white-black mb-1">
        MCP Server URL
      </label>
      <p className="text-meta text-text-light-gray mb-2">
        Use this to connect from any MCP client
      </p>
      <div className="flex items-center gap-2 bg-taskDetal-container rounded border-thin border-border-light-gray-thin p-2">
        <input
          type="text"
          readOnly
          value={MCP_SERVER_URL}
          className="flex-1 min-w-0 bg-transparent text-meta font-mono text-white-black border-none outline-none"
        />
        <button
          type="button"
          onClick={handleCopy}
          className="flex-shrink-0 p-1.5 hover:bg-hover-active rounded transition-colors"
          title="Copy"
        >
          {copied ? (
            <Check strokeWidth={1.75} className="text-green-500" size={14} />
          ) : (
            <Copy strokeWidth={1.75} className="text-text-light-gray hover:text-white-black" size={14} />
          )}
        </button>
      </div>
    </div>
  )
}
