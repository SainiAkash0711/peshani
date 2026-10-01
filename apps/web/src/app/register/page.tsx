'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../../lib/auth-context';
import { AuthShell } from '../../components/auth/AuthShell';
import { AuthField, SubmitButton } from '../../components/auth/AuthField';

export default function RegisterPage() {
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [shake, setShake] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const ok = await register(email.trim(), password, firstName.trim() || undefined);
    setSubmitting(false);
    if (!ok) {
      setShake(true);
      setTimeout(() => setShake(false), 450);
    }
  }

  return (
    <AuthShell
      eyebrow="Join Peshani"
      title="Create your account"
      subtitle="It takes less than a minute — and makes every order easier."
      brandHeading="Thoughtfully made goods, from our makers to your home."
      shake={shake}
    >
      <form onSubmit={handleSubmit} className="auth-form">
        <AuthField
          label="First name (optional)"
          icon="user"
          placeholder="Your first name"
          autoComplete="given-name"
          autoFocus
          value={firstName}
          onChange={setFirstName}
        />
        <AuthField
          label="Email address"
          icon="mail"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          required
          value={email}
          onChange={setEmail}
        />
        <AuthField
          label="Password"
          icon="lock"
          type="password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          required
          minLength={8}
          showStrength
          value={password}
          onChange={setPassword}
        />
        <SubmitButton busy={submitting} busyLabel="Creating account…">
          Create account
        </SubmitButton>
      </form>

      <div className="auth-divider">
        <span>Already have an account?</span>
      </div>
      <Link href="/login" className="btn btn--outline auth-alt-btn">
        Sign in instead
      </Link>
    </AuthShell>
  );
}
