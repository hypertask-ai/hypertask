"use client"
import { currentUserAtom, showAccountSwitcherAtom, showBoardManagerAtom } from '@/store';
import { useFlag } from '@/hooks/useFlag';
import { rememberTicketAccountSwitch, TICKET_ACCOUNT_SWITCH_CHOOSE, ticketDetailLocator } from '@/lib/auth/ticketDetailLocator';
import { HTPR_7799_PROJECT_ENTRY_FLAG } from '@/lib/flags/keys';
import { HTPR_9621_AUTO_SWITCH_ACCOUNT_FLAG } from '@/lib/flags/definitions/htpr-9621-auto-switch-account';
import { getFirstProject } from '@/utils/api/Homepage';
import { returnToFirstBoard } from '@/lib/firstScreen/returnToFirstBoard';
import { useSignout } from '@/hooks/MultiPages/HTC/useSignout';
import Head from 'next/head'
import { usePathname, useRouter } from 'next/navigation';
import { CircleAlert } from 'lucide-react';
import { useRecoilState, useRecoilValue, useSetRecoilState } from '@/lib/state';
import { useEffect } from 'react';
  

const Unauthorized = () => {
    const [, setShowBoardManager] = useRecoilState(showBoardManagerAtom);
    const currentUser = useRecoilValue(currentUserAtom);
    const setShowAccountSwitcher = useSetRecoilState(showAccountSwitcherAtom);
    const projectEntryEnabled = useFlag(HTPR_7799_PROJECT_ENTRY_FLAG);
    const autoSwitchAccount = useFlag(HTPR_9621_AUTO_SWITCH_ACCOUNT_FLAG);
    const pathname = usePathname() ?? "";
    useEffect(() => {
        setShowBoardManager(false)
    }, [setShowBoardManager])
    useEffect(autoSwitchAccount ? () => {
        const locator = ticketDetailLocator(pathname);
        if (!locator) return;
        const choose = document.cookie.split("; ").includes(`${TICKET_ACCOUNT_SWITCH_CHOOSE}=choose`);
        if (choose) {
            document.cookie = `${TICKET_ACCOUNT_SWITCH_CHOOSE}=; Max-Age=0; Path=/`;
            rememberTicketAccountSwitch(pathname);
            setShowAccountSwitcher(true);
            return;
        }
        const attemptKey = `ticket-account-switch:${pathname}`;
        if (window.sessionStorage.getItem(attemptKey)) return;
        window.sessionStorage.setItem(attemptKey, "1");
        const form = document.createElement("form");
        form.method = "POST";
        form.action = "/api/auth/ticket-account-switch";
        for (const [name, value] of [["projectSlug", locator.projectSlug], ["uniqueIndex", locator.uniqueIndex]] as const) {
            const input = document.createElement("input");
            input.type = "hidden";
            input.name = name;
            input.value = value;
            form.append(input);
        }
        document.body.append(form);
        form.submit();
    } : () => {}, [autoSwitchAccount, pathname, setShowAccountSwitcher]);
    const router = useRouter()
    const { handleHardReset } = useSignout()
    const goBacktoPrevious = () => returnToFirstBoard({
        getFirstProject,
        navigate: (url) => router.replace(url),
        signOut: handleHardReset,
    })
    
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
                    {projectEntryEnabled && currentUser?.email && (
                        <>
                            <p className="mt-4 max-w-full break-all text-content text-text-light-gray">
                                Signed in as {currentUser.email}
                            </p>
                            <button
                                type="button"
                                onClick={() => {
                                    if (autoSwitchAccount) rememberTicketAccountSwitch(pathname);
                                    setShowAccountSwitcher(true);
                                }}
                                className="mt-2 inline-flex min-h-11 items-center justify-center rounded-[4px] px-4 py-2 text-content font-medium text-text-light-gray transition hover:bg-hover-active hover:text-white-black focus-visible:bg-hover-active focus-visible:text-white-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selected-item-border"
                            >
                                Switch account
                            </button>
                        </>
                    )}
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
