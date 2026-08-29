"use client"

import React from "react"

interface DisconnectAllSectionProps {
  isRevoking: boolean
  onRevokeAll: () => void
}

export function DisconnectAllSection({
  isRevoking,
  onRevokeAll,
}: DisconnectAllSectionProps) {
  return (
    <div className="mt-2 pt-3.5 border-t border-[#2F343C]">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h3 className="text-content font-medium text-white-black mb-1">
            Disconnect all clients
          </h3>
          <p className="text-meta text-text-light-gray">
            Revoke your bearer token to disconnect all MCP clients. You&apos;ll
            need to generate a new token to reconnect.
          </p>
        </div>
        <button
          type="button"
          onClick={onRevokeAll}
          disabled={isRevoking}
          className="px-4 py-2 bg-[#EF4444] hover:bg-[#DC2626] text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-4 text-content"
        >
          {isRevoking ? "Disconnecting..." : "Disconnect all"}
        </button>
      </div>
    </div>
  )
}
