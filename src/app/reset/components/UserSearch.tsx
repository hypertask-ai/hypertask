"use client"

import { Search } from "lucide-react"
import { IUser } from "@/models/model"

interface UserSearchProps {
    searchTerm: string
    onSearchChange: (term: string) => void
    users: IUser[]
    selectedUserId?: number | null
    onUserSelect: (user: IUser) => void
    placeholder?: string
    disabled?: boolean
    emptyMessage?: string
}

export default function UserSearch({
    searchTerm,
    onSearchChange,
    users,
    selectedUserId,
    onUserSelect,
    placeholder = "Search users...",
    disabled = false,
    emptyMessage,
}: UserSearchProps) {
    return (
        <div className="space-y-4">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" strokeWidth={1.75} />
                <input
                    placeholder={placeholder}
                    value={searchTerm}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    disabled={disabled}
                />
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
                {users.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        {emptyMessage || (searchTerm ? "No users found matching your search" : "Start typing to search for users")}
                    </div>
                ) : (
                    users.map((user) => (
                        <div
                            key={user.id}
                            className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                                selectedUserId === user.id
                                    ? "border-blue-500 bg-blue-50"
                                    : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                            }`}
                            onClick={() => onUserSelect(user)}
                        >
                            <div className="flex items-center gap-3">
                                <img
                                    src={user.photoURL || "/placeholder.svg"}
                                    alt={user.displayName}
                                    className="w-8 h-8 rounded-full"
                                />
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-content truncate">
                                        {user.displayName} ({user.email})
                                    </p>
                                    <p className="text-meta text-gray-500">{user.type || `ID: ${user.id}`}</p>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}
