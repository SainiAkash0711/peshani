import { FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient, ApiError } from '../../lib/api-client';
import { useToast } from '../../components/Toast';
import { Button } from '../../components/Button';
import { TextField, TextAreaField } from '../../components/FormField';
import { cardStyle, pageHeaderStyle } from '../../styles';

type StoreSettingsMap = Record<string, string>;

interface FieldDef {
  key: string;
  label: string;
  hint?: string;
  multiline?: boolean;
}

// The known settings this store actually uses today (see apps/api's seed.ts
// defaultSettings) - a plain labeled form rather than a raw key/value editor,
// since every one of these has a specific meaning worth its own label/hint.
const FIELDS: FieldDef[] = [
  { key: 'storeName', label: 'Store name' },
  { key: 'storeDescription', label: 'Store description', multiline: true },
  { key: 'supportEmail', label: 'Support email' },
  {
    key: 'supportPhone',
    label: 'Support phone (WhatsApp)',
    hint: 'Include the country code, e.g. +91 98765 43210. Setting this makes the floating WhatsApp chat button appear on the storefront - it stays hidden while this is empty.',
  },
  { key: 'currency', label: 'Currency code', hint: 'e.g. INR, USD' },
  { key: 'currencySymbol', label: 'Currency symbol', hint: 'e.g. ₹, $' },
  { key: 'country', label: 'Country' },
  { key: 'timezone', label: 'Timezone', hint: 'e.g. Asia/Kolkata' },
  { key: 'defaultLanguage', label: 'Default language' },
  { key: 'RETURN_WINDOW_DAYS', label: 'Return window (days)', hint: 'How many days after delivery a customer can request a return.' },
];

export function StoreSettingsPage() {
  const toast = useToast();
  const [form, setForm] = useState<StoreSettingsMap>({});
  const [initialForm, setInitialForm] = useState<StoreSettingsMap>({});

  const settingsQuery = useQuery({
    queryKey: ['store-settings'],
    queryFn: () => apiClient.get<StoreSettingsMap>('/store-settings'),
  });

  // Seeds the form only from the FIRST successful load. React Query
  // refetches this in the background (e.g. on window focus), and without
  // this guard that refetch would re-run this effect and silently overwrite
  // whatever the user had already typed - which is exactly what made "Save
  // changes" look stuck disabled: form and initialForm both got reset to
  // the same (stale) values, so isDirty went back to false mid-edit.
  const hasSeededForm = useRef(false);
  useEffect(() => {
    if (settingsQuery.data && !hasSeededForm.current) {
      hasSeededForm.current = true;
      const next: StoreSettingsMap = {};
      for (const field of FIELDS) next[field.key] = settingsQuery.data[field.key] ?? '';
      setForm(next);
      setInitialForm(next);
    }
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const changedKeys = FIELDS.map((f) => f.key).filter((key) => form[key] !== initialForm[key]);
      await Promise.all(changedKeys.map((key) => apiClient.put('/store-settings', { key, value: form[key] })));
      return changedKeys;
    },
    onSuccess: (changedKeys) => {
      if (changedKeys.length === 0) {
        toast.show('success', 'Nothing to save - no changes made');
      } else {
        toast.show('success', 'Store settings saved');
        setInitialForm(form);
      }
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to save store settings'),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    saveMutation.mutate();
  }

  const isDirty = FIELDS.some((f) => form[f.key] !== initialForm[f.key]);

  if (settingsQuery.isLoading) {
    return <p style={{ color: '#9ca3af' }}>Loading…</p>;
  }

  return (
    <div>
      <div style={pageHeaderStyle}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Store Settings</h1>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
        <div style={cardStyle}>
          {FIELDS.map((field) =>
            field.multiline ? (
              <TextAreaField
                key={field.key}
                label={field.label}
                rows={3}
                value={form[field.key] ?? ''}
                onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
              />
            ) : (
              <div key={field.key} style={{ marginBottom: field.hint ? 0 : undefined }}>
                <TextField
                  label={field.label}
                  value={form[field.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                />
                {field.hint && <p style={{ fontSize: 12, color: '#9ca3af', marginTop: -10, marginBottom: 14 }}>{field.hint}</p>}
              </div>
            ),
          )}
        </div>

        <div>
          <Button type="submit" disabled={saveMutation.isPending || !isDirty}>
            {saveMutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </div>
  );
}
