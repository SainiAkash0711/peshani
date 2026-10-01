import { FormEvent, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { ApiError } from '../lib/api-client';
import { AuthShell } from '../components/auth/AuthShell';
import { AuthField, SubmitButton } from '../components/auth/AuthField';

export function LoginPage() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shake, setShake] = useState(false);

  if (user) {
    return <Navigate to="/categories" replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Login failed');
      setShake(true);
      setTimeout(() => setShake(false), 450);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Peshani Admin"
      title="Welcome back"
      subtitle="Sign in to manage your store, orders and customers."
      shake={shake}
    >
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
            <Link to="/forgot-password" className="auth-link">
              Forgot password?
            </Link>
          </p>
        </div>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <SubmitButton busy={isSubmitting} busyLabel="Signing in…">
          Sign in
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
