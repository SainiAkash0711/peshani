import { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const VARIANT_STYLES: Record<Variant, { background: string; color: string; border: string }> = {
  primary: { background: '#4f46e5', color: '#fff', border: '1px solid #4f46e5' },
  secondary: { background: '#fff', color: '#374151', border: '1px solid #d1d5db' },
  danger: { background: '#dc2626', color: '#fff', border: '1px solid #dc2626' },
};

export function Button({ variant = 'primary', style, disabled, ...rest }: ButtonProps) {
  const v = VARIANT_STYLES[variant];
  return (
    <button
      {...rest}
      disabled={disabled}
      style={{
        background: v.background,
        color: v.color,
        border: v.border,
        borderRadius: 6,
        padding: '8px 14px',
        fontSize: 14,
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        ...style,
      }}
    />
  );
}
