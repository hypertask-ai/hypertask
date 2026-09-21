export const debugFirebaseConfig = async () => {
  const { app } = await import('@/firebase')
  console.log('🔍 Firebase Debug Info:')
  console.log('- App Name:', app.name)
  console.log('- Project ID:', app.options.projectId)
  console.log('- Auth Domain:', app.options.authDomain)
  console.log('- API Key:', app.options.apiKey ? 'Present' : 'Missing')
}

export const checkEmailSettings = () => {
  console.log('📧 Email Link Configuration Check:')
  console.log('- Make sure Email/Password is enabled in Firebase Console')
  console.log('- Enable Email Link (passwordless sign-in) in Firebase Console > Authentication > Sign-in method')
  console.log('- Add authorized domains: localhost, app.hypertask.ai in Firebase Console > Authentication > Settings')
  console.log('- Check Firebase Console > Authentication > Templates for email templates')
  console.log('- Check spam folder for sign-in link emails')
  console.log('- Ensure action code settings URL matches your domain')
}
