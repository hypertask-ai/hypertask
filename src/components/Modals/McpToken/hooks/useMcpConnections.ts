"use client"

import { useState, useEffect } from "react"
import toast from "react-hot-toast"
import type { Connection } from "../types"

export function useMcpConnections() {
  const [connections, setConnections] = useState<Connection[]>([])
  const [isLoadingConnections, setIsLoadingConnections] = useState(false)
  const [revokingClientId, setRevokingClientId] = useState<string | null>(null)
  const [isRevokingAll, setIsRevokingAll] = useState(false)

  const fetchConnections = async () => {
    try {
      setIsLoadingConnections(true)
      const response = await fetch("/api/connections/list")
      const data = await response.json()
      if (data.success) {
        setConnections(data.connections)
      }
    } catch (error) {
      console.error("Error fetching connections:", error)
    } finally {
      setIsLoadingConnections(false)
    }
  }

  useEffect(() => {
    fetchConnections()
  }, [])

  const handleRevoke = async (clientId: string) => {
    if (
      !confirm(
        "Are you sure you want to disconnect this AI tool? You will need to re-authenticate to reconnect."
      )
    )
      return
    try {
      setRevokingClientId(clientId)
      const response = await fetch("/api/connections/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      })
      const data = await response.json()
      if (data.success) {
        toast.success("Connection revoked successfully")
        fetchConnections()
      } else {
        toast.error(data.error || "Failed to revoke connection")
      }
    } catch (error) {
      console.error("Error revoking connection:", error)
      toast.error("Failed to revoke connection")
    } finally {
      setRevokingClientId(null)
    }
  }

  const handleRevokeAll = async (onSuccess?: () => void) => {
    if (
      !confirm(
        "Are you sure you want to disconnect all clients? This will revoke your bearer token and disconnect all MCP clients (Claude Desktop, Cursor, etc.). You will need to generate a new token to reconnect."
      )
    )
      return
    try {
      setIsRevokingAll(true)
      const response = await fetch("/api/connections/revoke-all", {
        method: "POST",
      })
      const data = await response.json()
      if (data.success) {
        toast.success(
          "All clients disconnected successfully. Your bearer token has been revoked."
        )
        onSuccess?.()
        fetchConnections()
      } else {
        toast.error(data.error || "Failed to revoke connections")
      }
    } catch (error) {
      console.error("Error revoking all connections:", error)
      toast.error("Failed to revoke connections")
    } finally {
      setIsRevokingAll(false)
    }
  }

  return {
    connections,
    isLoadingConnections,
    revokingClientId,
    isRevokingAll,
    handleRevoke,
    handleRevokeAll,
    fetchConnections,
  }
}
