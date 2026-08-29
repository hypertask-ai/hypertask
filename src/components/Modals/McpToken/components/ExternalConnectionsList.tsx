"use client"

import React from "react"
import { X } from "lucide-react";
import type { Connection } from "../types"

interface ExternalConnectionsListProps {
  connections: Connection[]
  isLoading: boolean
  revokingClientId: string | null
  onRevoke: (clientId: string) => void
}

export function ExternalConnectionsList({
  connections,
  isLoading,
  revokingClientId,
  onRevoke,
}: ExternalConnectionsListProps) {
  if (isLoading) {
    return (
      <div className="text-center py-8 text-text-light-gray">Loading...</div>
    )
  }

  if (connections.length === 0) {
    return (
      <div className="text-center py-8">
        <svg
          className="w-12 h-12 mx-auto text-text-light-gray mb-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.75}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <p className="text-content font-medium text-white-black mb-1">No connected clients</p>
        <p className="text-meta text-text-light-gray">
          There are no connected clients
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {connections.map((conn) => (
        <div
          key={conn.client_id}
          className="flex items-center justify-between p-3 bg-[#2F343C] hover:bg-[#3F444C] rounded-lg transition-colors"
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 bg-[#4F545C] rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-content font-semibold text-white">
                {conn.client_name?.[0]?.toUpperCase() || "?"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-content font-medium text-white-black truncate">
                {conn.client_name || "Unnamed AI Tool"}
              </h4>
              <p className="text-meta text-text-light-gray">
                Connected {new Date(conn.lastAuthorized).toLocaleDateString()}
              </p>
              {conn.connected_via_agent ? (
                <p className="text-meta text-text-light-gray mt-0.5">
                  Via agent
                  {conn.agent_display_name ? (
                    <span className="text-white-black/80">
                      {" "}
                      · {conn.agent_display_name}
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="flex items-center gap-1 text-meta text-green-500">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Active
            </span>
            <button
              type="button"
              onClick={() => onRevoke(conn.client_id)}
              disabled={revokingClientId === conn.client_id}
              className="p-1.5 text-text-light-gray hover:text-white-black hover:bg-[#4F545C] rounded-full transition-colors disabled:opacity-50"
              title="Disconnect"
            >
              {revokingClientId === conn.client_id ? (
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <X strokeWidth={1.75} size={18} />
              )}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
