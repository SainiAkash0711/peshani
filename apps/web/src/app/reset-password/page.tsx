'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '../../lib/toast-context';
import { AuthShell } from '../../components/auth/AuthShell';
import { AuthField, SubmitButton } from '../../components/auth/AuthField';

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
        setTimeout(() => router.push('/login'), 2500);
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
      <div className="auth-notice auth-notice--warn">
        <p>
          This reset link is missing or incomplete.{' '}
          <Link href="/forgot-password" className="auth-link">
            Request a new link
          </Link>
          .
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="auth-notice">
        <p>Your password has been reset. Taking you to sign in…</p>
      </div>
    );
  }

  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;

  return (
    <form onSubmit={handleSubmit} className="auth-form">
      <AuthField
        label="New password"
        icon="lock"
        type="password"
        placeholder="At least 8 characters"
        autoComplete="new-password"
        required
        autoFocus
        showStrength
        value={newPassword}
        onChange={setNewPassword}
      />
      <div>
        <AuthField
          label="Confirm new password"
          icon="lock"
          type="password"
          placeholder="Type it again"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={setConfirmPassword}
        />
        {mismatch && <p className="auth-field__hint">Passwords don&apos;t match yet</p>}
      </div>
      <SubmitButton busy={submitting} busyLabel="Resetting…">
        Reset password
      </SubmitButton>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell eyebrow="Account help" title="Choose a new password" subtitle="Pick something strong that you don't use elsewhere.">
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
      <p className="auth-footnote">
        <Link href="/login" className="auth-link">
          ← Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
