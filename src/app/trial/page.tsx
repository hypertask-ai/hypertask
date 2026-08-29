'use client'
import { useEffect } from 'react'
import useCurrentUserCheckFromCookies from '@/hooks/General/useCurrentUserCheckFromCookies'
import { useRouter } from 'next/navigation'
import PurchasePlanModal from '@/components/Modals/PurchasePlan'
import { canAccessTrialPage } from '@/utils/helperFunctions/helperFunctions'

const TrialPage = () => {
  const currentUser = useCurrentUserCheckFromCookies()
  const router = useRouter()

  // useEffect(() => {
  //   if (currentUser && !canAccessTrialPage(currentUser)) {
  //     console.log('🔄 User not eligible for trial upgrade page, redirecting away from trial page')
  //     router.replace('/')
  //   }
  // }, [currentUser, router])
  
  // if (!currentUser || !canAccessTrialPage(currentUser)) {
  //   return null
  // }
  
  return (
    <>
      <PurchasePlanModal
            currentUser={currentUser}
            // HTPR-4839: closing the plans always lands on the free board, even
            // on a direct /trial visit with no history to go back to.
            callback={() => {
              if (window.history.length > 1) router.back()
              else router.push('/')
            }}
          />
    </>
  )
}

export default TrialPage
