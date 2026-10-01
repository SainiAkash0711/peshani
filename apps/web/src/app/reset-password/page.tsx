'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '../../lib/toast-context';

function ResetPasswordForm() {
  const { show } = useToast();
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      show('Password must be at least 8 characters', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      show('Passwords do not match', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      if (res.ok) {
        setDone(true);
        setTimeout(() => router.push('/login'), 2000);
        return;
      }
      const data = await res.json().catch(() => ({}));
      show(data.message ?? 'Could not reset your password. Please try again.', 'error');
    } catch {
      show('Could not reach the server. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <>
        <p>This reset link is missing or incomplete. Please request a new one.</p>
        <p style={{ marginTop: 16, fontSize: '0.9rem' }}>
          <Link href="/forgot-password">Request a new link</Link>
        </p>
      </>
    );
  }

  if (done) {
    return <p>Your password has been reset. Redirecting you to sign in…</p>;
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <input
        className="field"
        type="password"
        placeholder="New password (min 8 characters)"
        required
        autoFocus
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
      />
      <input
        className="field"
        type="password"
        placeholder="Confirm new password"
        required
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
      />
      <button type="submit" className="btn" disabled={submitting}>
        {submitting ? 'Resetting…' : 'Reset password'}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="container" style={{ maxWidth: 420 }}>
      <h1>Reset Password</h1>
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
