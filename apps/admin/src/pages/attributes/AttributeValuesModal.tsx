import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { TextField } from '../../components/FormField';
import { StatusBadge } from '../../components/StatusBadge';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { apiClient, ApiError } from '../../lib/api-client';
import { Attribute, AttributeValue, PaginatedResult } from '../../types/catalog';
import { tableStyle, thStyle, tdStyle } from '../../styles';

interface AttributeValuesModalProps {
  attribute: Attribute;
  onClose: () => void;
}

export function AttributeValuesModal({ attribute, onClose }: AttributeValuesModalProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [newValue, setNewValue] = useState('');
  const [pendingDelete, setPendingDelete] = useState<AttributeValue | null>(null);

  const queryKey = ['attribute-values', attribute.id];

  const valuesQuery = useQuery({
    queryKey,
    queryFn: () =>
      apiClient.get<PaginatedResult<AttributeValue>>(`/attributes/${attribute.id}/values?pageSize=100&sortOrder=asc`),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey });
  }

  const createMutation = useMutation({
    mutationFn: (value: string) => apiClient.post<AttributeValue>(`/attributes/${attribute.id}/values`, { value }),
    onSuccess: () => {
      setNewValue('');
      invalidate();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to add value'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiClient.patch(`/attributes/${attribute.id}/values/${id}/status`, { isActive }),
    onSuccess: invalidate,
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to update status'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/attributes/${attribute.id}/values/${id}`),
    onSuccess: () => {
      toast.show('success', 'Value deleted');
      setPendingDelete(null);
      invalidate();
    },
    onError: (err) => {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to delete value');
      setPendingDelete(null);
    },
  });

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (!newValue.trim()) return;
    await createMutation.mutateAsync(newValue.trim());
  }

  const values = valuesQuery.data?.items ?? [];

  return (
    <Modal title={`Values for "${attribute.name}"`} onClose={onClose} width={480}>
      <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <TextField label="" placeholder="e.g. Black" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
        </div>
        <Button type="submit" disabled={createMutation.isPending || !newValue.trim()} style={{ height: 38 }}>
          Add
        </Button>
      </form>

      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Value</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {valuesQuery.isLoading && (
            <tr>
              <td colSpan={3} style={tdStyle}>
                Loading…
              </td>
            </tr>
          )}
          {!valuesQuery.isLoading && values.length === 0 && (
            <tr>
              <td colSpan={3} style={{ ...tdStyle, color: '#9ca3af', textAlign: 'center' }}>
                No values yet.
              </td>
            </tr>
          )}
          {values.map((value) => (
            <tr key={value.id}>
              <td style={tdStyle}>{value.value}</td>
              <td style={tdStyle}>
                <StatusBadge isActive={value.isActive} />
              </td>
              <td style={tdStyle}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button
                    variant="secondary"
                    onClick={() => statusMutation.mutate({ id: value.id, isActive: !value.isActive })}
                  >
                    {value.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Button variant="danger" onClick={() => setPendingDelete(value)}>
                    Delete
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete value"
          message={`Delete "${pendingDelete.value}"? This cannot be undone if no variants use it.`}
          danger
          confirmLabel="Delete"
          isBusy={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </Modal>
  );
}
