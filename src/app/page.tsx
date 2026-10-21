'use client'
import { useLayoutEffect } from 'react'
import useCurrentUserCheckFromCookies from '@/hooks/General/useCurrentUserCheckFromCookies'
import { useRouter } from 'next/navigation'
import { destroyCookie } from 'nookies'

const Page = () => {
  const currentUser = useCurrentUserCheckFromCookies()
  const router = useRouter()
  
  useLayoutEffect(() => {
    if (currentUser) {
      console.error('🚨 User reached root route - this should not happen. Logging out user.')
      
      destroyCookie(null, 'nookies_user')
      destroyCookie(null, 'previousBoard')
      destroyCookie(null, 'theme')
      destroyCookie(null, 'signup_source')
      
      if (typeof window !== 'undefined') {
        localStorage.clear()
      }
      
      router.replace('/login')
    }
  }, [currentUser, router])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h1 className="text-subheading font-semibold text-red-500">Access Denied</h1>
        <p className="text-gray-500 mt-2">This route is not accessible</p>
        {currentUser && (
          <p className="text-content text-red-400 mt-2">Logging you out for security...</p>
        )}
      </div>
    </div>
  )
}

export default Page
