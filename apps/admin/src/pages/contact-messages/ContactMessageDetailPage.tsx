import { FormEvent, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '../../lib/api-client';
import { useToast } from '../../components/Toast';
import { Button } from '../../components/Button';
import { TextAreaField } from '../../components/FormField';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { cardStyle, pageHeaderStyle } from '../../styles';

interface ReplyAuthor {
  email: string;
  firstName: string | null;
  lastName: string | null;
}

interface ContactMessageReply {
  id: string;
  message: string;
  sentAt: string;
  emailSentAt: string | null;
  sentByUser: ReplyAuthor;
}

interface ContactMessageDetail {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  createdAt: string;
  emailSentAt: string | null;
  replies: ContactMessageReply[];
}

export function ContactMessageDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [replyText, setReplyText] = useState('');
  const [pendingDelete, setPendingDelete] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['contact-message', id],
    queryFn: () => apiClient.get<ContactMessageDetail>(`/admin/contact-messages/${id}`),
  });

  const replyMutation = useMutation({
    mutationFn: () => apiClient.post<ContactMessageReply>(`/admin/contact-messages/${id}/reply`, { message: replyText.trim() }),
    onSuccess: () => {
      toast.show('success', 'Reply sent');
      setReplyText('');
      void queryClient.invalidateQueries({ queryKey: ['contact-message', id] });
      void queryClient.invalidateQueries({ queryKey: ['contact-messages'] });
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to send reply'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.delete<{ id: string }>(`/admin/contact-messages/${id}`),
    onSuccess: () => {
      toast.show('success', 'Message deleted');
      void queryClient.invalidateQueries({ queryKey: ['contact-messages'] });
      navigate('/contact-messages');
    },
    onError: (err) => {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to delete message');
      setPendingDelete(false);
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!replyText.trim()) {
      toast.show('error', 'Please write a reply before sending');
      return;
    }
    replyMutation.mutate();
  }

  if (detailQuery.isLoading) {
    return <p style={{ color: '#9ca3af' }}>Loading…</p>;
  }

  if (detailQuery.isError || !detailQuery.data) {
    return <p style={{ color: '#dc2626' }}>Failed to load this message.</p>;
  }

  const msg = detailQuery.data;

  return (
    <div>
      <div style={pageHeaderStyle}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Message from {msg.name}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" onClick={() => navigate('/contact-messages')}>
            Back to Contact Messages
          </Button>
          <Button variant="danger" onClick={() => setPendingDelete(true)}>
            Delete
          </Button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{msg.name}</div>
              <div style={{ color: '#6b7280', fontSize: 13 }}>{msg.email}</div>
              {msg.phone && <div style={{ color: '#6b7280', fontSize: 13 }}>{msg.phone}</div>}
            </div>
            <div style={{ color: '#9ca3af', fontSize: 12, textAlign: 'right' }}>{new Date(msg.createdAt).toLocaleString()}</div>
          </div>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{msg.message}</p>
          {!msg.emailSentAt && (
            <p style={{ fontSize: 12, color: '#b45309', marginTop: 12, marginBottom: 0 }}>
              Note: the notification email for this submission was not sent (no Support email configured, or SMTP isn&apos;t
              set up yet).
            </p>
          )}
        </div>

        {msg.replies.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {msg.replies.map((reply) => (
              <div key={reply.id} style={{ ...cardStyle, background: '#f0fdf4', borderColor: '#bbf7d0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    Reply from {reply.sentByUser.firstName ?? reply.sentByUser.email}
                  </div>
                  <div style={{ color: '#9ca3af', fontSize: 12 }}>{new Date(reply.sentAt).toLocaleString()}</div>
                </div>
                <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{reply.message}</p>
                <div style={{ fontSize: 11, color: reply.emailSentAt ? '#15803d' : '#9ca3af', marginTop: 8 }}>
                  {reply.emailSentAt ? 'Emailed to customer' : 'Not emailed (SMTP not configured)'}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Send a reply</h3>
          <form onSubmit={handleSubmit}>
            <TextAreaField
              label={`Reply to ${msg.email}`}
              rows={6}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
            />
            <Button type="submit" disabled={replyMutation.isPending}>
              {replyMutation.isPending ? 'Sending…' : 'Send reply'}
            </Button>
          </form>
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete message"
          message={`Delete the message from "${msg.name}"? This cannot be undone.`}
          danger
          confirmLabel="Delete"
          isBusy={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setPendingDelete(false)}
        />
      )}
    </div>
  );
}
