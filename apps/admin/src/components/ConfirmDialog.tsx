import { Modal } from './Modal';
import { Button } from './Button';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isBusy?: boolean;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  onCancel,
  isBusy = false,
}: ConfirmDialogProps) {
  return (
    <Modal title={title} onClose={onCancel} width={400}>
      <p style={{ margin: '0 0 20px', color: '#374151', fontSize: 14 }}>{message}</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button variant="secondary" onClick={onCancel} disabled={isBusy}>
          Cancel
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={isBusy}>
          {isBusy ? 'Please wait…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
