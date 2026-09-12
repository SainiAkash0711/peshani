import { downloadFile } from './api-client';

/**
 * Downloads a CSV export from an authenticated analytics endpoint and saves
 * it via a temporary object URL + synthetic anchor click (blob download),
 * since a plain link can't carry the Bearer token this app uses for auth.
 */
export async function exportAnalyticsCsv(path: string, fallbackFilename: string): Promise<void> {
  const { blob, filename } = await downloadFile(path);
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename ?? fallbackFilename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
