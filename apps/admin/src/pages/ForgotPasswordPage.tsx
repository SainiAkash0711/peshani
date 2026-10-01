import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient, ApiError } from '../lib/api-client';
import { AuthShell } from '../components/auth/AuthShell';
import { AuthField, SubmitButton } from '../components/auth/AuthField';

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
      // Always 204 whether or not the email exists - see AuthService.forgotPassword.
      await apiClient.post('/auth/forgot-password', { email: email.trim() });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Account help"
      title={submitted ? 'Check your inbox' : 'Forgot your password?'}
      subtitle={
        submitted
          ? 'If an account exists for that email, a reset link is on its way.'
          : "Enter your email and we'll send you a link to reset it."
      }
    >
      {submitted ? (
        <div className="auth-notice">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm0 1.5 8 6 8-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          </svg>
          <p>
            We sent it to <strong>{email.trim()}</strong>. The link expires in 1 hour. Don&apos;t see it? Check your spam
            folder, or{' '}
            <button type="button" className="auth-link auth-link--button" onClick={() => setSubmitted(false)}>
              try again
            </button>
            .
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="auth-form">
          <AuthField
            label="Email address"
            icon="mail"
            type="email"
            placeholder="admin@peshani.com"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={setEmail}
          />
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <SubmitButton busy={isSubmitting} busyLabel="Sending…">
            Send reset link
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
