import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient, ApiError } from '../lib/api-client';
import { TextField } from '../components/FormField';
import { Button } from '../components/Button';
import { Logo } from '../components/Logo';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      // POST /auth/forgot-password always responds 204 regardless of whether
      // the email exists (see AuthService.forgotPassword) - never reveal
      // that distinction here either.
      await apiClient.post('/auth/forgot-password', { email });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
        background: '#f9fafb',
      }}
    >
      <div
        style={{
          background: '#fff',
          padding: 32,
          borderRadius: 10,
          border: '1px solid #e5e7eb',
          width: 360,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <Logo size={32} />
          <h1 style={{ fontSize: 20, margin: 0 }}>Peshani Admin</h1>
        </div>

        {submitted ? (
          <>
            <p style={{ fontSize: 13, color: '#374151', margin: '20px 0 20px' }}>
              If an account exists for <strong>{email}</strong>, we've sent a password reset link to it. The link
              expires in 1 hour.
            </p>
            <Link to="/login" style={{ fontSize: 13, color: '#2563eb' }}>
              Back to sign in
            </Link>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px' }}>
              Enter your email and we'll send you a link to reset your password.
            </p>
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>}
            <Button type="submit" disabled={isSubmitting} style={{ width: '100%' }}>
              {isSubmitting ? 'Sending…' : 'Send reset link'}
            </Button>
            <p style={{ marginTop: 16, textAlign: 'center' }}>
              <Link to="/login" style={{ fontSize: 13, color: '#2563eb' }}>
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
