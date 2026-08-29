# Complete Email Authentication System

This document provides a comprehensive guide for the email authentication system implemented with Firebase Authentication, including email verification and password reset functionality.

## Overview

The email authentication system provides:
- ✅ **Email/Password Signup** with automatic email verification
- ✅ **Email/Password Login** with verification requirement
- ✅ **Password Reset** via email
- ✅ **Email Verification** flow
- ✅ **Integration** with existing authentication system
- ✅ **Database User Creation** using existing controllers
- ✅ **Cookie Management** matching existing auth flow

## Architecture

### API Routes
- `/api/auth/email-signup` - Handles email signup after Firebase verification
- `/api/auth/password-reset` - Sends password reset emails

### Components
- `EmailSignup` - Complete signup flow with email verification
- `EmailLogin` - Login with email/password and forgot password functionality

### Pages
- `/signup` - Dedicated signup page
- `/login` - Updated to include email authentication options

## Firebase Configuration

### 1. Enable Email Authentication

In your Firebase Console:

1. Go to **Authentication > Sign-in method**
2. Enable **Email/Password** provider
3. Configure **Email Templates** (optional but recommended)

### 2. Email Templates (Recommended)

Configure custom email templates for better branding:

**Email Verification Template:**
```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Verify your email - Hypertask</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
    <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #4285f4;">Welcome to Hypertask!</h1>
        <p>Thanks for signing up! Please verify your email address to get started.</p>
        <a href="%LINK%" style="display: inline-block; padding: 12px 24px; background-color: #4285f4; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0;">
            Verify Email Address
        </a>
        <p>If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">%LINK%</p>
        <p>This link will expire in 24 hours.</p>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="font-size: 12px; color: #666;">
            If you didn't create a Hypertask account, you can safely ignore this email.
        </p>
    </div>
</body>
</html>
```

**Password Reset Template:**
```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Reset your password - Hypertask</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
    <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #4285f4;">Reset Your Password</h1>
        <p>You requested to reset your password for your Hypertask account.</p>
        <a href="%LINK%" style="display: inline-block; padding: 12px 24px; background-color: #4285f4; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0;">
            Reset Password
        </a>
        <p>If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">%LINK%</p>
        <p>This link will expire in 1 hour.</p>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="font-size: 12px; color: #666;">
            If you didn't request a password reset, you can safely ignore this email.
        </p>
    </div>
</body>
</html>
```

### 3. Domain Configuration

Add your domains to Firebase:
1. Go to **Authentication > Settings > Authorized domains**
2. Add your domains:
   - `localhost` (for development)
   - `app.hypertask.ai` (production)
   - Any other domains you use

## User Flow

### Signup Flow
1. User enters email and password on `/signup`
2. Firebase creates user account
3. Verification email sent automatically
4. User clicks verification link in email
5. User returns to app and clicks "I've Verified My Email"
6. System checks verification status
7. If verified, user is authenticated and redirected

### Login Flow
1. User enters email and password on `/login`
2. Firebase authenticates user
3. System checks if email is verified
4. If verified, user is authenticated and redirected
5. If not verified, user is prompted to verify

### Password Reset Flow
1. User clicks "Forgot Password" on login page
2. User enters email address
3. Password reset email sent via Firebase
4. User clicks reset link in email
5. User sets new password on Firebase page
6. User can now login with new password

## API Endpoints

### POST /api/auth/email-signup

Handles user creation after Firebase authentication.

**Request Body:**
```typescript
{
  idToken: string           // Firebase ID token
  redirectUrl?: string      // Optional redirect URL
  shouldSkipInteractive?: boolean  // Skip onboarding
  source?: string          // Source tracking
}
```

**Response:**
```typescript
{
  success: true,
  user: {
    id: number,
    email: string,
    displayName: string,
    photoURL: string,
    uid: string
  },
  isNewUser: boolean,
  redirectUrl: string,
  message: string
}
```

### POST /api/auth/password-reset

Sends password reset email.

**Request Body:**
```typescript
{
  email: string            // User email
  continueUrl?: string     // Optional return URL
}
```

**Response:**
```typescript
{
  success: true,
  message: string,
  email: string           // Masked email
}
```

## Component Usage

### EmailSignup Component

```tsx
import EmailSignup from '@/components/Auth/EmailSignup'

<EmailSignup
  onSuccess={(user) => console.log('User signed up:', user)}
  onError={(error) => console.error('Signup error:', error)}
  redirectUrl="/dashboard"
  shouldSkipInteractive={false}
/>
```

### EmailLogin Component

```tsx
import EmailLogin from '@/components/Auth/EmailLogin'

<EmailLogin
  onSuccess={(user) => console.log('User logged in:', user)}
  onError={(error) => console.error('Login error:', error)}
  redirectUrl="/dashboard"
  shouldSkipInteractive={false}
/>
```

## Error Handling

### Common Error Codes

**Signup Errors:**
- `auth/email-already-in-use` - Email already registered
- `auth/invalid-email` - Invalid email format
- `auth/weak-password` - Password too weak
- `auth/operation-not-allowed` - Email auth disabled

**Login Errors:**
- `auth/user-not-found` - No account with this email
- `auth/wrong-password` - Incorrect password
- `auth/user-disabled` - Account disabled
- `auth/too-many-requests` - Too many failed attempts

**Password Reset Errors:**
- `auth/user-not-found` - No account with this email (hidden for security)
- `auth/invalid-email` - Invalid email format
- `auth/too-many-requests` - Too many reset requests

### Error Messages

The system provides user-friendly error messages:
- Technical errors are logged to console
- User-facing messages are clear and actionable
- Security-sensitive errors (like user-not-found) are masked

## Security Features

### Email Verification Required
- Users must verify their email before accessing the app
- Unverified users cannot sign in
- Verification status is checked on every login

### Password Requirements
- Minimum 6 characters (Firebase default)
- Can be customized with additional validation

### Rate Limiting
- Firebase provides built-in rate limiting
- Password reset requests are limited
- Failed login attempts are tracked

### Token Security
- Firebase ID tokens are verified server-side
- Tokens expire automatically
- Secure cookie configuration

## Integration with Existing System

### Database Integration
- Uses existing `updateUsers` controller
- Creates users in your Prisma database
- Maintains compatibility with existing user model

### Cookie Management
- Sets same cookies as Google auth (`nookies_user`, `theme`)
- Same expiration times (1 week)
- Compatible with existing middleware

### Redirect Logic
- New users → `/interactive-onboarding`
- Existing users → `/` (dashboard)
- Custom redirects supported

## Environment Variables

No additional environment variables needed. Uses existing:
- `NEXT_PUBLIC_BASEURL` - Your app URL
- Firebase config from `src/firebase.ts`

## Testing

### Test Signup Flow
1. Go to `/signup`
2. Enter valid email and password
3. Check email for verification link
4. Click verification link
5. Return to app and click "I've Verified My Email"
6. Should be authenticated and redirected

### Test Login Flow
1. Go to `/login`
2. Enter registered email and password
3. Should be authenticated and redirected

### Test Password Reset
1. Go to `/login`
2. Click "Forgot your password?"
3. Enter email address
4. Check email for reset link
5. Click reset link and set new password
6. Login with new password

## Monitoring

### Logs to Monitor
- `✅ User created in Firebase` - Successful signup
- `✅ Verification email sent` - Email sent
- `✅ Email verified` - User verified email
- `✅ User authenticated successfully` - Complete auth flow
- `❌ Signup error` - Failed signup
- `❌ Login error` - Failed login

### Firebase Console
- Monitor authentication events
- View user accounts
- Check email delivery status
- Monitor error rates

## Troubleshooting

### Common Issues

1. **Verification Email Not Received**
   - Check spam folder
   - Verify email address is correct
   - Check Firebase email delivery logs

2. **Email Already in Use**
   - User should use login instead of signup
   - Or use password reset if they forgot password

3. **Email Not Verified Error**
   - User needs to check email and click verification link
   - Can resend verification email

4. **Password Reset Not Working**
   - Check if email exists in system
   - Verify reset link hasn't expired (1 hour)
   - Check Firebase console for delivery issues

### Debug Mode

Enable debug logging:
```javascript
// In browser console
localStorage.setItem('debug', 'true')
```

This will show additional console logs for troubleshooting.

## Production Considerations

### Email Deliverability
- Configure proper SPF/DKIM records
- Consider custom SMTP provider for better deliverability
- Monitor email bounce rates

### Rate Limiting
- Firebase provides basic rate limiting
- Consider additional rate limiting for your API endpoints
- Monitor for abuse patterns

### User Experience
- Clear error messages
- Loading states during async operations
- Mobile-responsive design
- Accessibility considerations

### Analytics
- Track signup/login conversion rates
- Monitor email verification rates
- Track password reset usage

## Future Enhancements

### Potential Improvements
- **Social Login Integration** - Add more providers
- **Two-Factor Authentication** - SMS or authenticator app
- **Email Templates** - More customized branding
- **Advanced Password Requirements** - Complexity rules
- **Account Linking** - Link email accounts to existing social accounts
- **Bulk Email Management** - Admin tools for managing users

### API Extensions
- User profile management endpoints
- Email change with verification
- Account deletion with confirmation
- Admin user management APIs 