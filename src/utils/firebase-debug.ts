import { logger as htLogger } from "#logger";
export const debugFirebaseConfig = async () => {
  const { app } = await import('@/firebase')
  htLogger.info('🔍 Firebase Debug Info:')
  htLogger.info('- App Name:', app.name)
  htLogger.info('- Project ID:', app.options.projectId)
  htLogger.info('- Auth Domain:', app.options.authDomain)
  htLogger.info('- API Key:', app.options.apiKey ? 'Present' : 'Missing')
}

export const checkEmailSettings = () => {
  htLogger.info('📧 Email Link Configuration Check:')
  htLogger.info('- Make sure Email/Password is enabled in Firebase Console')
  htLogger.info('- Enable Email Link (passwordless sign-in) in Firebase Console > Authentication > Sign-in method')
  htLogger.info('- Add authorized domains: localhost, app.hypertask.ai in Firebase Console > Authentication > Settings')
  htLogger.info('- Check Firebase Console > Authentication > Templates for email templates')
  htLogger.info('- Check spam folder for sign-in link emails')
  htLogger.info('- Ensure action code settings URL matches your domain')
}
