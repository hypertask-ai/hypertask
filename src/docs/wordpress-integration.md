# WordPress to Next.js Firebase Authentication Integration

This document provides a complete guide for integrating WordPress Google Sign-in with your Next.js application using Firebase Authentication.

## Overview

The API endpoint `/api/auth/wordpress-signup` allows WordPress users to sign up/login to your Next.js application using Firebase Google Authentication. This maintains consistency with your existing authentication system.

## API Endpoint

**URL:** `POST /api/auth/wordpress-signup`

### Request Body

```typescript
{
  idToken: string           // Required: Firebase ID token from Google Sign-in
  redirectUrl?: string      // Optional: Where to redirect after successful auth
  shouldSkipInteractive?: boolean  // Optional: Skip interactive onboarding (default: false)
  source?: string          // Optional: Source tracking (default: 'wordpress')
}
```

### Response Format

#### Success Response (200)
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

#### Error Response (4xx/5xx)
```typescript
{
  success: false,
  error: string,
  code: string,
  message?: string,
  details?: any
}
```

## WordPress Implementation

### 1. Add Firebase SDK to WordPress

**Important:** Firebase is not installed in WordPress by default. We load it via CDN scripts.

Add this to your WordPress theme's `functions.php` or in a plugin:

```php
function enqueue_firebase_scripts() {
    // Only load on pages where the sign-up button exists
    if (is_page('signup') || is_front_page()) {
        // Load Firebase SDK from CDN - SAME VERSION as your Next.js app (v9.20.0)
        wp_enqueue_script('firebase-app', 'https://www.gstatic.com/firebasejs/9.20.0/firebase-app-compat.js', array(), '9.20.0', true);
        wp_enqueue_script('firebase-auth', 'https://www.gstatic.com/firebasejs/9.20.0/firebase-auth-compat.js', array('firebase-app'), '9.20.0', true);

        
        // Your custom script
        wp_enqueue_script('hypertask-auth', get_template_directory_uri() . '/js/hypertask-auth.js', array('firebase-app', 'firebase-auth'), '1.0.0', true);
        
        // Pass data to JavaScript
        wp_localize_script('hypertask-auth', 'hypertaskAuth', array(
            'apiUrl' => 'https://app.hypertask.ai/api/auth/wordpress-signup',
            'firebaseConfig' => array(
                'apiKey' => 'AIzaSyD1YIaE-4HHzsjRpRYe2rJyeTPMbSENnQc',
                'authDomain' => 'hypertasks-403606.firebaseapp.com',
                'projectId' => 'hypertasks-403606',
                'storageBucket' => 'hypertasks-403606.appspot.com',
                'messagingSenderId' => '992767949049',
                'appId' => '1:992767949049:web:104858eb42536da2f94a28',
                'measurementId' => 'G-WT9Y8VS5P8'
            ),
            'googleClientId' => '992767949049-3ql6a7cep39truv47o2u50ktmi5k2053.apps.googleusercontent.com'
        ));
    }
}
add_action('wp_enqueue_scripts', 'enqueue_firebase_scripts');
```

**How this works:**
1. The CDN scripts load Firebase SDK and make it available as a global `firebase` variable
2. WordPress's `wp_enqueue_script` ensures proper loading order (firebase-app before firebase-auth)
3. Your custom script (`hypertask-auth.js`) depends on these scripts and can use the global `firebase` object

### 2. Create the JavaScript Integration

Create `js/hypertask-auth.js` in your WordPress theme:

```javascript
// Wait for Firebase to be loaded from CDN before initializing
document.addEventListener('DOMContentLoaded', function() {
    // Check if Firebase is loaded
    if (typeof firebase === 'undefined') {
        console.error('Firebase SDK not loaded. Please check your script enqueuing.');
        return;
    }
    
    // Initialize Firebase with your config
    firebase.initializeApp(hypertaskAuth.firebaseConfig);

    class HypertaskAuth {
        constructor() {
            this.auth = firebase.auth();
            this.init();
        }

        init() {
            // Bind event listeners to buttons
            const signInButtons = document.querySelectorAll('.hypertask-signin-btn');
            signInButtons.forEach(button => {
                button.addEventListener('click', this.handleSignInClick.bind(this));
            });
        }

        handleSignInClick(event) {
            event.preventDefault();
            
            // Use Firebase Auth with Google Provider
            const provider = new firebase.auth.GoogleAuthProvider();
            provider.addScope('email');
            provider.addScope('profile');

            this.auth.signInWithPopup(provider)
                .then(this.handleFirebaseSignIn.bind(this))
                .catch(this.handleError.bind(this));
        }

        async handleFirebaseSignIn(result) {
            try {
                const user = result.user;
                const idToken = await user.getIdToken();
                
                console.log('Firebase sign-in successful, sending to Next.js API...');
                
                // Send to your Next.js API
                await this.sendToNextjsAPI(idToken);
                
            } catch (error) {
                this.handleError(error);
            }
        }

        async sendToNextjsAPI(idToken) {
            try {
                const requestData = {
                    idToken: idToken,
                    source: 'wordpress',
                    shouldSkipInteractive: false, // Set to true if you want to skip onboarding
                    redirectUrl: null // Let the API decide based on user status
                };

                const response = await fetch(hypertaskAuth.apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    credentials: 'include', // Important for cookies
                    body: JSON.stringify(requestData)
                });

                const data = await response.json();
                
                if (data.success) {
                    console.log('Authentication successful:', data);
                    // Redirect to the Next.js app
                    window.location.href = data.redirectUrl;
                } else {
                    throw new Error(data.error || 'Authentication failed');
                }

            } catch (error) {
                this.handleError(error);
            }
        }

        handleError(error) {
            console.error('Authentication error:', error);
            alert('Authentication failed: ' + (error.message || 'Please try again.'));
        }
    }

    // Initialize the authentication class
    new HypertaskAuth();
});
```

### 3. Add HTML Button to WordPress

Add this HTML where you want the sign-in button to appear:

```html
<button class="hypertask-signin-btn">
    Sign up with Google
</button>
```

That's it! Style it however you want with your own CSS.

## Environment Variables

Add these environment variables to your Next.js application:

```env
# Add your WordPress site URL for CORS
WORDPRESS_SITE_URL=https://your-wordpress-site.com

# Your Next.js base URL (already exists)
NEXT_PUBLIC_BASEURL=https://app.hypertask.ai
```

## Security Considerations

1. **CORS Configuration**: The API automatically handles CORS for allowed origins
2. **Firebase Token Verification**: All requests are verified using Firebase Admin SDK
3. **Email Verification**: Only verified email addresses are allowed
4. **Rate Limiting**: Consider adding rate limiting for production use

## Testing

1. Test the integration on a staging environment first
2. Verify that users are created correctly in your database
3. Test the redirect flow for both new and existing users
4. Ensure cookies are set properly for authentication

## Important: Version Compatibility

**The WordPress integration uses Firebase v9.20.0 - the EXACT same version as your Next.js app.** This ensures complete compatibility and prevents any version conflicts.

## Troubleshooting

### Common Issues

1. **CORS Errors**: Make sure your WordPress domain is added to the allowed origins
2. **Firebase Configuration**: Verify all Firebase config values are correct
3. **Token Verification Fails**: Check that your service account key is properly configured
4. **Cookies Not Set**: Ensure the request includes credentials and proper headers

### Debug Mode

For debugging, you can add this to your WordPress JavaScript:

```javascript
// Add this to enable debug logging
console.log('Debug mode enabled');
localStorage.setItem('hypertask-debug', 'true');
```

## Support

If you encounter issues:

1. Check the browser console for JavaScript errors
2. Check your Next.js application logs for API errors
3. Verify Firebase configuration and permissions
4. Test with a simple HTML page first to isolate WordPress-specific issues 