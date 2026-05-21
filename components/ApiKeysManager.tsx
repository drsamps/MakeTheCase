/**
 * ApiKeysManager
 *
 * Instructor-facing screen for entering, rotating, and removing API keys
 * for the four supported providers. Keys are sent over HTTPS once at save
 * time, encrypted server-side with AES-256-GCM, and never returned to the
 * client again — the UI only ever sees the 4-character `key_hint`.
 *
 * Admins managing keys for someone else must first impersonate that
 * instructor (X-Act-As-Instructor header). This screen displays the
 * "use system key" state but only the admin can flip it.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../services/apiClient';

type Provider = 'openai' | 'anthropic' | 'google' | 'openrouter';

const PROVIDER_ORDER: Provider[] = ['openrouter', 'openai', 'anthropic', 'google'];

const PROVIDER_LABELS: Record<Provider, string> = {
  openrouter: 'OpenRouter (multi-provider — recommended)',
  openai: 'OpenAI (GPT, o-series)',
  anthropic: 'Anthropic (Claude)',
  google: 'Google (Gemini)'
};

interface StoredKey {
  provider: Provider;
  key_hint: string;
  enabled: 0 | 1;
  last_validated_at: string | null;
  last_validation_error: string | null;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  instructorId: string;
  useSystemKey: boolean;
  allowedVendors: Provider[] | null;
  keys: StoredKey[];
}

const ApiKeysManager: React.FC = () => {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<Provider, string>>({
    openai: '',
    anthropic: '',
    google: '',
    openrouter: ''
  });
  const [busy, setBusy] = useState<Provider | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await api.get<ListResponse>('/api-keys');
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setData(data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const getStored = (p: Provider): StoredKey | undefined =>
    data?.keys.find(k => k.provider === p);

  const handleSave = async (p: Provider) => {
    const apiKey = drafts[p].trim();
    if (apiKey.length < 8) {
      setError('Key looks too short — paste the full secret from the provider.');
      return;
    }
    setBusy(p);
    setError(null);
    setMessage(null);
    const { error } = await api.post('/api-keys', { provider: p, apiKey });
    setBusy(null);
    if (error) {
      setError(error.message);
      return;
    }
    setDrafts(prev => ({ ...prev, [p]: '' }));
    setMessage(`${PROVIDER_LABELS[p]} key saved.`);
    load();
  };

  const handleDelete = async (p: Provider) => {
    if (!window.confirm(`Remove the ${PROVIDER_LABELS[p]} key? Chats using this provider will fail until you re-add it.`)) {
      return;
    }
    setBusy(p);
    setError(null);
    setMessage(null);
    const { error } = await api.delete(`/api-keys/${p}`);
    setBusy(null);
    if (error) {
      setError(error.message);
      return;
    }
    setMessage(`${PROVIDER_LABELS[p]} key removed.`);
    load();
  };

  const handleToggleEnabled = async (p: Provider, next: boolean) => {
    setBusy(p);
    const { error } = await api.patch(`/api-keys/${p}/enabled`, { enabled: next });
    setBusy(null);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">API Keys</h2>
        <p className="text-sm text-gray-500 mt-1">
          Your own API keys for each provider. Keys are encrypted at rest and
          never displayed again after you save them — only the last 4 characters
          show as a hint.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-4 p-3 bg-green-50 text-green-700 text-sm rounded border border-green-200">
          {message}
        </div>
      )}

      {data?.useSystemKey && (
        <div className="mb-4 p-3 bg-blue-50 text-blue-800 text-sm rounded border border-blue-200">
          An admin has granted you permission to use the shared system key.
          You can still set your own keys here; if you do, your keys take
          precedence.
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500 py-8 text-center">Loading…</div>
      ) : (
        <div className="space-y-4">
          {PROVIDER_ORDER.map(p => {
            const stored = getStored(p);
            const allowed = data?.allowedVendors == null || data.allowedVendors.includes(p);
            return (
              <div
                key={p}
                className={`border rounded-lg p-4 ${allowed ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-200 opacity-75'}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="font-medium text-gray-900 flex items-center gap-2">
                      {PROVIDER_LABELS[p]}
                      {!allowed && (
                        <span className="px-2 py-0.5 text-xs bg-gray-200 text-gray-700 rounded">
                          Removed by admin
                        </span>
                      )}
                    </div>
                    {allowed && stored && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        Stored — ends in <code className="px-1 bg-gray-100 rounded">…{stored.key_hint}</code>
                        {stored.last_validated_at && (
                          <> · last validated {new Date(stored.last_validated_at).toLocaleString()}</>
                        )}
                        {!stored.enabled && (
                          <span className="ml-2 px-1.5 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded">disabled</span>
                        )}
                      </div>
                    )}
                    {allowed && !stored && (
                      <div className="text-xs text-gray-400 mt-0.5">No key configured</div>
                    )}
                    {!allowed && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        Your account is not permitted to use this vendor. Contact an admin to request access.
                      </div>
                    )}
                  </div>
                  {allowed && stored && (
                    <div className="flex gap-2 text-xs">
                      <button
                        onClick={() => handleToggleEnabled(p, !stored.enabled)}
                        disabled={busy === p}
                        className="text-blue-600 hover:underline disabled:opacity-50"
                      >
                        {stored.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={() => handleDelete(p)}
                        disabled={busy === p}
                        className="text-red-600 hover:underline disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>

                {allowed && (
                  <div className="flex gap-2">
                    <input
                      type="password"
                      autoComplete="off"
                      placeholder={stored ? 'Paste new key to rotate' : 'Paste API key'}
                      value={drafts[p]}
                      onChange={e => setDrafts(prev => ({ ...prev, [p]: e.target.value }))}
                      className="flex-1 text-sm border border-gray-300 rounded px-3 py-1.5 font-mono"
                    />
                    <button
                      onClick={() => handleSave(p)}
                      disabled={busy === p || drafts[p].trim().length === 0}
                      className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
                    >
                      {busy === p ? '…' : stored ? 'Rotate' : 'Save'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ApiKeysManager;
