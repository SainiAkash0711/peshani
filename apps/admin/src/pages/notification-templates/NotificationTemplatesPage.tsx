import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '../../lib/api-client';
import { useAuth } from '../../lib/auth-context';
import { useToast } from '../../components/Toast';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { NoAccess } from '../../components/NoAccess';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/TableStates';
import { pageHeaderStyle, tableStyle, tdStyle, thStyle, cardStyle } from '../../styles';
import { NOTIFICATION_CHANNEL_LABELS, NOTIFICATION_TYPE_LABELS } from '../../lib/notification-meta';
import {
  NotificationChannel,
  NotificationTemplate,
  NotificationTemplateUpdateValues,
  NotificationType,
} from '../../types/notifications';
import { TemplateFormModal, TemplateFormValues } from './TemplateFormModal';

export function NotificationTemplatesPage() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('notification_template.read');
  const canCreate = hasPermission('notification_template.create');
  const canUpdate = hasPermission('notification_template.update');
  const canToggleStatus = hasPermission('notification_template.status');
  const canDelete = hasPermission('notification_template.delete');

  const queryClient = useQueryClient();
  const toast = useToast();

  const [formState, setFormState] = useState<'create' | NotificationTemplate | null>(null);
  const [conflictNotice, setConflictNotice] = useState<{ key: NotificationType; channel: NotificationChannel } | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<NotificationTemplate | null>(null);

  const listQuery = useQuery({
    queryKey: ['notification-templates', 'list'],
    queryFn: () => apiClient.get<NotificationTemplate[]>('/admin/notification-templates'),
    enabled: canRead,
  });

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: ['notification-templates'] });
  }

  const createMutation = useMutation({
    mutationFn: (values: TemplateFormValues) => apiClient.post<NotificationTemplate>('/admin/notification-templates', values),
    onSuccess: () => {
      toast.show('success', 'Template created');
      setFormState(null);
      setConflictNotice(null);
      invalidateAll();
    },
    onError: (err, values) => {
      if (err instanceof ApiError && err.status === 409) {
        setConflictNotice({ key: values.key, channel: values.channel });
        return;
      }
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to create template');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: NotificationTemplateUpdateValues }) =>
      apiClient.patch<NotificationTemplate>(`/admin/notification-templates/${id}`, values),
    onSuccess: () => {
      toast.show('success', 'Template updated');
      setFormState(null);
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to update template'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiClient.patch<NotificationTemplate>(`/admin/notification-templates/${id}/status`, { isActive }),
    onSuccess: (_data, variables) => {
      toast.show('success', variables.isActive ? 'Template activated' : 'Template deactivated');
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to update status'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete<{ id: string }>(`/admin/notification-templates/${id}`),
    onSuccess: () => {
      toast.show('success', 'Template deleted');
      setPendingDelete(null);
      invalidateAll();
    },
    onError: (err) => {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to delete template');
      setPendingDelete(null);
    },
  });

  async function handleFormSubmit(values: TemplateFormValues) {
    if (formState === 'create') {
      await createMutation.mutateAsync(values);
    } else if (formState) {
      await updateMutation.mutateAsync({
        id: formState.id,
        values: { subject: values.subject, title: values.title, body: values.body },
      });
    }
  }

  if (!canRead) {
    return <NoAccess message="You don't have permission to view notification templates." />;
  }

  const items = listQuery.data ?? [];
  const columnCount = 5 + (canUpdate || canToggleStatus || canDelete ? 1 : 0);

  const existingConflict = conflictNotice
    ? items.find((t) => t.key === conflictNotice.key && t.channel === conflictNotice.channel)
    : null;

  return (
    <div>
      <div style={pageHeaderStyle}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Notification Templates</h1>
        {canCreate && <Button onClick={() => { setFormState('create'); setConflictNotice(null); }}>+ New Template</Button>}
      </div>

      <p style={{ fontSize: 13, color: '#6b7280', marginTop: -8, marginBottom: 16 }}>
        Custom templates override the built-in default for that notification type and channel. If none exists here,
        the built-in default is used automatically — so an empty list is expected, not a bug.
      </p>

      {conflictNotice && (
        <div
          style={{
            ...cardStyle,
            padding: 12,
            marginBottom: 16,
            background: '#fef2f2',
            borderColor: '#fecaca',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 13, color: '#991b1b' }}>
            A template already exists for {NOTIFICATION_TYPE_LABELS[conflictNotice.key]} /{' '}
            {NOTIFICATION_CHANNEL_LABELS[conflictNotice.channel]} — edit it instead of creating a duplicate.
          </span>
          {existingConflict && canUpdate && (
            <Button
              variant="secondary"
              onClick={() => {
                setFormState(existingConflict);
                setConflictNotice(null);
              }}
            >
              Edit existing
            </Button>
          )}
        </div>
      )}

      <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Channel</th>
              <th style={thStyle}>Title</th>
              <th style={thStyle}>Active</th>
              <th style={thStyle}>Updated</th>
              {(canUpdate || canToggleStatus || canDelete) && <th style={thStyle}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading && <TableSkeleton columns={columnCount} />}
            {listQuery.isError && <ErrorState columns={columnCount} message="Failed to load templates. Please try again." />}
            {!listQuery.isLoading && !listQuery.isError && items.length === 0 && (
              <EmptyState columns={columnCount} message="No custom templates yet — all notification types use their built-in defaults." />
            )}
            {items.map((template) => (
              <tr key={template.id}>
                <td style={tdStyle}>{NOTIFICATION_TYPE_LABELS[template.key]}</td>
                <td style={tdStyle}>{NOTIFICATION_CHANNEL_LABELS[template.channel]}</td>
                <td style={tdStyle}>{template.title || '—'}</td>
                <td style={tdStyle}>
                  <StatusBadge isActive={template.isActive} />
                </td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{new Date(template.updatedAt).toLocaleDateString()}</td>
                {(canUpdate || canToggleStatus || canDelete) && (
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {canUpdate && (
                        <Button variant="secondary" onClick={() => setFormState(template)}>
                          Edit
                        </Button>
                      )}
                      {canToggleStatus && (
                        <Button
                          variant="secondary"
                          disabled={statusMutation.isPending}
                          onClick={() => statusMutation.mutate({ id: template.id, isActive: !template.isActive })}
                        >
                          {template.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                      )}
                      {canDelete && (
                        <Button variant="danger" onClick={() => setPendingDelete(template)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formState && (
        <TemplateFormModal
          title={formState === 'create' ? 'New Template' : `Edit ${NOTIFICATION_TYPE_LABELS[formState.key]} template`}
          initial={formState === 'create' ? undefined : formState}
          onSubmit={handleFormSubmit}
          onClose={() => setFormState(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete template"
          message={`Delete the ${NOTIFICATION_TYPE_LABELS[pendingDelete.key]} / ${NOTIFICATION_CHANNEL_LABELS[pendingDelete.channel]} template? Notifications of this type will fall back to the built-in default. This cannot be undone.`}
          danger
          confirmLabel="Delete"
          isBusy={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
