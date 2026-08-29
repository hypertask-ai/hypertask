"use client"

import React, { useState } from "react"
import {
  ModalContainerCustom,
  ModalFooterComp,
  ModalHeaderComp,
} from "@/components/Common/CommonModalComponents"
import { ModalBody } from "reactstrap"

import { useMcpToken } from "./hooks/useMcpToken"
import { useMcpConnections } from "./hooks/useMcpConnections"
import {
  TokenStatusBar,
  McpServerUrlSection,
  IntegrationChips,
  ConnectInstructions,
  AvailableToolsSection,
  ExternalConnectionsList,
  DisconnectAllSection,
} from "./components"
import { MCP_DOCS_URL } from "./utils"
import type { IntegrationId } from "./utils"
import { IUser } from "@/models/model"

interface IProps {
  currentUser: IUser
  closeHandler: () => void
  onOpenCli?: () => void
}

const McpTokenModal: React.FC<IProps> = ({ currentUser, closeHandler, onOpenCli }) => {
  const [selectedIntegration, setSelectedIntegration] =
    useState<IntegrationId>("claude-code")
  const [useBearer, setUseBearer] = useState(false)

  const {
    token,
    expiresAt,
    isLoading,
    isGenerating,
    generateToken,
    clearToken,
  } = useMcpToken()

  const {
    connections,
    isLoadingConnections,
    revokingClientId,
    isRevokingAll,
    handleRevoke,
    handleRevokeAll,
  } = useMcpConnections()

  const revokeAllAndClearToken = () => {
    handleRevokeAll(clearToken)
  }

  return (
    <ModalContainerCustom
      fade={false}
      show={true}
      isOpen={true}
      id="mcpTokenModal"
      toggle={closeHandler}
      shouldCloseOnClickOutside={true}
      className="font-bold sm:min-w-[600px] sm:max-w-[600px] sm:w-[600px] sm:top-14 "
    >
      <ModalHeaderComp
      headerClassName="h-full"
        header="MCP Token"
        subHeadline="Connect your Hypertask workspace to AI assistants via the Model Context Protocol."
        subHeadlineClassName="text-text-light-gray block mt-1"
        className="px-[20px] h-full pb-0 text-meta"
      />
      <ModalBody className="px-4 max-h-[60vh] bg-inherit overflow-y-auto">
        <TokenStatusBar
          token={token}
          expiresAt={expiresAt}
          isLoading={isLoading}
          isGenerating={isGenerating}
          onGenerate={generateToken}
        />

        <McpServerUrlSection />

        <div className="mb-4">
          <h3 className="text-content font-medium text-white-black mb-2">
            Connect Hypertask with
          </h3>
          <IntegrationChips
            selectedId={selectedIntegration}
            onSelect={setSelectedIntegration}
          />
          <ConnectInstructions
            integrationId={selectedIntegration}
            token={token}
            useBearer={useBearer}
            onUseBearerClick={() => setUseBearer(!useBearer)}
          />
        </div>

        <div className="pt-3.5 border-t border-border-light-gray-thin mb-4">
          <AvailableToolsSection />
        </div>

        <div className="pt-3.5 border-t border-border-light-gray-thin">
          <h3 className="text-content font-medium text-white-black mb-2">
            Connected Clients
          </h3>
          <ExternalConnectionsList
            connections={connections}
            isLoading={isLoadingConnections}
            revokingClientId={revokingClientId}
            onRevoke={handleRevoke}
          />
        </div>

        {connections.length > 0 && (
          <DisconnectAllSection
            isRevoking={isRevokingAll}
            onRevokeAll={revokeAllAndClearToken}
          />
        )}
      </ModalBody>
      <ModalFooterComp className="flex justify-between items-center px-4 py-3 border-t border-border-light-gray-thin">
        {onOpenCli ? (
          <button
            type="button"
            onClick={onOpenCli}
            className="text-content text-[#3B82F6] hover:underline font-medium"
          >
            Prefer the terminal? Install the CLI →
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={closeHandler}
          className="px-4 py-2 bg-[#5F646C] hover:bg-[#6B7280] text-white rounded-lg transition-colors text-content font-medium"
        >
          Close
        </button>
      </ModalFooterComp>
    </ModalContainerCustom>
  )
}

export default McpTokenModal
