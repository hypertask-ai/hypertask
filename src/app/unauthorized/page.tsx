"use client"
import { showBoardManagerAtom } from '@/store';
import { getFirstProject } from '@/utils/api/Homepage';
import { getViewFromProject } from '@/utils/helperFunctions/Views/ViewsHelperFunctions';
import Head from 'next/head'
import { useRouter } from 'next/navigation';
import { CircleAlert } from 'lucide-react';
import { useRecoilState } from '@/lib/state';
import { useEffect } from 'react';
  

const Unauthorized = () => {
    const [, setShowBoardManager] = useRecoilState(showBoardManagerAtom);
    useEffect(() => {
        setShowBoardManager(false)
    }, [setShowBoardManager])
    const router = useRouter()
    const goBacktoPrevious = async()=>{
        const response = await getFirstProject()
        const activeView = getViewFromProject(response?.data)
        let view;
        if(activeView && activeView.type === "Applied")  view = activeView.view.slug
        // router.replace(`/project?id=${response?.data?.id}`)
        router.replace(`/project?id=${response?.data?.id}${view?`&view=${view}`:''}`)
    }
    
    return (
    <>
            <Head>
                <title>Board unavailable</title>
            </Head>
            <main className="flex min-h-SVH-full w-full items-center justify-center bg-pageBackground px-6 text-white-black">
                <section
                    aria-describedby="unauthorized-description"
                    aria-labelledby="unauthorized-title"
                    className="flex w-full max-w-[560px] flex-col items-center rounded-[4px] bg-cardBackground px-6 py-8 text-center shadow-md sm:px-10"
                >
                    <CircleAlert
                        aria-hidden="true"
                        className="h-16 w-16 text-text-light-gray"
                        strokeWidth={1.75}
                    />
                    <h1
                        id="unauthorized-title"
                        className="mt-5 text-[20px] font-semibold"
                    >
                        This board or ticket is unavailable
                    </h1>
                    <p
                        id="unauthorized-description"
                        className="mt-2 max-w-[420px] text-[14px] text-text-light-gray"
                    >
                        It may have been deleted or archived, or you may not have access to it.
                    </p>
                    <p className="mt-2 max-w-[420px] text-[14px] text-text-light-gray">
                        If you should have access, ask a board member to invite you.
                    </p>
                    <button
                        type="button"
                        onClick={goBacktoPrevious}
                        className="mt-6 inline-flex min-h-10 items-center justify-center rounded-[4px] bg-hypertasks-purple px-4 py-2 text-[14px] font-medium text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selected-item-border"
                    >
                        Return to previous board
                    </button>
                </section>
            </main>
    </>
  )
}

export default Unauthorized
