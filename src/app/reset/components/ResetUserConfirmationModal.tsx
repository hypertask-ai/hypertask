"use client"

import { TriangleAlert } from "lucide-react"
import { IUser } from "@/models/model"

interface ResetUserConfirmationModalProps {
    sourceUser: IUser
    targetUser: IUser
    onConfirm: () => void
    onCancel: () => void
}

export default function ResetUserConfirmationModal({
    sourceUser,
    targetUser,
    onConfirm,
    onCancel,
}: ResetUserConfirmationModalProps) {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
                <div className="p-6 border-b">
                    <h3 className="text-subheading font-semibold text-gray-900 flex items-center gap-2">
                        <TriangleAlert className="h-5 w-5 text-red-500" strokeWidth={1.75} />
                        Confirm User Reset
                    </h3>
                    <p className="text-gray-600 text-content mt-1">
                        Are you absolutely sure you want to proceed?
                    </p>
                </div>

                <div className="p-6 space-y-4">
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                        <p className="text-content font-medium text-red-900 mb-2">User to be RESET:</p>
                        <p className="text-content text-red-800 font-mono">
                            {sourceUser?.displayName} ({sourceUser?.email})
                        </p>
                    </div>

                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                        <p className="text-content font-medium text-green-900 mb-2">Content will be transferred to:</p>
                        <p className="text-content text-green-800 font-mono">
                            {targetUser?.displayName} ({targetUser?.email})
                        </p>
                    </div>

                    <div className="text-content text-gray-700 bg-gray-50 p-3 rounded">
                        <p className="font-medium mb-1">This will:</p>
                        <ul className="list-disc list-inside space-y-1">
                            <li>Reset the source user account permanently</li>
                            <li>Transfer all boards and teams to the target user</li>
                            <li>Cannot be undone</li>
                        </ul>
                    </div>
                </div>

                <div className="p-6 border-t flex gap-3">
                    <button
                        onClick={onCancel}
                        className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        className="flex-1 bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors"
                    >
                        Yes, Reset & Transfer
                    </button>
                </div>
            </div>
        </div>
    )
}
