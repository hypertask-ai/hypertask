'use client'

import React from 'react'
import { cn } from '@/utils/undoActions/helperFuncs'
import { EmailAuthState, EmailAuthHandlers } from './useEmailAuth'
import { CircleQuestionMark } from 'lucide-react'
import authConfig from '@/lib/configs/auth.config'

export interface EmailAuthStyleConfig {
  container?: string
  input?: string
  button?: string
  buttonPrimary?: string
  buttonSecondary?: string
  error?: string
  text?: string
  textSecondary?: string
  heading?: string
}

interface EmailFormProps {
  state: EmailAuthState
  handlers: EmailAuthHandlers
  styleConfig?: EmailAuthStyleConfig
}

export function EmailForm({ state, handlers, styleConfig }: EmailFormProps) {
  const defaultInput = "w-full h-12 px-4 py-3 bg-transparent border-2 !border-border-light-gray-thin rounded-lg text-white placeholder-gray-400 outline-none focus:border-blue-500 transition-colors"
  const defaultButton = "w-full h-12 bg-white text-black py-3 px-4 rounded-lg font-medium hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-black disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
  const defaultError = "p-3 bg-red-900/20 border border-red-500/20 rounded-lg text-red-400 text-content"

  return (
    <div className={cn("w-full", styleConfig?.container)}>
      <form onSubmit={handlers.handleSubmit} className="space-y-4">
        <div>
          <input
            id="email"
            type="email"
            autoComplete="username webauthn"
            value={state.email}
            onChange={(e) => handlers.setEmail(e.target.value)}
            className={cn(defaultInput, styleConfig?.input)}
            placeholder="Enter your email address..."
            required
          />
          {state.errors.email && (
            <p className={cn("mt-2 text-content text-red-400", styleConfig?.error)}>
              {state.errors.email}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={state.isLoading}
          className={cn(defaultButton, styleConfig?.button, styleConfig?.buttonPrimary)}
        >
          {state.isLoading ? 'Sending Link...' : 'Continue with email'}
        </button>

        {state.errors.general && (
          <div className={cn(defaultError, styleConfig?.error)}>
            {state.errors.general}
          </div>
        )}
      </form>
      
      <div className="mt-4 text-center">
        <a
          href={authConfig.emailLink.troubleshootingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-content text-gray-400 hover:text-white transition-colors"
        >
          <CircleQuestionMark className="w-4 h-4" strokeWidth={1.75} />
          <span>Trouble logging in?</span>
        </a>
      </div>
    </div>
  )
}

interface LinkSentProps {
  state: EmailAuthState
  handlers: EmailAuthHandlers
  styleConfig?: EmailAuthStyleConfig
}

export function LinkSent({ state, handlers, styleConfig }: LinkSentProps) {
  const defaultContainer = "w-full max-w-md mx-auto"
  const defaultCard = "border-2 !border-border-light-gray-thin p-6 rounded-lg shadow-lg"
  const defaultButtonPrimary = "w-full bg-white text-black py-3 px-4 rounded-lg font-medium hover:bg-gray-200 transition-colors"
  const defaultButtonSecondary = "w-full bg-gray-800 border-2 !border-border-light-gray-thin text-white py-3 px-4 rounded-lg font-medium hover:bg-gray-700 disabled:opacity-50 transition-colors"
  const defaultTextLink = "w-full text-gray-400 hover:text-white text-content py-2"
  const defaultError = "mt-4 p-3 bg-red-900/20 border border-red-500/20 rounded text-red-400 text-content"

  return (
    <div className={cn(defaultContainer, styleConfig?.container)}>
      <div className={cn(defaultCard, styleConfig?.container)}>
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className={cn("text-subheading font-semibold text-white mb-2", styleConfig?.heading)}>
            Check your email
          </h2>
          <p className={cn("text-gray-400 mb-4", styleConfig?.text)}>
            We&apos;ve sent you a temporary login link and verification code.
          </p>
          <p className={cn("text-content text-gray-500 mb-4", styleConfig?.textSecondary)}>
            Please check your inbox at <strong className="text-white">{state.email}</strong>
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={handlers.enterCodeManually}
            className={cn(defaultButtonPrimary, styleConfig?.button, styleConfig?.buttonPrimary)}
          >
            Enter code manually
          </button>
          
          <button
            onClick={handlers.resendLink}
            disabled={state.isLoading}
            className={cn(defaultButtonSecondary, styleConfig?.button, styleConfig?.buttonSecondary)}
          >
            {state.isLoading ? 'Sending...' : 'Resend Link'}
          </button>
          
          <button
            onClick={handlers.resetForm}
            className={cn(defaultTextLink, styleConfig?.textSecondary)}
          >
            &larr; Use a different email
          </button>
        </div>
      
        {state.errors.general && (
          <div className={cn(defaultError, styleConfig?.error)}>
            {state.errors.general}
          </div>
        )}
        
        <div className="mt-4 text-center">
          <a
            href="https://help.hypertask.ai/help/troubleshooting-email-login-magic-link"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-content text-gray-400 hover:text-white transition-colors"
          >
            <CircleQuestionMark className="w-4 h-4" strokeWidth={1.75} />
            <span>Trouble logging in?</span>
          </a>
        </div>
      </div>
    </div>
  )
}

interface CodeInputProps {
  state: EmailAuthState
  handlers: EmailAuthHandlers
  styleConfig?: EmailAuthStyleConfig
}

export function CodeInput({ state, handlers, styleConfig }: CodeInputProps) {
  const defaultContainer = "w-full max-w-md mx-auto"
  const defaultCard = "border-2 !border-border-light-gray-thin p-6 rounded-lg shadow-lg"
  const defaultInput = "w-full px-4 py-3 bg-transparent border-2 !border-border-light-gray-thin rounded-lg text-white placeholder-gray-400 outline-none focus:border-blue-500 transition-colors text-center text-subheading tracking-widest"
  const defaultButton = "w-full bg-white text-black py-3 px-4 rounded-lg font-medium hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-black disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
  const defaultTextLink = "w-full text-gray-400 hover:text-white text-content py-2"
  const defaultError = "mt-4 p-3 bg-red-900/20 border border-red-500/20 rounded text-red-400 text-content"

  return (
    <div className={cn(defaultContainer, styleConfig?.container)}>
      <div className={cn(defaultCard, styleConfig?.container)}>
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className={cn("text-subheading font-semibold text-white mb-2", styleConfig?.heading)}>
            Enter verification code
          </h2>
          <p className={cn("text-gray-400 mb-4", styleConfig?.text)}>
            We&apos;ve sent you a temporary login code.
          </p>
          <p className={cn("text-content text-gray-500 mb-4", styleConfig?.textSecondary)}>
            Please check your inbox at <strong className="text-white">{state.email}</strong>
          </p>
        </div>

        <form onSubmit={handlers.handleVerificationCode} className="space-y-4">
          <div>
            <input
              type="text"
              value={state.verificationCode}
              onChange={(e) => handlers.setVerificationCode(e.target.value)}
              className={cn(defaultInput, styleConfig?.input)}
              placeholder="Enter code"
              maxLength={6}
              required
            />
            {state.errors.code && (
              <p className={cn("mt-2 text-content text-red-400", styleConfig?.error)}>
                {state.errors.code}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={state.isLoading}
            className={cn(defaultButton, styleConfig?.button, styleConfig?.buttonPrimary)}
          >
            {state.isLoading ? 'Verifying...' : 'Continue with login code'}
          </button>
        </form>

        <div className="mt-4 space-y-2">
          <button
            onClick={() => handlers.setStep('link-sent')}
            className={cn(defaultTextLink, styleConfig?.textSecondary)}
          >
            &larr; Back to email options
          </button>
          
          <button
            onClick={handlers.resetForm}
            className={cn(defaultTextLink, styleConfig?.textSecondary)}
          >
            Use a different email
          </button>
        </div>

        {state.errors.general && (
          <div className={cn(defaultError, styleConfig?.error)}>
            {state.errors.general}
          </div>
        )}
        
        <div className="mt-4 text-center">
          <a
            href="https://help.hypertask.ai/help/troubleshooting-email-login-magic-link"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-content text-gray-400 hover:text-white transition-colors"
          >
            <CircleQuestionMark className="w-4 h-4" strokeWidth={1.75} />
            <span>Trouble logging in?</span>
          </a>
        </div>
      </div>
    </div>
  )
}

interface SigningInProps {
  state: EmailAuthState
  handlers: EmailAuthHandlers
  styleConfig?: EmailAuthStyleConfig
}

export function SigningIn({ state, handlers, styleConfig }: SigningInProps) {
  const defaultContainer = "w-full max-w-md mx-auto"
  const defaultCard = "bg-gray-800 p-6 rounded-lg shadow-lg"
  const defaultButton = "block w-full mt-2 text-white hover:text-blue-300 text-center"
  const defaultError = "mt-6 p-3 bg-red-900/20 border border-red-500/20 rounded text-red-400 text-content"

  return (
    <div className={cn(defaultContainer, styleConfig?.container)}>
      <div className={cn(defaultCard, styleConfig?.container)}>
        <div className="text-center">
          <div className="relative mb-6">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
            <div className="absolute inset-0 rounded-full border-2 border-gray-600 mx-auto h-12 w-12"></div>
          </div>
          
          <h2 className={cn("text-subheading font-semibold text-white mb-2", styleConfig?.heading)}>
            Signing you in...
          </h2>
          <p className={cn("text-gray-400 mb-4", styleConfig?.text)}>
            Processing your email link authentication
          </p>
          
          {state.email && (
            <p className={cn("text-content text-gray-500 mb-4", styleConfig?.textSecondary)}>
              Signing in as: <span className="text-white">{state.email}</span>
            </p>
          )}
          
          <div className="flex items-center justify-center space-x-2 text-meta text-gray-500">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            <span>Verifying email link</span>
          </div>
        </div>
        
        {state.errors.general && (
          <div className={cn(defaultError, styleConfig?.error)}>
            {state.errors.general}
            <button
              onClick={() => handlers.setStep('form')}
              className={cn(defaultButton, styleConfig?.button)}
            >
              Enter email manually →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
