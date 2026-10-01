'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useToast } from '../../lib/toast-context';
import { AuthShell } from '../../components/auth/AuthShell';
import { AuthField, SubmitButton } from '../../components/auth/AuthField';

export default function ForgotPasswordPage() {
  const { show } = useToast();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.ok) {
        setSubmitted(true);
        return;
      }
      const data = await res.json().catch(() => ({}));
      show(data.message ?? 'Something went wrong. Please try again.', 'error');
    } catch {
      show('Could not reach the server. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Account help"
      title={submitted ? 'Check your inbox' : 'Forgot your password?'}
      subtitle={
        submitted
          ? 'If an account exists for that email, a reset link is on its way.'
          : "No worries — enter your email and we'll send you a link to reset it."
      }
    >
      {submitted ? (
        <div className="auth-notice">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm0 1.5 8 6 8-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          </svg>
          <p>
            We sent it to <strong>{email.trim()}</strong>. The link expires in 1 hour. Don&apos;t see it? Check your spam
            folder, or{' '}
            <button type="button" className="auth-link auth-link--button" onClick={() => setSubmitted(false)}>
              try again
            </button>
            .
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="auth-form">
          <AuthField
            label="Email address"
            icon="mail"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={setEmail}
          />
          <SubmitButton busy={submitting} busyLabel="Sending…">
            Send reset link
          </SubmitButton>
        </form>
      )}

      <p className="auth-footnote">
        <Link href="/login" className="auth-link">
          ← Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
