'use client'
import { useEffect } from 'react'
import useCurrentUserCheckFromCookies from '@/hooks/General/useCurrentUserCheckFromCookies'
import { useRouter } from 'next/navigation'
import PurchasePlanModal from '@/components/Modals/PurchasePlan'
import { canAccessTrialPage } from '@/utils/helperFunctions/helperFunctions'

const TrialPage = () => {
  const currentUser = useCurrentUserCheckFromCookies()
  const router = useRouter()

  return (
    <>
      <PurchasePlanModal
            currentUser={currentUser}
            callback={() => {
              if (window.history.length > 1) router.back()
              else router.push('/')
            }}
          />
    </>
  )
}

export default TrialPage
