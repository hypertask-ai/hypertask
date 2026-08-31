"use client"

import React, { useState } from "react"
import {
  ModalContainerCustom,
  ModalFooterComp,
  ModalHeaderComp,
} from "@/components/Common/CommonModalComponents"
import { ModalBody } from "reactstrap"
import { Check, Copy } from "lucide-react";
import toast from "react-hot-toast"
import { CLI_DOCS_URL, INSTALL_COMMAND, LOGIN_COMMAND } from "./constants"

interface IProps {
  closeHandler: () => void
  onOpenMcp?: () => void
}

function CommandRow({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command)
    setCopied(true)
    toast.success("Copied to clipboard!")
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex items-center gap-2 bg-taskDetal-container rounded border-thin border-border-light-gray-thin p-2">
      <input
        type="text"
        readOnly
        value={command}
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
  )
}

const CliInstallModal: React.FC<IProps> = ({ closeHandler, onOpenMcp }) => {
  return (
    <ModalContainerCustom
      fade={false}
      show={true}
      isOpen={true}
      id="cliInstallModal"
      toggle={closeHandler}
      shouldCloseOnClickOutside={true}
      className="font-bold sm:min-w-[600px] sm:max-w-[600px] sm:w-[600px] sm:top-14 "
    >
      <ModalHeaderComp
        headerClassName="h-full"
        header="Hypertask CLI"
        subHeadline="Manage your tasks from the terminal."
        subHeadlineClassName="text-text-light-gray block mt-1"
        className="px-[20px] h-full pb-0 text-meta"
      />
      <ModalBody className="px-4 max-h-[60vh] bg-inherit overflow-y-auto">
        <div className="mb-4">
          <label className="block text-content font-medium text-white-black mb-1">
            1. Install
          </label>
          <p className="text-meta text-text-light-gray mb-2">
            Run this in your terminal on macOS or Linux.
          </p>
          <CommandRow command={INSTALL_COMMAND} />
        </div>

        <div className="mb-4">
          <label className="block text-content font-medium text-white-black mb-1">
            2. Sign in
          </label>
          <p className="text-meta text-text-light-gray mb-2">
            Opens your browser to authorize the CLI for your account.
          </p>
          <CommandRow command={LOGIN_COMMAND} />
        </div>

        <div className="pt-3.5 border-t border-border-light-gray-thin">
          <p className="text-meta text-text-light-gray">
            That&apos;s it. Run <span className="font-mono text-white-black">hypertask --help</span> to see
            everything you can do.{" "}
            <a
              href={CLI_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#3B82F6] hover:underline"
            >
              See the docs
            </a>
            .
          </p>
        </div>
      </ModalBody>
      <ModalFooterComp className="flex justify-between items-center px-4 py-3 border-t border-border-light-gray-thin">
        {onOpenMcp ? (
          <button
            type="button"
            onClick={onOpenMcp}
            className="text-content text-[#3B82F6] hover:underline font-medium"
          >
            Connect AI assistants via MCP →
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

export default CliInstallModal
