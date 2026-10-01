import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient, ApiError } from '../lib/api-client';
import { TextField } from '../components/FormField';
import { Button } from '../components/Button';
import { Logo } from '../components/Logo';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setIsSubmitting(true);
    try {
      await apiClient.post('/auth/reset-password', { token, newPassword });
      setDone(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Failed to reset password');
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

        {!token ? (
          <>
            <p style={{ color: '#dc2626', fontSize: 13, margin: '20px 0' }}>
              This reset link is missing its token. Please request a new one.
            </p>
            <Link to="/forgot-password" style={{ fontSize: 13, color: '#2563eb' }}>
              Request a new link
            </Link>
          </>
        ) : done ? (
          <p style={{ fontSize: 13, color: '#374151', margin: '20px 0' }}>
            Your password has been reset. Redirecting you to sign in…
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px' }}>Choose a new password.</p>
            <TextField
              label="New password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoFocus
            />
            <TextField
              label="Confirm new password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>}
            <Button type="submit" disabled={isSubmitting} style={{ width: '100%' }}>
              {isSubmitting ? 'Resetting…' : 'Reset password'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
