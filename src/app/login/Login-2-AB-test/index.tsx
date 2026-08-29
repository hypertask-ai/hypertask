'use client'
import React, { useState } from 'react'
import Image from 'next/image'
import { cn } from '@/utils/undoActions/helperFuncs'
import LoginButton from '../LoginButton'
import EmailAuth, { EmailAuthStyleConfig } from '../EmailAuth'
import UTMCookieHandler from '@/components/analytics/StoreUTM'

const LoginMinimal = () => {
    const [showEmailForm, setShowEmailForm] = useState(false)

    // Custom styling for the AB test login page
    const emailAuthStyleConfig: EmailAuthStyleConfig = {
        container: "w-full",
        input: "w-full px-3 text-dense h-12 py-3 bg-transparent border-2 border-gray-600 rounded text-white placeholder-gray-400 outline-none focus:border-gray-500 transition-colors",
        button: "w-full py-3 px-6 rounded-md font-medium transition-all shadow-sm",
        buttonPrimary: "text-white bg-[#18181b] text-content hover:bg-opacity-10",
        buttonSecondary: "bg-[#18181b] border text-content border-gray-600  text-white hover:bg-[#1f1f23] hover:border-gray-500",
        error: "p-3 bg-red-900/20 border border-red-500/20 rounded-lg text-red-400 text-content",
        text: "text-gray-400",
        textSecondary: "text-gray-400 hover:text-white text-content",
        heading: "text-white font-semibold"
    }

    return (
        <>
            <UTMCookieHandler />
            <div className={cn(
                "min-h-[100svh] w-full flex items-center justify-center",
                "bg-[#0a0012] text-white",
                "p-8"
            )}>
                <div className="w-full max-w-md flex flex-col items-center">
                    {/* Logo with Text */}
                    <Image
                        src="/loginLogoMain.png"
                        alt="Hypertask logo"
                        className="object-contain mb-8"
                        width={48}
                        height={48}
                    />


                    {/* Title */}
                    <span className="text-emphasis  font-medium text-white mb-6">
                        Log in to Hypertask
                    </span>

                    {/* Login Options */}
                    {showEmailForm ? (
                        <div className="min-w-[288px] space-y-4">
                            <EmailAuth styleConfig={emailAuthStyleConfig} />
                            <button
                                onClick={() => setShowEmailForm(false)}
                                className="w-full text-center text-content text-gray-400 hover:text-white transition-colors"
                            >
                                ← Back to login
                            </button>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3 w-[288px]">

                            {/* Google Sign In Button */}
                            <LoginButton
                                className="w-full h-12 sm:w-full font-medium shadow-sm text-content"
                                size="small"
                                iconClassName="hidden"
                            />

                            {/* Email Sign In Button */}
                            <button
                                onClick={() => setShowEmailForm(true)}
                                className={cn(
                                    "w-full py-3 h-12 px-6",
                                    "text-white bg-[#18181b]",
                                    "rounded flex items-center justify-center gap-3",
                                    "cursor-pointer font-medium",
                                    "transition-all  shadow-sm",
                                    "hover:bg-[#1f1f23]"
                                )}
                            >
                                <span className="text-content sm:text-content">
                                    Continue with email
                                </span>
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </>
    )
}

export default LoginMinimal
