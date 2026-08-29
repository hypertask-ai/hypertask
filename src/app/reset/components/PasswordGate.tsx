"use client"

import { X } from "lucide-react"
import type React from "react"

interface PasswordGateProps {
    password: string
    setPassword: (password: string) => void
    passwordError: string
    onSubmit: (e: React.FormEvent) => void
}

export default function PasswordGate({ password, setPassword, passwordError, onSubmit }: PasswordGateProps) {
    return (
        <div className="min-h-screen bg-gray-50 text-black flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-lg shadow-md">
                <div className="p-6 text-center border-b">
                    <h1 className="text-heading font-bold text-gray-900 mb-2">Admin Access</h1>
                    <p className="text-gray-600">Enter password to access the user reset tool</p>
                </div>
                <div className="p-6">
                    <form onSubmit={onSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <label htmlFor="password" className="block text-content font-medium text-gray-700">
                                Password
                            </label>
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Enter admin password"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                        {passwordError && (
                            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-md">
                                <X className="h-4 w-4 text-red-600" strokeWidth={1.75} />
                                <span className="text-red-800 text-content">{passwordError}</span>
                            </div>
                        )}
                        <button
                            type="submit"
                            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                        >
                            Access Admin Panel
                        </button>
                    </form>
                </div>
            </div>
        </div>
    )
}
