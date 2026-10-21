import { cert, getApp, initializeApp, type App } from 'firebase-admin/app'
import { getAuth as getFirebaseAuth } from 'firebase-admin/auth'
import { getFirebaseServiceAccount } from '@/lib/firebaseServiceAccount'

let firebaseAdminApp: App | undefined

export function getFirebaseAdmin(): App {
  if (firebaseAdminApp) return firebaseAdminApp

  try {
    firebaseAdminApp = getApp()
    return firebaseAdminApp
  } catch {
  }

  const serviceAccount = getFirebaseServiceAccount()

  console.log(`🔥 Initializing Firebase Admin for project: ${serviceAccount.project_id}`)

  try {
    firebaseAdminApp = initializeApp({
      credential: cert({
        projectId: serviceAccount.project_id,
        clientEmail: serviceAccount.client_email,
        privateKey: serviceAccount.private_key,
      }),
      projectId: serviceAccount.project_id,
    })
  } catch (initializationError) {
    try {
      firebaseAdminApp = getApp()
    } catch {
      throw initializationError
    }
  }

  console.log(`✅ Firebase Admin initialized successfully for project: ${firebaseAdminApp.options.projectId}`)
  return firebaseAdminApp
}

export function getAuth() {
  return getFirebaseAuth(getFirebaseAdmin())
}

export function debugFirebaseAdmin() {
  const app = getFirebaseAdmin()
  return {
    projectId: app.options.projectId,
    clientEmail: (app.options.credential as any)?.clientEmail,
    hasPrivateKey: !!(app.options.credential as any)?.privateKey,
    appName: app.name,
  }
}
