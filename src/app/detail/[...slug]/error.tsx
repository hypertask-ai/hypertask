'use client' // Error components must be Client Components
 
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
 
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router=useRouter()
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error)
  }, [error])
 
  return (
    <div className='fixed h-full w-full flex items-center justify-center gap-2 flex-col'>
      <h1 className='text-heading'>Something went wrong!</h1>
      <button
      className='btn btn-primary'
        onClick={
          // Attempt to recover by trying to re-render the segment
          () => router.replace("/")
        }
      >
        Go to previous board
      </button>
      <button
      className='btn btn-danger'
        onClick={
          // Attempt to recover by trying to re-render the segment
          () => reset()
        }
      >
        Try again!
      </button>
    </div>
  )
}
