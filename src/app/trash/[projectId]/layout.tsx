"use client"
import globalConstants from "@/lib/constants"
import BackButton from '@/components/Buttons/BackButton'

export default function DashboardLayout({
    children, // will be a page or nested layout
  }: {
    children: React.ReactNode
  }) {
    return (
      <div className={`h-[100vh] bg-[${globalConstants.pageBackground}]`}>
        {/* Include shared UI here e.g. a header or sidebar */}
   
        {children}
        <BackButton/>
      </div>
    )
  }