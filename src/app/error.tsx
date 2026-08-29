'use client' // Error components must be Client Components

import { useEffect } from 'react'
import { useSignout } from '@/hooks/MultiPages/HTC/useSignout'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const { handleHardReset } = useSignout()

  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Root page error:', error)
    
    // Log additional error details
    if (typeof window !== 'undefined') {
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        digest: error.digest,
        url: window.location.href,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString()
      })
    }
  }, [error])

  const handleHardResetAndReload = async () => {
    try {
      await handleHardReset()
      // The handleHardReset already redirects to /login
    } catch (err) {
      console.error('Error during hard reset:', err)
      // Fallback: force reload to login page
      if (typeof window !== 'undefined') {
        window.location.href = '/login'
      }
    }
  }

  const handleRetry = () => {
    try {
      reset()
    } catch (err) {
      console.error('Error during reset:', err)
      // Fallback: reload the page
      if (typeof window !== 'undefined') {
        window.location.reload()
      }
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground px-4">
      <div className="bg-card shadow-lg rounded-xl p-8 flex flex-col items-center max-w-md w-full">
        <div className="text-6xl mb-4">⚠️</div>
        <h1 className="text-display font-bold mb-2 text-center">Something went wrong</h1>
        <p className="text-muted-foreground mb-4 text-center">
          An error occurred while loading the application. This usually requires a fresh start.
        </p>
        
        {/* Show error details in development or for debugging */}
        {process.env.NODE_ENV === 'development' && error && (
          <details className="mb-4 w-full">
            <summary className="text-content text-muted-foreground cursor-pointer hover:text-foreground">
              Error Details (Dev Mode)
            </summary>
            <pre className="text-meta bg-muted p-2 rounded mt-2 overflow-auto max-h-32 whitespace-pre-wrap">
              {error.message}
              {error.digest && `\nDigest: ${error.digest}`}
            </pre>
          </details>
        )}

        <div className="flex gap-4 w-full flex-col sm:flex-row">
          <button
            onClick={handleHardResetAndReload}
            className="flex-1 bg-destructive text-destructive-foreground font-semibold py-3 px-4 rounded-lg hover:bg-destructive/90 transition"
          >
            Sign Out & Reset
          </button>
          <button
            onClick={handleRetry}
            className="flex-1 bg-primary text-primary-foreground font-semibold py-3 px-4 rounded-lg hover:bg-primary/90 transition"
          >
            Try Again
          </button>
        </div>
        
        <p className="text-meta text-muted-foreground mt-4 text-center">
          If this problem persists, please contact support or try clearing your browser data.
        </p>
      </div>
    </div>
  )
} 
