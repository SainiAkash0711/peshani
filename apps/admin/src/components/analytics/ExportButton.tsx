import { useState } from 'react';
import { Button } from '../Button';
import { useToast } from '../Toast';
import { exportAnalyticsCsv } from '../../lib/csv-export';
import { ApiError } from '../../lib/api-client';

interface ExportButtonProps {
  path: string;
  filename: string;
  label?: string;
}

/** "Export CSV" action for a section - fetches the file as a blob (auth header attached) and
 * triggers a client-side download, showing a toast if the export fails. */
export function ExportButton({ path, filename, label = 'Export CSV' }: ExportButtonProps) {
  const toast = useToast();
  const [isBusy, setIsBusy] = useState(false);

  async function handleClick() {
    setIsBusy(true);
    try {
      await exportAnalyticsCsv(path, filename);
    } catch (err) {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to export CSV');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Button variant="secondary" onClick={() => void handleClick()} disabled={isBusy}>
      {isBusy ? 'Exporting…' : label}
    </Button>
  );
}
