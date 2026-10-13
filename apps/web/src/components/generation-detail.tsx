'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiClientError, statusLabel, toolLabel, toolPath, visibilityLabel } from '@/lib/api';

type Generation = {
  id: string;
  status: string;
  toolType: string;
  costCredits: number;
  input: { prompt?: string };
  outputAsset: { id: string; mimeType: string; url: string } | null;
  visibility: string;
  failureMessage: string | null;
  createdAt: string;
};

export function GenerationDetail({ id }: { id: string }) {
  const [item, setItem] = useState<Generation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageError, setMessageError] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    const load = () => {
      void api<{ data: Generation }>(`/v1/generations/${id}`)
        .then((body) => {
          if (!active) return;
          setItem(body.data);
          if (body.data.status !== 'completed' && body.data.status !== 'failed') {
            timer = setTimeout(load, 2500);
          }
        })
        .catch((caught) => {
          if (!active) return;
          setError(caught instanceof ApiClientError ? caught.message : 'Not found.');
        });
    };
    load();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  async function refreshDownload() {
    if (!item?.outputAsset) return;
    const body = await api<{ data: { url: string } }>(`/v1/assets/${item.outputAsset.id}/download`);
    window.location.href = body.data.url;
  }

  async function setVisibility(publish: boolean) {
    setMessage(null);
    setMessageError(false);
    try {
      await api(`/v1/generations/${id}/${publish ? 'publish' : 'unpublish'}`, { method: 'POST' });
      const body = await api<{ data: Generation }>(`/v1/generations/${id}`);
      setItem(body.data);
      setMessage(publish ? 'Shared to Explore.' : 'Kept private.');
    } catch (caught) {
      setMessageError(true);
      setMessage(caught instanceof ApiClientError ? caught.message : 'That change did not save.');
    }
  }

  if (error) {
    return (
      <div role="alert" className="alert alert-error alert-soft mx-auto max-w-xl">
        <span>{error}</span>
      </div>
    );
  }
  if (!item) return <div className="skeleton mx-auto h-80 w-full max-w-xl" />;

  const working = item.status === 'pending' || item.status === 'submitted' || item.status === 'processing';
  const copy = item.status === 'failed'
    ? item.failureMessage
    : item.status === 'pending' || item.status === 'submitted'
      ? 'Starting…'
      : item.status === 'processing'
        ? item.toolType === 'ai_image'
          ? 'Creating your image…'
          : 'Creating your video…'
        : 'Ready';

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <div>
        <p className="text-sm text-base-content/70">
          {toolLabel(item.toolType)} · {item.costCredits} credits
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {working ? copy : item.status === 'failed' ? 'Could not finish' : 'Your creation'}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="badge badge-ghost">{statusLabel(item.status)}</span>
          {item.status === 'completed' ? <span className="badge badge-ghost">{visibilityLabel(item.visibility)}</span> : null}
        </div>
      </div>
      {working ? (
        <div role="status" className="flex items-center gap-3 rounded-box border border-base-300 px-4 py-5">
          <span className="loading loading-spinner" />
          <div>
            <p>{copy}</p>
            <p className="text-sm text-base-content/70">You can leave this page. The result stays in History.</p>
          </div>
        </div>
      ) : null}
      {item.outputAsset ? (
        item.outputAsset.mimeType.startsWith('video/') ? (
          <video src={item.outputAsset.url} controls className="w-full rounded-box border border-base-300 bg-base-200" />
        ) : (
          <img src={item.outputAsset.url} alt={toolLabel(item.toolType)} className="w-full rounded-box border border-base-300 object-contain" />
        )
      ) : null}
      {item.status === 'failed' ? (
        <div role="alert" className="alert alert-error alert-soft">
          <span>{item.failureMessage ?? 'Something went wrong. Your credits have been returned.'}</span>
        </div>
      ) : null}
      {item.status === 'completed' ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={() => void refreshDownload()}>
            Download
          </button>
          {item.visibility === 'published' ? (
            <button type="button" className="btn" onClick={() => void setVisibility(false)}>
              Keep private
            </button>
          ) : item.visibility === 'rejected' ? (
            <p className="text-sm">This creation cannot be shared.</p>
          ) : (
            <button type="button" className="btn" onClick={() => void setVisibility(true)}>
              Share to Explore
            </button>
          )}
          <Link
            href={`${toolPath(item.toolType)}?prompt=${encodeURIComponent(item.input.prompt ?? '')}`}
            className="btn"
          >
            Create again · {item.costCredits} credits
          </Link>
        </div>
      ) : null}
      {item.status === 'completed' && item.visibility !== 'rejected' ? (
        <p className="text-sm text-base-content/70">
          {item.visibility === 'published'
            ? 'This is on the public Explore page.'
            : 'Sharing puts this on the public Explore page. It stays private until you do.'}
        </p>
      ) : null}
      {item.status === 'failed' ? (
        <Link href={toolPath(item.toolType)} className="btn btn-primary">
          Try again
        </Link>
      ) : null}
      {message ? (
        <div role="status" className={`alert alert-soft ${messageError ? 'alert-error' : 'alert-success'}`}>
          <span>{message}</span>
        </div>
      ) : null}
      {!working ? <p className="text-xs text-base-content/60">You can leave this page. The result stays in History.</p> : null}
    </div>
  );
}
