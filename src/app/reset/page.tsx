"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import axiosClient from "@/utils/axiosClient"
import { getUsersByEmailsForResetRoute } from "@/lib/constants/APIRouteConstants"
import { IUser } from "@/models/model"
import PasswordGate from "./components/PasswordGate"
import TabNavigation from "./components/TabNavigation"
import ResetUserTab from "./components/ResetUserTab"
import ResetTrialTab from "./components/ResetTrialTab"

type TabType = "reset-user" | "reset-trial"

export default function AdminResetTool() {
    const [activeTab, setActiveTab] = useState<TabType>("reset-user")
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [password, setPassword] = useState("")
    const [passwordError, setPasswordError] = useState("")
    const [searchTerm, setSearchTerm] = useState("")
    // Reset trial specific state
    const [trialSearchTerm, setTrialSearchTerm] = useState("")

    // Query function to fetch users for reset user tab (hardcoded emails)
    const fetchUsers = async () => {
        const emails = ['valentin@tryhypertask.com', 'valentin@hypertasks.io', 'valentin.yeo@eduki.com', 'valentinyeo.ux@gmail.com', 'rodmentou@gmail.com', 'rodmentouuk@gmail.com', 'ai@rodrigonask.com']
        try {
            const res = await axiosClient.post(getUsersByEmailsForResetRoute, { emails }, {
                headers: { "x-admin-password": password }
            })
            return res.data.users ?? []
        } catch (error) {
            return []
        }
    }

    // Use react-query to fetch users for reset user tab
    const { data: apiUsers } = useQuery({
        queryKey: ["reset-users"],
        queryFn: fetchUsers,
        enabled: isAuthenticated && activeTab === "reset-user",
        gcTime: 10000,
    })

    // Filter users based on search term (for reset user tab)
    const filteredUsers = useMemo(() => {
        const users: IUser[] = apiUsers || []
        return users.filter(
            (user) =>
                user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                user.displayName?.toLowerCase().includes(searchTerm.toLowerCase()),
        )
    }, [searchTerm, apiUsers])

    const handlePasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setPasswordError("")

        try {
            await axiosClient.post("/admin/reset-auth", { password })
            setIsAuthenticated(true)
        } catch {
            setPasswordError("Invalid password. Access denied.")
        }
    }

    const handleTabChange = (tab: TabType) => {
        setActiveTab(tab)
        setSearchTerm("")
        setTrialSearchTerm("")
    }

    // Password Gate Screen
    if (!isAuthenticated) {
        return (
            <PasswordGate
                password={password}
                setPassword={setPassword}
                passwordError={passwordError}
                onSubmit={handlePasswordSubmit}
            />
        )
    }

    // Main Admin Interface
    return (
        <div className="min-h-screen bg-gray-50 p-4 text-black">
            <div className="max-w-6xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-display font-bold text-gray-900 mb-2">Admin Tools</h1>
                    <p className="text-gray-600">Manage user accounts and trial periods</p>
                </div>

                <TabNavigation activeTab={activeTab} onTabChange={handleTabChange} />

                {/* Reset User Tab Content */}
                {activeTab === "reset-user" && (
                    <ResetUserTab
                        filteredUsers={filteredUsers}
                        searchTerm={searchTerm}
                        onSearchChange={setSearchTerm}
                        adminPassword={password}
                    />
                )}

                {/* Reset Trial Tab Content */}
                {activeTab === "reset-trial" && (
                    <ResetTrialTab
                        searchTerm={trialSearchTerm}
                        onSearchChange={setTrialSearchTerm}
                        adminPassword={password}
                    />
                )}
            </div>
        </div>
    )
}
