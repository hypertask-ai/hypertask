  // ==================== SETTINGS SCREEN
import { useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "reactstrap";
import { Button } from "reactstrap";
import { convertTimestampToFormattedDate } from "@/utils/helperFunctions/helperFunctions";
import type { InvoiceWithCardDetails, UpcomingInvoice } from "@/lib/subscription";
import { ITeam } from "@/models/model";
import toast from "react-hot-toast";
import LoadingSpinner1 from "@/components/LoadingSpinners/LoadingSpinner1";
import Stripe from "stripe";

  const SettingsScreen = ({
    team,
    refetch,
    upcomingInvoices,
    customer,
    invoices
  }:{
    team:ITeam;
    invoices: InvoiceWithCardDetails[];
    upcomingInvoices:Stripe.Response<UpcomingInvoice>|null
    refetch:()=>void;
    customer:Stripe.Response<Stripe.Customer>;

  })=>{
    const [changeTeamNameModalShow, setChangeTeamNameModalShow] = useState(false);
    const [title, setTitle] = useState(team.title)
    const [confirmingCancel, setConfirmingCancel] = useState<boolean>(false)
    const [confirmCancelSubscription, setConfirmCancelSubscription] = useState<boolean>(false);
    const router = useRouter()



    const onKeyChange = (e: any) => {
        setTitle(e.target.value);
    }
    const toggleTeamNameChange = ()=>{
      setChangeTeamNameModalShow((prev)=>!prev)
    }

    const confirmNameChange = async()=>{
        try {
          const response = await axios.post("/api/teams/changeTeamName",{
            updatedTitle:title, teamId:team.id
          })
          console.log("🚀 ~ file: Pricing.tsx:758 ~ confirmNameChange ~ response:", response)
          refetch()
          setChangeTeamNameModalShow(false)
        } catch (error) {

          console.log(error)
        }
    }

    // ===================== toggle confirmation modal
    const toggleConfirmationModal = ()=>{
      setConfirmCancelSubscription((prev)=>!prev)
    }
    // ===================== confirm cancel 
    const confirmCancel = async()=>{
      setConfirmingCancel(true)
      try {
        
        const response = await axios.post("/api/stripe/cancelSubscription",{
          stripe_customer_id:team.stripe_customer_id,
        })

        setConfirmCancelSubscription(false)
        router.refresh()
        if (response.status===200) toast("Successfully switched to Free Plan");


      } catch (error) {
        console.log("🚀 ~ file: Pricing.tsx:305 ~ confirmCancel ~ error:", error)
        
      }
      // 
      setConfirmingCancel(false)

    }

    return(
      <>
        <div className="min-w-[683px] pl-4 mt-[2.5rem]">

          {/* =============== TEAM NAME ===============  */}
          <div className="flex flex-col  pb-8">
            <h2 className="text-heading font-semibold">Team Name</h2>
            
            {/* =============== change team name =========== */}
            <div className="flex gap-[6rem] py-2 text-content font-medium">
                <span>Name</span> 
                <span>{team.title}</span>
                <span onClick={toggleTeamNameChange} className="text-[#8c9aea] cursor-pointer font-bold">Change Team Name</span> {/* Add the change button here and a modal to get the info and confirm the changes.  */}
            </div>
          </div>


          {/* ================== PAYMENT & BILLING  ================== */}
          <div className="flex flex-col">
            <h2 className="text-heading mb-[22px] font-semibold"> Payment & Billing</h2>
            
            {
              team.activeSubscriptionPlanId ?
                <>
                  <div className={`flex gap-5 py-2 text-content font-medium`}>
                    <span className="w-[120px] whitespace-nowrap">Payment Methods</span>
                    <span className="capitalize">{invoices.length>0?invoices[0].cardDetails?.type:"Free Plan"}</span>
                  </div>

                  {/* ============= billing interval */}
                  <div className={`flex gap-5 py-2 text-content font-medium`}>
                    <span className="w-[120px]">Billing Cycle</span>
                    <span className="capitalize">{team.subscriptionPlan?team.subscriptionPlan[0].interval:"Free Plan"}</span>
                  </div>

                  {/* ============= Renewal at */}
                  <div className={`flex gap-5 py-2 text-content font-medium`}>
                    <span className="w-[120px]">Renewal</span>
                    <span>{upcomingInvoices?convertTimestampToFormattedDate(upcomingInvoices.created):"Free Plan"}</span>
                  </div>

                  {/* ============= Billing Contact */}
                  <div className={`flex gap-5 py-2 text-content font-medium`}>
                    <span className="w-[120px]">Billing Contact</span>
                    <span>{customer.email?customer.email:"Not added yet"}</span>
                  </div>

                  {/* ============= Cancel Plan */}
                  <div className={`flex gap-5 py-2 `}>
                    <span className="w-[120px]">Cancel plan</span>
                    <span className="w-[180px]"></span>
                    <span
                      onClick={toggleConfirmationModal}    
                      className="text-[#8c9aea] cursor-pointer font-bold">Cancel</span>
                  </div>
                </>
              :
                <>
                  <span>
                    Free Plan
                  </span>
                </>
            }
          </div>
        </div>

        <>
        {/* ================================ change team modal ================== */}
          {
          changeTeamNameModalShow && 
            <Modal  fade={false} isOpen={changeTeamNameModalShow} toggle={toggleTeamNameChange} 
                className="rounded-sm customshadow-4 w-[680px] max-h-[400px] top-[26%]">
              <ModalHeader className="text-center border-transparent  bg-[#333B47] rounded-tl-sm rounded-tr-sm " >
            
                <h2 className="px-2
                ">Change Team name</h2>

              </ModalHeader>
      
              <ModalBody className="  bg-[#333B47] ">
                <input
                    autoFocus
                    className="py-2 px-2 text-emphasis h-[40px] w-full text-white bg-transparent border-0 outline-none font-medium"
                    onChange={onKeyChange}
                    value={title}
                    placeholder="New team name"
                    onKeyDown={e => {
                        if (e.key === 'Enter') {
                          confirmNameChange()
                        }
                    }}
                />
              </ModalBody>
              
              <ModalFooter className="bg-[#333B47] rounded-bl-sm rounded-br-sm "> 
                <Button className="rounded-sm" color="secondary" onClick={()=>setChangeTeamNameModalShow(false)}>Cancel</Button>{' '}
                <Button className="rounded-sm" color="danger" onClick={confirmNameChange}>Confirm</Button>
              </ModalFooter>
          </Modal>
          }
        </>
        {
            confirmCancelSubscription && 
            <Modal isOpen={confirmCancelSubscription} toggle={toggleConfirmationModal} className="rounded-sm bg-[#333B47] top-[26%]">
              {
                !confirmingCancel?
                  <>
                  <ModalHeader className="text-center border-transparent  bg-[#333B47] rounded-tl-sm rounded-tr-sm border-b-2 " toggle={toggleConfirmationModal}>

                    <h2 className="text-subheading font-bold">Are you sure you want to cancel?</h2>

                  </ModalHeader>
                  <hr className=" w-full bg-[#777C85] h-[1px] "/>

                  <ModalBody className="border-transparent  bg-[#333B47] ">
                    <p>
                      This will cancel your current plan immediately and switch you to the Free Plan.  
                    </p>
                    <p className="my-2">
                      This action is irreversible.
                    </p>
                  </ModalBody>
                  
                  <ModalFooter className="bg-[#333B47] rounded-bl-sm rounded-br-sm "> 
                    <Button className="rounded-sm" color="secondary" onClick={toggleConfirmationModal}>Cancel</Button>{' '}
                    <Button className="rounded-sm" color="danger" onClick={confirmCancel}>Confirm</Button>
                  </ModalFooter>
                  </>

                  :
                  // ================== add loader here
                  <>
                    <ModalBody className="bg-[#333B47] items-center gap-3 flex flex-col">
                      <p className="font-bold">
                        Switching you to the Free Plan. Please Wait!
                      </p>
                      <LoadingSpinner1/>

                    </ModalBody>
                  </>
              }
          </Modal>
          }
      </>
      // ============ main container
    )
  }

export default SettingsScreen;
