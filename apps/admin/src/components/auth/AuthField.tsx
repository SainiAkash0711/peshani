import { InputHTMLAttributes, KeyboardEvent, useId, useState } from 'react';

const ICONS = {
  mail: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm0 1.5 8 6 8-6',
  lock: 'M6 10V8a6 6 0 1 1 12 0v2h1v11H5V10h1Zm2 0h8V8a4 4 0 1 0-8 0v2Z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c0-3.3 3.1-6 7-6s7 2.7 7 6',
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface AuthFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label: string;
  icon: keyof typeof ICONS;
  value: string;
  onChange: (value: string) => void;
  showStrength?: boolean;
}

function passwordStrength(value: string): { score: number; label: string } {
  if (!value) return { score: 0, label: '' };
  let score = 0;
  if (value.length >= 8) score++;
  if (value.length >= 12) score++;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score++;
  if (value.length < 8) score = Math.min(score, 1);
  return { score: Math.max(score, 1), label: ['', 'Weak', 'Fair', 'Good', 'Strong'][Math.max(score, 1)] };
}

export function AuthField({ label, icon, type = 'text', value, onChange, showStrength, ...rest }: AuthFieldProps) {
  const id = useId();
  const isPassword = type === 'password';
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const isValidEmail = type === 'email' && EMAIL_PATTERN.test(value);
  const strength = showStrength ? passwordStrength(value) : null;

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (isPassword) setCapsLock(event.getModifierState('CapsLock'));
  }

  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-field__control">
        <svg className="auth-field__icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d={ICONS[icon]} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <input
          {...rest}
          id={id}
          type={isPassword && visible ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyUp={handleKey}
          onKeyDown={handleKey}
          onBlur={() => setCapsLock(false)}
        />
        {isValidEmail && (
          <svg className="auth-field__valid" viewBox="0 0 24 24" width="18" height="18" aria-label="Looks good">
            <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {isPassword && (
          <button
            type="button"
            className="auth-field__toggle"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
          >
            {visible ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {capsLock && <p className="auth-field__hint">Caps Lock is on</p>}
      {strength && strength.score > 0 && (
        <div className={`auth-strength auth-strength--${strength.score}`} aria-live="polite">
          <span className="auth-strength__bars">
            {[1, 2, 3, 4].map((n) => (
              <span key={n} className={n <= strength.score ? 'is-on' : ''} />
            ))}
          </span>
          <span className="auth-strength__label">{strength.label} password</span>
        </div>
      )}
    </div>
  );
}

export function SubmitButton({ busy, children, busyLabel }: { busy: boolean; children: string; busyLabel: string }) {
  return (
    <button type="submit" className="auth-submit" disabled={busy}>
      {busy && <span className="auth-spinner" aria-hidden="true" />}
      {busy ? busyLabel : children}
      {!busy && (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M5 12h14m-5-5 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
