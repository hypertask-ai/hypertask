'use client'

import { useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import LoadingSpinner1 from '@/components/LoadingSpinners/LoadingSpinner1'
import { cn } from '@/utils/undoActions/helperFuncs'

export default function OAuthLoginPage() {
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    const loginUrl = new URL('/login', window.location.origin)
    searchParams?.forEach((value, key) => {
      loginUrl.searchParams.set(key, value)
    })
    router.replace(loginUrl.toString())
  }, [searchParams, router])

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
