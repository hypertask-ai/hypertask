import update_or_create_user from '@/utils/controllers/users/update_or_create_user'
import { IProject, ITaskShare } from '@/models/model'
import nookies from 'nookies'
import { slimUserForCookie } from '@/lib/auth/slimUserCookie'
import { getThemeCookieOptions } from '@/lib/auth/themeCookie'
import authConfig from '@/lib/configs/auth.config'
import { themeCookieSeedValue } from '@/lib/themePreferences'

export interface AuthUser {
  uid: string
  email: string
  displayName?: string | null
  photoURL?: string | null
}

export interface AuthResult {
  success: boolean
  user?: any
  redirectUrl?: string
  error?: string
}

export class AuthService {
  static async completeAuthentication(
    firebaseUser: AuthUser,
    shouldSkipInteractive: boolean = false,
    currentBrowserUrl?: string,
    source: 'google' | 'email_link' | 'email_code' = 'google',
    requestBaseUrl: string = (typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'))
  ): Promise<AuthResult> {
    
    try {
      console.log(`🔐 Starting authentication flow for ${firebaseUser.email} (source: ${source})`)

      const userUpdateResult = await update_or_create_user(
        firebaseUser.email,
        {
          uid: firebaseUser.uid,
          displayName: firebaseUser.displayName || firebaseUser.email.split('@')[0],
          photoURL: firebaseUser.photoURL,
        },
        shouldSkipInteractive
      )

      if (userUpdateResult.status !== 200) {
        console.error('❌ User update failed:', userUpdateResult)
        return {
          success: false,
          error: 'Failed to update user data'
        }
      }

      const userData = userUpdateResult.res.user
      if (!userData) {
        console.error('❌ User data not found in response')
        return {
          success: false,
          error: 'User data not found'
        }
      }
      
      console.log(`✅ User updated successfully (${source}):`, {
        id: userData.id,
        email: userData.email,
        displayName: userData.displayName,
        onboardingTourStatus: (userData as any).UserSetting?.onboardingTourStatus,
        trialStatus: (userData as any).UserSetting?.trialStatus,
        isNewUser: userUpdateResult.res.isNewUser
      })

      const prevBoard = await this.getProjects(userData.id, requestBaseUrl)
      console.log(`📋 User projects fetched (${source}):`, prevBoard)

      const redirectUrl = this.getRedirectUrl(userData, prevBoard, false)
      console.log(`🔄 Redirect URL calculated (${source}):`, redirectUrl)

      return {
        success: true,
        user: userData,
        redirectUrl
      }

    } catch (error) {
      console.error(`❌ Authentication failed (${source}):`, error)
      return {
        success: false,
        error: 'Authentication failed'
      }
    }
  }

  static async setClientAuthCookies(
    userData: any,
    prevBoard?: IProject,
    view?: string
  ): Promise<void> {
    if (prevBoard?.id) {
      nookies.set(null, 'previousBoard', `project-${prevBoard.id}|&|${view || ''}`, {
        maxAge: 600 * 60 * 24 * 7,
        path: '/',
      })
    }

    const existingTheme = nookies.get(null)[authConfig.cookies.theme]
    const themeToSeed = themeCookieSeedValue(existingTheme)
    if (themeToSeed) {
      nookies.set(
        null,
        authConfig.cookies.theme,
        themeToSeed,
        getThemeCookieOptions()
      )
    }

    nookies.set(null, 'nookies_user', JSON.stringify(slimUserForCookie(userData)), {
      maxAge: 600 * 60 * 24 * 7,
      path: '/',
    })

    console.log('✅ Client authentication cookies set successfully')
  }

  private static async getProjects(
    userId: number,
    baseUrl: string = (typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'))
  ): Promise<IProject | undefined> {
    try {
      const response = await fetch(`${baseUrl}/api/projects/getAll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId }),
      })
      
      if (response.ok) {
        const data: IProject[] = await response.json()
        return data[0]
      }
    } catch (error) {
      console.error('❌ Error fetching projects:', error)
    }
    
    return undefined
  }

  private static getRedirectUrl(
    user: any,
    prevBoard: any,
    isMobile: boolean,
    view?: string,
    sharedTask?: ITaskShare
  ): string {
    const { onboardingTourStatus } = user?.UserSetting || {}
    console.log('🔄 getRedirectUrl - onboardingTourStatus:', onboardingTourStatus)

    const getSharedTaskUrl = () =>
      sharedTask
        ? `/detail/project-${sharedTask.projectId}/${sharedTask.task?.uniqueIndex}`
        : ""

    const getProjectUrl = () =>
      `/project?id=${prevBoard?.id}${view ? `&view=${view}` : ""}`

    if (onboardingTourStatus) {
      return sharedTask ? getSharedTaskUrl() : getProjectUrl()
    }

    return `/onboarding?projectId=${prevBoard?.id}&teamTitle=${
      prevBoard?.team?.title || 'MyTeam'
    }&id=${prevBoard?.team?.id || ''}${sharedTask ? `&shareId=${sharedTask.id}` : ""}`
  }
}
