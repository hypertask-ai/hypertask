"use client"

import { useState } from "react"
import { ArrowRight, LoaderCircle, Trash2, TriangleAlert, User } from "lucide-react"
import { resetUserRoute } from "@/lib/constants/APIRouteConstants"
import axiosClient from "@/utils/axiosClient"
import { IUser } from "@/models/model"
import useCurrentUser from "@/hooks/General/useCurrentUserCheckFromCookies"
import { useSignout } from "@/hooks/MultiPages/HTC/useSignout"
import UserSearch from "./UserSearch"
import StatusMessage from "./StatusMessage"
import ResetUserConfirmationModal from "./ResetUserConfirmationModal"

type ActionState = "idle" | "loading" | "success" | "error"

interface ResetUserTabProps {
    filteredUsers: IUser[]
    searchTerm: string
    onSearchChange: (term: string) => void
    adminPassword: string
}

export default function ResetUserTab({ filteredUsers, searchTerm, onSearchChange, adminPassword }: ResetUserTabProps) {
    const [sourceUser, setSourceUser] = useState<IUser | null>(null)
    const [targetUser, setTargetUser] = useState<IUser | null>(null)
    const [showConfirmModal, setShowConfirmModal] = useState(false)
    const [resetState, setResetState] = useState<ActionState>("idle")
    const [resetMessage, setResetMessage] = useState("")
    const currentUser = useCurrentUser()
    const { handleHardReset } = useSignout()

    const handleResetClick = () => {
        if (!sourceUser || !targetUser || sourceUser.id === targetUser.id) {
            return
        }
        setShowConfirmModal(true)
    }

    const executeReset = async () => {
        setShowConfirmModal(false)
        setResetState("loading")
        if (!sourceUser || !targetUser || sourceUser.id === targetUser.id) {
            return
        }
        const payload = {
            "userToResetId": sourceUser.id,
            "newOwnerId": targetUser.id
        }
        try {
            const response = await axiosClient.post(resetUserRoute, payload, {
                headers: { "x-admin-password": adminPassword }
            })
            if (response.status === 200) {
                setResetState("success")
                setResetMessage(
                    `Successfully reset ${sourceUser?.displayName} and transferred all their boards and teams to ${targetUser?.displayName}`,
                )
                setSourceUser(null)
                setTargetUser(null)
                if (currentUser.id === sourceUser.id) {
                    handleHardReset()
                }
            } else {
                setResetState("error")
                setResetMessage("Failed to reset user and transfer content. An error occurred during the process.")
            }
        } catch (error) {
            setResetState("error")
            setResetMessage("An unexpected error occurred. Please try again.")
        }
    }

    const resetForm = () => {
        setResetState("idle")
        setResetMessage("")
        setSourceUser(null)
        setTargetUser(null)
        onSearchChange("")
    }

    return (
        <>
            {/* Success/Error Messages */}
            {resetState === "success" && <StatusMessage type="success" message={resetMessage} />}
            {resetState === "error" && <StatusMessage type="error" message={resetMessage} />}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Step 1: Select User to Reset */}
                <div className="bg-white rounded-lg shadow-md">
                    <div className="p-6 border-b">
                        <h2 className="text-subheading font-semibold text-gray-900 flex items-center gap-2">
                            <Trash2 className="h-5 w-5 text-red-500" strokeWidth={1.75} />
                            Step 1: Select User to Reset
                        </h2>
                        <p className="text-gray-600 text-content mt-1">Choose the user account that will be reset</p>
                    </div>
                    <div className="p-6">
                        <UserSearch
                            searchTerm={searchTerm}
                            onSearchChange={onSearchChange}
                            users={filteredUsers}
                            selectedUserId={sourceUser?.id}
                            onUserSelect={setSourceUser}
                            disabled={resetState === "loading"}
                        />
                    </div>
                </div>

                {/* Step 2: Select Target User */}
                <div className="bg-white rounded-lg shadow-md">
                    <div className="p-6 border-b">
                        <h2 className="text-subheading font-semibold text-gray-900 flex items-center gap-2">
                            <User className="h-5 w-5 text-green-500" strokeWidth={1.75} />
                            Step 2: Select Target User
                        </h2>
                        <p className="text-gray-600 text-content mt-1">Choose who will receive all the boards and teams</p>
                    </div>
                    <div className="p-6">
                        <UserSearch
                            searchTerm={searchTerm}
                            onSearchChange={onSearchChange}
                            users={filteredUsers.filter((user) => user.id !== sourceUser?.id)}
                            selectedUserId={targetUser?.id}
                            onUserSelect={setTargetUser}
                            disabled={resetState === "loading"}
                        />
                    </div>
                </div>

                {/* Step 3: Execute Reset */}
                <div className="bg-white rounded-lg shadow-md">
                    <div className="p-6 border-b">
                        <h2 className="text-subheading font-semibold text-gray-900 flex items-center gap-2">
                            <ArrowRight className="h-5 w-5 text-purple-500" strokeWidth={1.75} />
                            Step 3: Execute Reset
                        </h2>
                        <p className="text-gray-600 text-content mt-1">Review and confirm the reset operation</p>
                    </div>
                    <div className="p-6 space-y-6">
                        {/* Preview */}
                        {sourceUser && targetUser && (
                            <div className="space-y-4">
                                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Trash2 className="h-4 w-4 text-red-600" strokeWidth={1.75} />
                                        <p className="text-content font-medium text-red-900">Will be RESET:</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <img src={sourceUser.photoURL || "/placeholder.svg"} alt="" className="w-6 h-6 rounded-full" />
                                        <span className="text-red-800 text-content font-medium">
                                            {sourceUser.displayName} ({sourceUser.email})
                                        </span>
                                    </div>
                                </div>

                                <div className="flex justify-center">
                                    <ArrowRight className="h-6 w-6 text-gray-400" strokeWidth={1.75} />
                                </div>

                                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                                    <div className="flex items-center gap-2 mb-2">
                                        <User className="h-4 w-4 text-green-600" strokeWidth={1.75} />
                                        <p className="text-content font-medium text-green-900">Will RECEIVE all content:</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <img src={targetUser.photoURL || "/placeholder.svg"} alt="" className="w-6 h-6 rounded-full" />
                                        <span className="text-green-800 text-content font-medium">
                                            {targetUser.displayName} ({targetUser.email})
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* What will happen */}
                        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                            <p className="text-content font-medium text-blue-900 mb-2">What will happen:</p>
                            <ul className="text-content text-blue-800 space-y-1">
                                <li>• All boards owned by the source user will be transferred</li>
                                <li>• All team memberships will be transferred</li>
                                <li>• Source user account will be completely reset</li>
                                <li>• This action cannot be undone</li>
                            </ul>
                        </div>

                        {/* Warning */}
                        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md">
                            <TriangleAlert className="h-4 w-4 text-red-600 mt-0.5" strokeWidth={1.75} />
                            <div className="text-red-800 text-content">
                                <strong>Warning:</strong> This will permanently reset the source user and transfer all their content. 
                                This action cannot be undone.
                            </div>
                        </div>

                        {/* Action Button */}
                        <div className="pt-4">
                            <button
                                onClick={handleResetClick}
                                disabled={
                                    !sourceUser || !targetUser || sourceUser.id === targetUser.id || resetState === "loading"
                                }
                                className="w-full bg-red-600 text-white py-3 px-4 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {resetState === "loading" ? (
                                    <>
                                        <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                                        Resetting User...
                                    </>
                                ) : (
                                    <>
                                        <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                                        Reset User & Transfer Content
                                    </>
                                )}
                            </button>

                            {(resetState === "success" || resetState === "error") && (
                                <button
                                    onClick={resetForm}
                                    className="w-full mt-3 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                                >
                                    Start Over
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Confirmation Modal */}
            {showConfirmModal && sourceUser && targetUser && (
                <ResetUserConfirmationModal
                    sourceUser={sourceUser}
                    targetUser={targetUser}
                    onConfirm={executeReset}
                    onCancel={() => setShowConfirmModal(false)}
                />
            )}
        </>
    )
}
