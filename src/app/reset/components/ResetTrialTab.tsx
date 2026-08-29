"use client"

import { useState, useEffect, useMemo } from "react"
import { LoaderCircle, RefreshCw, User } from "lucide-react"
import axiosClient from "@/utils/axiosClient"
import { useQuery } from "@tanstack/react-query"
import { IUser } from "@/models/model"
import { getDaysLeftFreemium } from "@/utils/helperFunctions/helperFunctions"
import UserSearch from "./UserSearch"
import StatusMessage from "./StatusMessage"

type ActionState = "idle" | "loading" | "success" | "error"

interface ResetTrialTabProps {
    searchTerm: string
    onSearchChange: (term: string) => void
    adminPassword: string
}

export default function ResetTrialTab({ searchTerm, onSearchChange, adminPassword }: ResetTrialTabProps) {
    const [selectedTrialUser, setSelectedTrialUser] = useState<IUser | null>(null)
    const [trialResetState, setTrialResetState] = useState<ActionState>("idle")
    const [trialResetMessage, setTrialResetMessage] = useState("")
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("")

    // Debounce search term
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm)
        }, 300) // 300ms debounce

        return () => clearTimeout(timer)
    }, [searchTerm])

    // Fetch users on demand based on search term
    const fetchUsers = async () => {
        if (!debouncedSearchTerm || debouncedSearchTerm.trim().length < 2) {
            return []
        }

        try {
            const res = await axiosClient.get(`/users/search?q=${encodeURIComponent(debouncedSearchTerm)}&limit=50`, {
                headers: { "x-admin-password": adminPassword }
            })
            return res.data.users || []
        } catch (error) {
            console.error("Error searching users:", error)
            return []
        }
    }

    const { data: searchedUsers = [], isLoading: isSearching } = useQuery({
        queryKey: ["search-users", debouncedSearchTerm],
        queryFn: fetchUsers,
        enabled: debouncedSearchTerm.trim().length >= 2,
        gcTime: 10000,
    })

    const filteredUsers = useMemo(() => {
        return searchedUsers
    }, [searchedUsers])

    const handleTrialReset = async () => {
        if (!selectedTrialUser) return
        
        setTrialResetState("loading")
        setTrialResetMessage("")
        
        try {
            const response = await axiosClient.post("/users/reset-trial", {
                userId: selectedTrialUser.id,
                force: false
            }, {
                headers: { "x-admin-password": adminPassword }
            })
            
            if (response.data.success) {
                setTrialResetState("success")
                setTrialResetMessage(
                    `Successfully reset trial period for ${selectedTrialUser.displayName} (${selectedTrialUser.email}). Their trial period has been restarted.`
                )
                setSelectedTrialUser(null)
                onSearchChange("")
            } else {
                setTrialResetState("error")
                setTrialResetMessage(response.data.error || "Failed to reset trial period")
            }
        } catch (error: any) {
            setTrialResetState("error")
            const errorMsg = error.response?.data?.error || error.message || "An unexpected error occurred"
            setTrialResetMessage(errorMsg)
        }
    }

    const resetTrialForm = () => {
        setTrialResetState("idle")
        setTrialResetMessage("")
        setSelectedTrialUser(null)
        onSearchChange("")
    }

    return (
        <div className="space-y-6">
            {/* Success/Error Messages */}
            {trialResetState === "success" && <StatusMessage type="success" message={trialResetMessage} />}
            {trialResetState === "error" && <StatusMessage type="error" message={trialResetMessage} />}

            <div className="bg-white rounded-lg shadow-md">
                <div className="p-6 border-b">
                    <h2 className="text-subheading font-semibold text-gray-900 flex items-center gap-2">
                        <RefreshCw className="h-5 w-5 text-blue-500" strokeWidth={1.75} />
                        Reset User Trial Period
                    </h2>
                    <p className="text-gray-600 text-content mt-1">
                        Search for a user and reset their 14-day trial period. This will set their trialStatus to false and reset their joinedAt date.
                    </p>
                </div>
                <div className="p-6 space-y-4">
                    {/* Search Input */}
                    <div className="space-y-4">
                        <UserSearch
                            searchTerm={searchTerm}
                            onSearchChange={onSearchChange}
                            users={filteredUsers}
                            selectedUserId={selectedTrialUser?.id}
                            onUserSelect={setSelectedTrialUser}
                            placeholder="Search users by name or email (min 2 characters)..."
                            disabled={trialResetState === "loading"}
                            emptyMessage={
                                isSearching
                                    ? "Searching..."
                                    : searchTerm.length < 2
                                    ? "Type at least 2 characters to search"
                                    : "No users found matching your search"
                            }
                        />
                       
                    </div>

                    {/* Selected User Preview */}
                    {selectedTrialUser && (
                        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                            <div className="flex items-center gap-2 mb-2">
                                <User className="h-4 w-4 text-blue-600" strokeWidth={1.75} />
                                <p className="text-content font-medium text-blue-900">Selected User:</p>
                            </div>
                            <div className="flex items-center gap-2 mb-2">
                                <img src={selectedTrialUser.photoURL || "/placeholder.svg"} alt="" className="w-6 h-6 rounded-full" />
                                <span className="text-blue-800 text-content font-medium">
                                    {selectedTrialUser.displayName} ({selectedTrialUser.email})
                                </span>
                            </div>
                            {selectedTrialUser.joinedAt && (
                                <div className="text-content text-blue-700 font-medium">
                                    {(() => {
                                        const daysLeft = getDaysLeftFreemium(new Date(selectedTrialUser.joinedAt));
                                        return daysLeft > 0 
                                            ? `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left in trial`
                                            : 'Trial expired';
                                    })()}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Info Box */}
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-content font-medium text-blue-900 mb-2">What will happen:</p>
                        <ul className="text-content text-blue-800 space-y-1">
                            <li>• User&apos;s trialStatus will be set to false (makes them eligible for trial again)</li>
                            <li>• User&apos;s joinedAt date will be reset to today (restarts the 14-day countdown)</li>
                            <li>• If user has active subscriptions, reset will be blocked (unless force=true, which is disabled)</li>
                        </ul>
                    </div>

                    {/* Action Button */}
                    <div className="pt-4">
                        <button
                            onClick={handleTrialReset}
                            disabled={!selectedTrialUser || trialResetState === "loading"}
                            className="w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {trialResetState === "loading" ? (
                                <>
                                    <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                                    Resetting Trial Period...
                                </>
                            ) : (
                                <>
                                    <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
                                    Reset Trial Period
                                </>
                            )}
                        </button>

                        {(trialResetState === "success" || trialResetState === "error") && (
                            <button
                                onClick={resetTrialForm}
                                className="w-full mt-3 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                            >
                                Reset Form
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
