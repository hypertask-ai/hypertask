"use client"
import globalConstants from "@/lib/constants"
import BackButton from '@/components/Buttons/BackButton'

export default function DashboardLayout({
    children,
  }: {
    children: React.ReactNode
  }) {
    return (
      <div className={`h-[100vh] bg-[${globalConstants.pageBackground}]`}>
   
        {children}
        <BackButton/>
      </div>
    )
  }