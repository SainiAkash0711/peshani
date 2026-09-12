'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../../lib/auth-context';

export default function RegisterPage() {
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await register(email, password, firstName || undefined);
    setSubmitting(false);
  }

  return (
    <main className="container" style={{ maxWidth: 420 }}>
      <h1>Create an Account</h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <input className="field" type="text" placeholder="First name (optional)" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        <input className="field" type="email" placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <input
          className="field"
          type="password"
          placeholder="Password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create Account'}
        </button>
      </form>
      <p style={{ marginTop: 16, fontSize: '0.9rem' }}>
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </main>
  );
}
