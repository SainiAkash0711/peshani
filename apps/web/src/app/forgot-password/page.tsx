'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useToast } from '../../lib/toast-context';

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
    <main className="container" style={{ maxWidth: 420 }}>
      <h1>Forgot Password</h1>
      {submitted ? (
        <>
          <p>
            If an account exists for <strong>{email.trim()}</strong>, we&apos;ve sent a link to reset your password.
            The link expires in 1 hour. Please also check your spam folder.
          </p>
          <p style={{ marginTop: 16, fontSize: '0.9rem' }}>
            <Link href="/login">Back to sign in</Link>
          </p>
        </>
      ) : (
        <>
          <p style={{ color: 'var(--color-muted, #6b7280)' }}>
            Enter your email and we&apos;ll send you a link to reset your password.
          </p>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <input
              className="field"
              type="email"
              placeholder="Email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit" className="btn" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
          <p style={{ marginTop: 16, fontSize: '0.9rem' }}>
            Remembered it? <Link href="/login">Back to sign in</Link>
          </p>
        </>
      )}
    </main>
  );
}
