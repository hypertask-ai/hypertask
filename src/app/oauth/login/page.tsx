'use client'

import { useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import LoadingSpinner1 from '@/components/LoadingSpinners/LoadingSpinner1'
import { cn } from '@/utils/undoActions/helperFuncs'

/**
 * Legacy OAuth login page - redirects to main /login page
 * This page is kept for backward compatibility but redirects to the main login flow
 */
export default function OAuthLoginPage() {
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    // Redirect to main login page with OAuth params preserved
    const loginUrl = new URL('/login', window.location.origin)
    searchParams?.forEach((value, key) => {
      loginUrl.searchParams.set(key, value)
    })
    router.replace(loginUrl.toString())
  }, [searchParams, router])

  // Show loading while redirecting
  return (
    <div className={cn(
      "min-h-[100svh] w-full flex items-center justify-center",
      "bg-[#0a0012] text-white"
    )}>
      <div className="flex flex-col items-center gap-4">
        <LoadingSpinner1 size={32} thickness={2} />
        <span className="text-subheading">Redirecting...</span>
      </div>
    </div>
  )
}
