import { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

const fieldWrapperStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4, marginBottom: 14 };
const labelStyle = { fontSize: 13, fontWeight: 500, color: '#374151' };
const controlStyle = {
  padding: '8px 10px',
  fontSize: 14,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontFamily: 'inherit',
};
const errorStyle = { fontSize: 12, color: '#dc2626' };

interface FieldShellProps {
  label: string;
  error?: string;
  children: ReactNode;
  required?: boolean;
}

function FieldShell({ label, error, children, required }: FieldShellProps) {
  return (
    <div style={fieldWrapperStyle}>
      <label style={labelStyle}>
        {label}
        {required && <span style={{ color: '#dc2626' }}> *</span>}
      </label>
      {children}
      {error && <span style={errorStyle}>{error}</span>}
    </div>
  );
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function TextField({ label, error, required, style, ...rest }: TextFieldProps) {
  return (
    <FieldShell label={label} error={error} required={required}>
      <input {...rest} style={{ ...controlStyle, ...style }} />
    </FieldShell>
  );
}

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
}

export function TextAreaField({ label, error, required, style, ...rest }: TextAreaFieldProps) {
  return (
    <FieldShell label={label} error={error} required={required}>
      <textarea {...rest} rows={rest.rows ?? 3} style={{ ...controlStyle, resize: 'vertical', ...style }} />
    </FieldShell>
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
}

export function SelectField({ label, error, required, style, children, ...rest }: SelectFieldProps) {
  return (
    <FieldShell label={label} error={error} required={required}>
      <select {...rest} style={{ ...controlStyle, background: '#fff', ...style }}>
        {children}
      </select>
    </FieldShell>
  );
}

interface CheckboxFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function CheckboxField({ label, ...rest }: CheckboxFieldProps) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 14, color: '#374151' }}>
      <input type="checkbox" {...rest} />
      {label}
    </label>
  );
}
