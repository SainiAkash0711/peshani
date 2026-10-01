import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient, ApiError } from '../lib/api-client';
import { AuthShell } from '../components/auth/AuthShell';
import { AuthField, SubmitButton } from '../components/auth/AuthField';

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
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setIsSubmitting(true);
    try {
      await apiClient.post('/auth/reset-password', { token, newPassword });
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setIsSubmitting(false);
    }
  }

  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;

  return (
    <AuthShell eyebrow="Account help" title="Choose a new password" subtitle="Pick something strong that you don't use elsewhere.">
      {!token ? (
        <div className="auth-notice auth-notice--warn">
          <p>
            This reset link is missing or incomplete.{' '}
            <Link to="/forgot-password" className="auth-link">
              Request a new link
            </Link>
            .
          </p>
        </div>
      ) : done ? (
        <div className="auth-notice">
          <p>Your password has been reset. Taking you to sign in…</p>
        </div>
      ) : (
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
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <SubmitButton busy={isSubmitting} busyLabel="Resetting…">
            Reset password
          </SubmitButton>
        </form>
      )}

      <p className="auth-footnote">
        <Link to="/login" className="auth-link">
          ← Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
