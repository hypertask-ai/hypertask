import { IProject } from "@/models/model"
import { constructPricingPageUrl } from "@/utils/helperFunctions/helperFunctions"
import { useRouter } from "next/navigation"
import { useState } from "react"

const useTrialModal = (project: IProject|null)=>{
    const router = useRouter()
    const [showTrial, setShowTrial] = useState(false) 
    const redirectToManageSubscriptions = () => {
      setShowTrial(prev=>!prev)
      if (project?.team.team_activity.hasCompletedTrial)router.push(constructPricingPageUrl(project, "Upgrade"))
      
    }
    return {
      setShowTrial, showTrial, redirectToManageSubscriptions
    }
  }


export default useTrialModal