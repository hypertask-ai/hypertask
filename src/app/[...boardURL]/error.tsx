"use client";
import React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useSignout } from "@/hooks/MultiPages/HTC/useSignout";

export default function ErrorScreen() {
    const router = useRouter();
    const queryClient = useQueryClient();

    const handleRetry = async () => {
        localStorage.clear();
        await queryClient.clear();
        router.replace("/");
    };

    const {handleHardReset} = useSignout()
    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground px-4">
            <div className="bg-card shadow-lg rounded-xl p-8 flex flex-col items-center max-w-md w-full">
                <h1 className="text-display font-bold mb-2">Something went wrong</h1>
                <p className="text-muted-foreground mb-6 text-center">
                    An unexpected error occurred. You can try again or sign out and log in again.
                </p>
                <div className="flex gap-4 w-full">
                    <button
                        onClick={handleRetry}
                        className="flex-1 bg-primary text-primary-foreground font-semibold py-2 rounded-lg hover:bg-primary/90 transition"
                    >
                        Retry
                    </button>
                    <button
                        onClick={handleHardReset}
                        className="flex-1 bg-destructive text-destructive-foreground font-semibold py-2 rounded-lg hover:bg-destructive/90 transition"
                    >
                        Sign out
                    </button>
                </div>
            </div>
        </div>
    );
}
