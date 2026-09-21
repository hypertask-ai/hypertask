'use client'

import React, { Component, ErrorInfo, ReactNode } from 'react'
import { useSignout } from '@/hooks/MultiPages/HTC/useSignout'
import { reportClientError } from '@/lib/telemetry/reportClientError'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

class RootErrorBoundaryClass extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('RootErrorBoundary caught an error:', error, errorInfo)
    reportClientError({
      source: 'RootErrorBoundary',
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack ?? undefined,
    })
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || <ErrorFallback error={this.state.error} />
    }

    return this.props.children
  }
}

// Functional component for the error fallback UI
const ErrorFallback: React.FC<{ error?: Error }> = ({ error }) => {
  return <ErrorFallbackContent error={error} />
}

// Separate component to use hooks
const ErrorFallbackContent: React.FC<{ error?: Error }> = ({ error }) => {
  const { handleHardReset } = useSignout()

  const handleHardResetAndReload = async () => {
    try {
      await handleHardReset()
      // Force a hard reload after logout
      if (typeof window !== 'undefined') {
        window.location.href = '/login'
      }
    } catch (err) {
      console.error('Error during hard reset:', err)
      // Fallback: force reload anyway
      if (typeof window !== 'undefined') {
        window.location.reload()
      }
    }
  }

  const handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground px-4">
      <div className="bg-card shadow-lg rounded-xl p-8 flex flex-col items-center max-w-md w-full">
        <div className="text-6xl mb-4">⚠️</div>
        <h1 className="text-display font-bold mb-2 text-center">Something went wrong</h1>
        <p className="text-muted-foreground mb-4 text-center">
          A critical error occurred that requires a fresh start. We recommend signing out and logging back in.
        </p>
        
        {error && (
          <details className="mb-4 w-full">
            <summary className="text-content text-muted-foreground cursor-pointer hover:text-foreground">
              Error Details
            </summary>
            <pre className="text-meta bg-muted p-2 rounded mt-2 overflow-auto max-h-32">
              {error.message}
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
            onClick={handleReload}
            className="flex-1 bg-primary text-primary-foreground font-semibold py-3 px-4 rounded-lg hover:bg-primary/90 transition"
          >
            Reload Page
          </button>
        </div>
        
        <p className="text-meta text-muted-foreground mt-4 text-center">
          If this problem persists, please contact support.
        </p>
      </div>
    </div>
  )
}

export default RootErrorBoundaryClass 
