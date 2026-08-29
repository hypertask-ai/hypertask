import { NextRequest, NextResponse } from 'next/server'
import { getRequestBaseUrl } from '@/lib/auth/requestBaseUrl'
import { sendEmail } from '@/lib/email/sendEmail'

// Resend configuration
const RESEND_API_KEY = process.env.RESEND_API_KEY
const EMAIL_FROM = process.env.EMAIL_FROM || 'notifications@hypertask.ai'

/**
 * API route to send desktop login instructions to mobile users
 * POST /api/auth/send-desktop-link
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email } = body

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      )
    }

    // Send email with desktop login instructions
    await sendDesktopLoginEmail(email, getRequestBaseUrl(request))

    return NextResponse.json(
      { success: true, message: 'Desktop login instructions sent' },
      { status: 200 }
    )
  } catch (error) {
    console.error('Error sending desktop link:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to send email' },
      { status: 500 }
    )
  }
}

async function sendDesktopLoginEmail(to: string, baseUrl: string) {
  const loginUrl = `${baseUrl}/login`

  if (!RESEND_API_KEY) {
    console.log('🔗 Desktop login instructions (no Resend configured) for:', to)
    console.log('Login URL:', loginUrl)
    return
  }

  try {
    await sendEmail({
      to: to,
      from: `Hypertask <${EMAIL_FROM}>`,
      subject: 'Continue to Hypertask on Desktop',
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta http-equiv="X-UA-Compatible" content="ie=edge" />
          <title>Continue to Hypertask on Desktop</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f9fafb;">
          <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="background-color: #1a1a2e; border-radius: 16px; padding: 40px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);">
              
              <!-- Header -->
              <div style="text-align: center; margin-bottom: 32px;">
                <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0 0 12px 0;">
                  Your AI Assistant is Waiting
                </h1>
                <p style="color: #9ca3af; font-size: 16px; margin: 0;">
                  Experience Hypertask's full power on desktop
                </p>
              </div>

              <!-- Main Content -->
              <div style="margin-bottom: 32px;">
                <p style="color: #d1d5db; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                  You've successfully created your Hypertask account. Now, switch to your desktop browser to unlock:
                </p>

                <div style="background-color: #252538; border-radius: 12px; padding: 24px; margin: 24px 0;">
                  <ul style="list-style: none; padding: 0; margin: 0;">
                    <li style="color: #d1d5db; font-size: 14px; line-height: 1.8; margin-bottom: 16px; padding-left: 28px; position: relative;">
                      <span style="position: absolute; left: 0; color: #a78bfa;">✓</span>
                      <strong style="color: #ffffff;">The AI Task Writer:</strong> Dictate tasks in seconds and let AI do the writing.
                    </li>
                    <li style="color: #d1d5db; font-size: 14px; line-height: 1.8; margin-bottom: 16px; padding-left: 28px; position: relative;">
                      <span style="position: absolute; left: 0; color: #a78bfa;">✓</span>
                      <strong style="color: #ffffff;">The Interactive Tutorial:</strong> A 3-minute guide to 10x your team's speed.
                    </li>
                    <li style="color: #d1d5db; font-size: 14px; line-height: 1.8; padding-left: 28px; position: relative;">
                      <span style="position: absolute; left: 0; color: #a78bfa;">✓</span>
                      <strong style="color: #ffffff;">A Full Kanban Board:</strong> Manage complex projects with a complete view.
                    </li>
                  </ul>
                </div>
              </div>

              <!-- CTA Button -->
              <div style="text-align: center; margin: 32px 0;">
                <a href="${loginUrl}" 
                   clicktracking="off"
                   style="background: linear-gradient(135deg, #9333ea 0%, #a855f7 100%); 
                          color: #ffffff; 
                          padding: 16px 40px; 
                          text-decoration: none; 
                          border-radius: 10px; 
                          display: inline-block; 
                          font-weight: 600; 
                          font-size: 16px;">
                  Continue on Desktop
                </a>
              </div>

              <!-- Footer Note -->
              <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #374151;">
                <p style="color: #9ca3af; font-size: 13px; line-height: 1.6; margin: 0; text-align: center;">
                  Open this email on your desktop computer and click the button above, or copy and paste this URL into your desktop browser:
                </p>
                <p style="color: #6b7280; font-size: 12px; margin: 12px 0 0 0; text-align: center; word-break: break-all;">
                  ${loginUrl}
                </p>
              </div>

            </div>

            <!-- Footer -->
            <div style="text-align: center; margin-top: 24px;">
              <p style="color: #6b7280; font-size: 14px; margin: 0;">
                <a href="https://app.hypertask.ai" clicktracking="off" style="color: #a78bfa; text-decoration: none;">Hypertask.ai</a> - AI-Powered Task Management
              </p>
              <p style="color: #9ca3af; font-size: 12px; margin: 8px 0 0 0;">
                Hypertask Lab Ltd.
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
    })

    console.log('✅ Desktop login email sent to:', to)
  } catch (error) {
    console.error('❌ Failed to send desktop login email:', error)
    throw error
  }
}
