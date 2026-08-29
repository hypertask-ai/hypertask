import admin from 'firebase-admin'
import { getFirebaseServiceAccount } from '@/lib/firebaseServiceAccount'

// Centralized Firebase Admin initialization to avoid conflicts
let firebaseAdminApp: admin.app.App

export function getFirebaseAdmin(): admin.app.App {
  if (!firebaseAdminApp) {
    try {
      // Check if app already exists
      firebaseAdminApp = admin.app()
    } catch {
      // Initialize if it doesn't exist
      const serviceAccount = getFirebaseServiceAccount()

      console.log(`🔥 Initializing Firebase Admin for project: ${serviceAccount.project_id}`)
      
      firebaseAdminApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: serviceAccount.project_id,
          clientEmail: serviceAccount.client_email,
          privateKey: serviceAccount.private_key,
        }),
        projectId: serviceAccount.project_id,
      })
      
      console.log(`✅ Firebase Admin initialized successfully for project: ${firebaseAdminApp.options.projectId}`)
    }
  }
  
  return firebaseAdminApp
}

export function getAuth() {
  return getFirebaseAdmin().auth()
}

// Debug function to check Firebase configuration
export function debugFirebaseAdmin() {
  const app = getFirebaseAdmin()
  return {
    projectId: app.options.projectId,
    clientEmail: (app.options.credential as any)?.clientEmail,
    hasPrivateKey: !!(app.options.credential as any)?.privateKey,
    appName: app.name,
  }
} 