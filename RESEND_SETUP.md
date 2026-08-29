# Resend email setup

## Environment variables

Add these to your `.env.local` file:

```bash
# Resend Configuration
RESEND_API_KEY=your_resend_api_key_here
EMAIL_FROM=noreply@hypertask.ai
RESEND_WEBHOOK_SECRET=whsec_your_webhook_secret
RESEND_INBOUND_DOMAIN=reply.hypertask.ai
```

## Sending setup

1. **Create a Resend account**
   - Go to [resend.com](https://resend.com)
   - Sign up for an account

2. **Get an API key**
   - Go to API Keys
   - Create and copy a new API key

3. **Verify the sender domain**
   - Go to Domains
   - Verify the domain used by `EMAIL_FROM`

4. **Test the integration**
   - Enter your email in the login form
   - Check your inbox for the sign-in link
   - Click the link to test authentication

## Inbound reply setup

Notification emails use a signed address such as `reply+<task>.<user>.<day>.<signature>@reply.hypertask.ai` once both inbound variables are configured. The signed address is the authorization proof delivered to that mailbox. A reply becomes a comment only when the sender also matches the Hypertask account and still has access to the task. The address carries the day it was issued and stops working after 60 days, so a forwarded or leaked notification cannot post comments indefinitely.

1. Enable receiving on `reply.hypertask.ai` in Resend and add the required MX record.
2. Add a webhook for `email.received` at `https://app.hypertask.ai/api/webhooks/resend-inbound`.
3. Copy its signing secret into `RESEND_WEBHOOK_SECRET`.
4. Set `RESEND_INBOUND_DOMAIN` to the exact receiving domain.
5. Reply to a task notification and confirm the new comment appears once.

The route verifies the raw Svix signature before fetching the body from Resend. It ignores unknown addresses, mismatched senders, empty replies, and users who no longer have board access. Resend's received-email API does not document an authenticated envelope or SPF, DKIM, or DMARC result, so the route does not infer one from raw headers.

Resend retries temporary API or database failures. One receipt row owns each received email. It blocks concurrent duplicates, releases failed attempts, reclaims abandoned work after five minutes, and resumes the original comment until its follow-up work finishes.

## Sign-in email flow

1. User enters email → API generates secure token
2. The shared REST mailer sends the HTML email through Resend
3. User clicks link → Token verified → Firebase custom token created
4. User signs in with `signInWithCustomToken()`
5. Database sync completes the authentication

## Troubleshooting

- **"Resend API key not configured"** → Check your `.env.local`
- **"Failed to send email"** → Verify the API key and sender domain
- **"Token expired"** → Request a new link
- **Replies do not appear** → Check the receiving domain, the `email.received` webhook, and `RESEND_WEBHOOK_SECRET`
- **Webhook returns 500** → Confirm `RESEND_API_KEY` has permission to retrieve received emails
- Check the Resend dashboard for delivery status and bounces
