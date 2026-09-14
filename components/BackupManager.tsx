import React, { useCallback, useEffect, useState } from 'react';
import { api, getApiBaseUrl } from '../services/apiClient';
import { quote } from '../utils/confirmLabels';

/**
 * Admin > Backup: compressed mysqldump snapshots kept on the server.
 * Server: server/routes/backups.js + server/services/databaseBackup.js. Docs: docs/database-backup.md.
 */

interface BackupFile {
  name: string;
  bytes: number;
  created: string;
  tag: string | null;
}

interface BackupListing {
  backups: BackupFile[];
  keep: number;
  directory: string;
  mysqldump_available: boolean;
}

interface BackupContents {
  tables: { name: string; rows: number; bytes: number }[];
  table_count: number;
  total_rows: number;
  total_bytes: number;
  estimated: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const BackupManager: React.FC = () => {
  const [listing, setListing] = useState<BackupListing | null>(null);
  const [contents, setContents] = useState<BackupContents | null>(null);
  const [showContents, setShowContents] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchListing = useCallback(async () => {
    setIsLoading(true);
    const { data, error: listError } = await api.get<BackupListing>('/admin/backups');
    setIsLoading(false);
    if (listError) {
      setError(listError.message);
      return;
    }
    setListing(data);
  }, []);

  useEffect(() => {
    fetchListing();
  }, [fetchListing]);

  const toggleContents = async () => {
    const next = !showContents;
    setShowContents(next);
    if (next && !contents) {
      const { data, error: contentsError } = await api.get<BackupContents>('/admin/backups/contents');
      if (contentsError) setError(contentsError.message);
      else setContents(data);
    }
  };

  const handleBackupNow = async () => {
    setIsBackingUp(true);
    setError(null);
    setSuccess(null);
    const { data, error: backupError } = await api.post<{ name: string; bytes: number; pruned: string[]; backups: BackupFile[] }>('/admin/backups');
    setIsBackingUp(false);
    if (backupError || !data) {
      setError(backupError?.message || 'Backup failed');
      fetchListing();
      return;
    }
    const prunedNote = data.pruned.length > 0 ? ` Removed ${data.pruned.length} older backup${data.pruned.length === 1 ? '' : 's'}.` : '';
    setSuccess(`Backup written: ${data.name} (${formatBytes(data.bytes)}).${prunedNote}`);
    setListing((prev) => (prev ? { ...prev, backups: data.backups } : prev));
  };

  // A plain link cannot carry the Bearer token, so fetch the file and hand the browser a blob URL.
  const handleDownload = async (backup: BackupFile) => {
    setBusyName(backup.name);
    setError(null);
    try {
      const response = await fetch(`${getApiBaseUrl()}/admin/backups/${encodeURIComponent(backup.name)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('admin_auth_token')}` },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message || body?.error || `Download failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = backup.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err: any) {
      setError(err.message || 'Download failed');
    } finally {
      setBusyName(null);
    }
  };

  const handleDelete = async (backup: BackupFile) => {
    if (!window.confirm(`Delete backup ${quote(backup.name)}? This cannot be undone.`)) return;
    setBusyName(backup.name);
    setError(null);
    setSuccess(null);
    const { data, error: deleteError } = await api.delete<{ deleted: boolean; backups: BackupFile[] }>(
      `/admin/backups/${encodeURIComponent(backup.name)}`
    );
    setBusyName(null);
    if (deleteError || !data) {
      setError(deleteError?.message || 'Delete failed');
      return;
    }
    setSuccess(`Deleted ${backup.name}.`);
    setListing((prev) => (prev ? { ...prev, backups: data.backups } : prev));
  };

  const backups = listing?.backups ?? [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Database Backup</h2>
          <p className="text-sm text-gray-600 mt-1 max-w-2xl">
            A compressed copy of the whole database, kept on the server. Take one before anything that is
            hard to undo: rolling a semester over, deleting sections or courses, or running a migration.
            Rollover offers to take one for you.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleBackupNow}
            disabled={isBackingUp || listing?.mysqldump_available === false}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            {isBackingUp ? 'Backing up…' : 'Back up now'}
          </button>
          <button
            onClick={fetchListing}
            disabled={isLoading}
            className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg disabled:opacity-50"
            aria-label="Refresh backups"
            title="Refresh backups"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-4 text-sm">
        <p className="font-semibold">This is a safety net, not disaster recovery.</p>
        <p className="mt-1">
          Backups are stored on the same server and disk as the database. If that machine is lost, so are these
          files. Download a copy to keep one somewhere else. The newest {listing?.keep ?? 10} pre-rollover backups
          and the newest {listing?.keep ?? 10} other backups are kept; older ones are deleted automatically.
        </p>
      </div>

      {listing?.mysqldump_available === false && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 text-sm">
          <p className="font-semibold">mysqldump was not found on this server.</p>
          <p className="mt-1">
            Install the MySQL client tools (Ubuntu: <code>apt install mysql-client</code>), or set{' '}
            <code>MYSQLDUMP_PATH</code> in <code>.env.local</code> to its full path, then restart the server.
          </p>
        </div>
      )}

      {error && (
        <div className="bg-red-100 border border-red-200 text-red-700 rounded-lg p-3 text-sm flex items-start justify-between gap-2">
          <span className="whitespace-pre-wrap break-words min-w-0">{error}</span>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800 px-1" aria-label="Dismiss">✕</button>
        </div>
      )}
      {success && <div className="bg-green-100 border border-green-200 text-green-700 rounded-lg p-3 text-sm">{success}</div>}

      <div className="bg-white border border-gray-200 rounded-lg">
        <button
          onClick={toggleContents}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50 rounded-lg"
          aria-expanded={showContents}
        >
          <span>What is included</span>
          <span className="text-gray-400">{showContents ? '▾' : '▸'}</span>
        </button>
        {showContents && (
          <div className="px-4 pb-4 text-sm">
            <p className="text-gray-600 mb-3">
              Every table in the database, including students, transcripts, evaluations and settings, plus
              stored routines and triggers. Uploaded case files (<code>case_files/</code>) and logs are not included.
            </p>
            {!contents ? (
              <p className="text-gray-500">Loading…</p>
            ) : (
              <>
                <p className="text-xs text-gray-500 mb-2">
                  {contents.table_count} tables · about {contents.total_rows.toLocaleString()} rows · about{' '}
                  {formatBytes(contents.total_bytes)} on disk (estimated by MySQL; the backup is compressed and smaller)
                </p>
                <div className="max-h-72 overflow-y-auto border border-gray-100 rounded">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr className="text-left text-gray-500 uppercase">
                        <th className="px-3 py-1.5">Table</th>
                        <th className="px-3 py-1.5 text-right">Rows (est.)</th>
                        <th className="px-3 py-1.5 text-right">Size (est.)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {contents.tables.map((t) => (
                        <tr key={t.name}>
                          <td className="px-3 py-1 font-mono">{t.name}</td>
                          <td className="px-3 py-1 text-right">{t.rows.toLocaleString()}</td>
                          <td className="px-3 py-1 text-right">{formatBytes(t.bytes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              <th className="px-4 py-3">Backup</th>
              <th className="px-4 py-3">Taken</th>
              <th className="px-4 py-3 text-right">Size</th>
              <th className="px-4 py-3 text-right">Download</th>
              <th className="px-4 py-3 text-right">Delete</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {listing === null ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">{isLoading ? 'Loading…' : 'Could not load backups.'}</td></tr>
            ) : backups.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">No backups yet.</td></tr>
            ) : backups.map((b) => (
              <tr key={b.name} className="hover:bg-gray-50">
                <td className="px-4 py-2">
                  <span className="font-mono text-xs text-gray-800">{b.name}</span>
                  {b.tag && (
                    <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                      {b.tag === 'pre-rollover' ? 'Before rollover' : b.tag}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{new Date(b.created).toLocaleString()}</td>
                <td className="px-4 py-2 text-right text-gray-600 whitespace-nowrap">{formatBytes(b.bytes)}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => handleDownload(b)}
                    disabled={busyName === b.name}
                    className="px-3 py-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded disabled:opacity-50"
                  >
                    {busyName === b.name ? '…' : 'Download'}
                  </button>
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => handleDelete(b)}
                    disabled={busyName === b.name}
                    className="px-3 py-1 text-xs font-medium text-red-600 hover:text-red-800 hover:bg-red-50 rounded disabled:opacity-50"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {listing && (
        <p className="text-xs text-gray-500">
          Stored on the server in <code className="break-all">{listing.directory}</code>. To restore, see{' '}
          <code>docs/database-backup.md</code> (command line only).
        </p>
      )}
    </div>
  );
};

export default BackupManager;
