'use client'
 
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
    console.error(error)
  }, [error])
 
  return (
    <div className='fixed h-full w-full flex items-center justify-center gap-2 flex-col'>
      <h1 className='text-heading'>Something went wrong!</h1>
      <button
      className='btn btn-primary'
        onClick={
          () => router.replace("/")
        }
      >
        Go to previous board
      </button>
      <button
      className='btn btn-danger'
        onClick={
          () => reset()
        }
      >
        Try again!
      </button>
    </div>
  )
}
