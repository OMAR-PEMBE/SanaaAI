'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Field } from '@/components/field';
import { api, ApiClientError, getToken, toolLabel } from '@/lib/api';

type Config = { id: string; toolType: string; durationSeconds: number | null; costCredits: number; aspectRatios?: string[] };
type Wallet = { balanceCredits: number; heldCredits: number };

export function CreateForm({ tool }: { tool: 'ai_image' | 'text_to_video' | 'image_to_video' }) {
  const router = useRouter();
  const params = useSearchParams();
  const [configs, setConfigs] = useState<Config[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [prompt, setPrompt] = useState(params.get('prompt') ?? '');
  const [aspectRatio, setAspectRatio] = useState('');
  const [configId, setConfigId] = useState('');
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace(`/login?next=${encodeURIComponent(tool === 'ai_image' ? '/create/image' : tool === 'text_to_video' ? '/create/text-to-video' : '/create/image-to-video')}`);
      return;
    }
    void Promise.all([
      api<{ data: Config[] }>('/v1/generations/configurations'),
      api<{ data: Wallet }>('/v1/wallet'),
    ])
      .then(([configBody, walletBody]) => {
        const rows = configBody.data.filter((row) => row.toolType === tool);
        setConfigs(rows);
        const first = rows[0];
        if (first) {
          setConfigId(first.id);
          setAspectRatio(first.aspectRatios?.[0] ?? '');
        }
        setWallet(walletBody.data);
      })
      .catch((caught) => setError(caught instanceof ApiClientError ? caught.message : 'This tool could not be loaded.'))
      .finally(() => setReady(true));
  }, [router, tool]);

  const selected = configs.find((row) => row.id === configId) ?? configs[0];
  const available = wallet ? wallet.balanceCredits - wallet.heldCredits : 0;
  const cost = selected?.costCredits ?? null;
  const short = cost !== null && available < cost;
  const ratios = selected?.aspectRatios ?? [];

  async function onFile(file: File | null) {
    if (!file) return;
    setError(null);
    if (file.size > 10 * 1024 * 1024) {
      setError('That file is larger than 10 MB.');
      return;
    }
    const body = new FormData();
    body.append('file', file);
    setBusy(true);
    try {
      const uploaded = await api<{ data: { id: string; url: string } }>('/v1/uploads', { method: 'POST', body });
      setUploadId(uploaded.data.id);
      setPreview(uploaded.data.url);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'The upload did not finish.');
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || short) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api<{ data: { id: string } }>('/v1/generations', {
        method: 'POST',
        json: {
          generationConfigurationId: selected.id,
          sourceUploadId: tool === 'image_to_video' ? uploadId : undefined,
          input: {
            ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
            ...(tool === 'ai_image' ? { aspectRatio } : {}),
          },
        },
      });
      router.push(`/generations/${response.data.id}`);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'We could not start that creation.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-xl flex-col gap-5 rounded-box border border-base-300 bg-base-100 p-4 md:p-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{toolLabel(tool)}</h1>
        <p className="mt-1 text-sm text-base-content/70">You can leave after it starts. The result stays in History.</p>
      </header>
      {!ready ? <div className="skeleton h-40 w-full" /> : null}
      {ready && cost === null ? (
        <div role="alert" className="alert alert-soft">
          <span>This tool is not available right now.</span>
        </div>
      ) : null}
      {tool !== 'ai_image' && configs.length > 0 ? (
        <Field label="Duration" hint="A longer clip costs more credits.">
          <select className="select w-full" value={configId} onChange={(event) => setConfigId(event.target.value)}>
            {configs.map((row) => (
              <option key={row.id} value={row.id}>
                {row.durationSeconds}s, {row.costCredits} credits
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {tool === 'ai_image' && ratios.length > 0 ? (
        <Field label="Aspect ratio">
          <select className="select w-full" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>
            {ratios.map((ratio) => (
              <option key={ratio} value={ratio}>
                {ratio}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {tool === 'image_to_video' ? (
        <Field label="Image" hint="JPEG, PNG, or WebP. Up to 10 MB.">
          <input
            type="file"
            className="file-input w-full"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => void onFile(event.target.files?.[0] ?? null)}
          />
          {busy && !preview ? <p className="label">Uploading…</p> : null}
          {preview ? <img src={preview} alt="Uploaded source" className="mt-2 max-h-64 rounded-box border border-base-300 object-contain" /> : null}
        </Field>
      ) : null}
      <Field
        label={tool === 'image_to_video' ? 'Motion guidance' : 'Prompt'}
        hint={tool === 'image_to_video' ? 'Optional. Describe how the image should move.' : `${prompt.length}/2000`}
      >
        <textarea
          className="textarea min-h-32 w-full"
          value={prompt}
          maxLength={2000}
          onChange={(event) => setPrompt(event.target.value)}
          required={tool !== 'image_to_video'}
        />
      </Field>
      {ready && cost !== null ? (
        <div className="stats stats-vertical w-full border border-base-300 sm:stats-horizontal">
          <div className="stat">
            <div className="stat-title">This creation</div>
            <div className="stat-value text-2xl tabular-nums">{cost}</div>
            <div className="stat-desc">credits</div>
          </div>
          <div className="stat">
            <div className="stat-title">Available</div>
            <div className="stat-value text-2xl tabular-nums">{available}</div>
            <div className="stat-desc">credits</div>
          </div>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="alert alert-error alert-soft">
          <span>{error}</span>
        </div>
      ) : null}
      {short ? (
        <p className="text-sm">
          You need more credits.{' '}
          <Link href="/wallet" className="underline decoration-base-300 underline-offset-4">
            Top up
          </Link>
        </p>
      ) : null}
      <button
        type="submit"
        className="btn btn-primary"
        disabled={busy || !selected || short || (tool === 'image_to_video' && !uploadId)}
      >
        {busy ? <span className="loading loading-spinner loading-sm" /> : null}
        {cost === null ? 'Unavailable' : `Create · ${cost} credits`}
      </button>
    </form>
  );
}
