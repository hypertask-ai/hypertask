"use client"

import { CircleCheck, X } from "lucide-react"

interface StatusMessageProps {
    type: "success" | "error"
    message: string
}

export default function StatusMessage({ type, message }: StatusMessageProps) {
    if (type === "success") {
        return (
            <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-md">
                <CircleCheck className="h-5 w-5 text-green-600" strokeWidth={1.75} />
                <span className="text-green-800">{message}</span>
            </div>
        )
    }

    return (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-md">
            <X className="h-5 w-5 text-red-600" strokeWidth={1.75} />
            <span className="text-red-800">{message}</span>
        </div>
    )
}
