"use client"

import { RefreshCw, Trash2 } from "lucide-react"

type TabType = "reset-user" | "reset-trial"

interface TabNavigationProps {
    activeTab: TabType
    onTabChange: (tab: TabType) => void
}

export default function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
    return (
        <div className="mb-6 border-b border-gray-200">
            <nav className="flex space-x-8">
                <button
                    onClick={() => onTabChange("reset-user")}
                    className={`py-4 px-1 border-b-2 font-medium text-content ${
                        activeTab === "reset-user"
                            ? "border-red-500 text-red-600"
                            : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                >
                    <div className="flex items-center gap-2">
                        <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                        Reset User & Transfer Content
                    </div>
                </button>
                <button
                    onClick={() => onTabChange("reset-trial")}
                    className={`py-4 px-1 border-b-2 font-medium text-content ${
                        activeTab === "reset-trial"
                            ? "border-blue-500 text-blue-600"
                            : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                >
                    <div className="flex items-center gap-2">
                        <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
                        Reset Trial Period
                    </div>
                </button>
            </nav>
        </div>
    )
}
