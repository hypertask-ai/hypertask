import { currentUserAtom } from '@/store';
import { parseCookies } from 'nookies';
import { useRecoilState } from '@/lib/state';
import nookies from 'nookies';


const useFunnelCookies = () => {
    const [currentUser] = useRecoilState(currentUserAtom);

    const cookies = parseCookies();
    const isFunnelUser = cookies.is_funnel_user === 'true' || cookies.funnel === 'true';
    const funnelTutorialCompleted = cookies.funnel_tutorial_completed === 'true';
    const isLoggedIn = !!currentUser;

    const markTutorialCompleted = () => {
        nookies.set(null, 'funnel_tutorial_completed', 'true', {
                maxAge: 60 * 60 * 24 * 30, // 30 days
                path: '/',
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax'
              });
    }

    return {
        isFunnelUser,
        isFunnelUserAndTutorialCompleted:funnelTutorialCompleted,
        isLoggedIn,
        isFunnelUserAndNotCompleted: isFunnelUser && !funnelTutorialCompleted && !currentUser,
        markTutorialCompleted
    }

}

export default useFunnelCookies