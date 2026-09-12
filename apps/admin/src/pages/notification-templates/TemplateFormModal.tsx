import { FormEvent, useMemo, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { TextField, TextAreaField, SelectField, CheckboxField } from '../../components/FormField';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_LABELS,
  placeholdersForType,
  renderTemplatePreview,
} from '../../lib/notification-meta';
import { NotificationChannel, NotificationTemplate, NotificationType } from '../../types/notifications';

export interface TemplateFormValues {
  key: NotificationType;
  channel: NotificationChannel;
  subject?: string;
  title?: string;
  body: string;
  isActive?: boolean;
}

interface TemplateFormModalProps {
  title: string;
  initial?: NotificationTemplate;
  onSubmit: (values: TemplateFormValues) => Promise<void>;
  onClose: () => void;
}

export function TemplateFormModal({ title, initial, onSubmit, onClose }: TemplateFormModalProps) {
  const isEdit = Boolean(initial);
  const [key, setKey] = useState<NotificationType>(initial?.key ?? NOTIFICATION_TYPES[0]);
  const [channel, setChannel] = useState<NotificationChannel>(initial?.channel ?? 'IN_APP');
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [templateTitle, setTemplateTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableVars = useMemo(() => placeholdersForType(key), [key]);
  const preview = useMemo(() => renderTemplatePreview(body, key), [body, key]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!body.trim()) {
      setError('Body is required');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        key,
        channel,
        subject: channel === 'EMAIL' ? subject.trim() || undefined : undefined,
        title: templateTitle.trim() || undefined,
        body: body.trim(),
        isActive,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} width={640}>
      <form onSubmit={handleSubmit}>
        {isEdit ? (
          <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}>Type</div>
              <div style={{ fontSize: 14, color: '#111827' }}>{NOTIFICATION_TYPE_LABELS[key]}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}>Channel</div>
              <div style={{ fontSize: 14, color: '#111827' }}>{NOTIFICATION_CHANNEL_LABELS[channel]}</div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <SelectField
                label="Notification type"
                value={key}
                onChange={(e) => setKey(e.target.value as NotificationType)}
              >
                {NOTIFICATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {NOTIFICATION_TYPE_LABELS[t]}
                  </option>
                ))}
              </SelectField>
            </div>
            <div style={{ flex: 1 }}>
              <SelectField
                label="Channel"
                value={channel}
                onChange={(e) => setChannel(e.target.value as NotificationChannel)}
              >
                {NOTIFICATION_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {NOTIFICATION_CHANNEL_LABELS[c]}
                  </option>
                ))}
              </SelectField>
            </div>
          </div>
        )}

        <p style={{ fontSize: 12, color: '#6b7280', background: '#f9fafb', padding: 10, borderRadius: 6, marginTop: 0 }}>
          Available placeholders for this type:{' '}
          {availableVars.length > 0 ? (
            availableVars.map((v) => (
              <code
                key={v}
                style={{ background: '#eef2ff', color: '#3730a3', padding: '1px 6px', borderRadius: 4, marginRight: 4 }}
              >
                {`{{${v}}}`}
              </code>
            ))
          ) : (
            <span>none</span>
          )}
        </p>

        {channel === 'EMAIL' && (
          <TextField
            label="Subject"
            placeholder="e.g. Your order {{orderNumber}} has shipped!"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        )}
        <TextField
          label="Title (optional)"
          placeholder="Short heading, e.g. Order shipped"
          value={templateTitle}
          onChange={(e) => setTemplateTitle(e.target.value)}
        />
        <TextAreaField
          label="Body"
          placeholder="Hi {{customerName}}, your order {{orderNumber}} is on its way…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          required
        />

        {!isEdit && <CheckboxField label="Active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />}

        <div style={{ fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>Preview (example values)</div>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'inherit',
            fontSize: 13,
            color: '#111827',
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            padding: 10,
            marginBottom: 14,
            minHeight: 40,
          }}
        >
          {preview || '(empty)'}
        </pre>

        {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save template'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
