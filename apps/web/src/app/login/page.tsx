'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../../lib/auth-context';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await login(email, password);
    setSubmitting(false);
  }

  return (
    <main className="container" style={{ maxWidth: 420 }}>
      <h1>Sign In</h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <input className="field" type="email" placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="field" type="password" placeholder="Password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
      <p style={{ marginTop: 16, fontSize: '0.9rem' }}>
        New here? <Link href="/register">Create an account</Link>
      </p>
    </main>
  );
}
