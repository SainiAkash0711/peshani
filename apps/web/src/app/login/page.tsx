'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../../lib/auth-context';
import { AuthShell } from '../../components/auth/AuthShell';
import { AuthField, SubmitButton } from '../../components/auth/AuthField';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [shake, setShake] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const ok = await login(email.trim(), password);
    setSubmitting(false);
    if (!ok) {
      setShake(true);
      setTimeout(() => setShake(false), 450);
    }
  }

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in to Peshani"
      subtitle="Pick up right where you left off — your cart and wishlist are waiting."
      shake={shake}
    >
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
        <div>
          <AuthField
            label="Password"
            icon="lock"
            type="password"
            placeholder="Enter your password"
            autoComplete="current-password"
            required
            value={password}
            onChange={setPassword}
          />
          <p className="auth-row-end">
            <Link href="/forgot-password" className="auth-link">
              Forgot password?
            </Link>
          </p>
        </div>
        <SubmitButton busy={submitting} busyLabel="Signing in…">
          Sign in
        </SubmitButton>
      </form>

      <div className="auth-divider">
        <span>New to Peshani?</span>
      </div>
      <Link href="/register" className="btn btn--outline auth-alt-btn">
        Create an account
      </Link>
    </AuthShell>
  );
}
