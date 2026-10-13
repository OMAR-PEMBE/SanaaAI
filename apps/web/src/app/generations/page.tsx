'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Field, PageIntro } from '@/components/field';
import { api, ApiClientError, formatWhen, statusLabel, toolLabel, visibilityLabel } from '@/lib/api';

type Row = {
  id: string;
  toolType: string;
  status: string;
  costCredits: number;
  createdAt: string;
  visibility: string;
  outputAsset: { url: string; mimeType: string } | null;
};

export default function HistoryPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [toolType, setToolType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load(next?: string | null, append = false, filters = { status, toolType }) {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.toolType) params.set('toolType', filters.toolType);
    if (next) params.set('cursor', next);
    void api<{ data: Row[]; meta: { nextCursor: string | null } }>(`/v1/generations?${params.toString()}`)
      .then((body) => {
        setRows((current) => (append ? [...current, ...body.data] : body.data));
        setCursor(body.meta.nextCursor);
        setError(null);
      })
      .catch((caught) => setError(caught instanceof ApiClientError ? caught.message : 'History could not be loaded.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load(null, false);
    // Filters are applied by the select handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <PageIntro title="History" lede="Your creations, including ones still in progress." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Status">
          <select
            className="select w-full"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setLoading(true);
              load(null, false, { status: event.target.value, toolType });
            }}
          >
            <option value="">All statuses</option>
            <option value="processing">Creating</option>
            <option value="completed">Ready</option>
            <option value="failed">Failed</option>
          </select>
        </Field>
        <Field label="Tool">
          <select
            className="select w-full"
            value={toolType}
            onChange={(event) => {
              setToolType(event.target.value);
              setLoading(true);
              load(null, false, { status, toolType: event.target.value });
            }}
          >
            <option value="">All tools</option>
            <option value="ai_image">AI Image</option>
            <option value="text_to_video">Text to Video</option>
            <option value="image_to_video">Image to Video</option>
          </select>
        </Field>
      </div>
      {error ? (
        <div role="alert" className="alert alert-error alert-soft">
          <span>{error}</span>
          <button type="button" className="btn btn-sm" onClick={() => { setLoading(true); load(); }}>
            Retry
          </button>
        </div>
      ) : null}
      {loading && rows.length === 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="skeleton h-28 w-full" />
          ))}
        </div>
      ) : null}
      {!loading && rows.length === 0 && !error ? <p className="text-sm text-base-content/70">No creations match this view.</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <Link key={row.id} href={`/generations/${row.id}`} className="flex gap-3 rounded-box border border-base-300 p-3 hover:bg-base-200">
            {row.outputAsset ? (
              row.outputAsset.mimeType.startsWith('video/') ? (
                <video src={row.outputAsset.url} muted className="size-20 shrink-0 rounded-box bg-base-200 object-cover" />
              ) : (
                <img src={row.outputAsset.url} alt="" className="size-20 shrink-0 rounded-box bg-base-200 object-cover" />
              )
            ) : (
              <span className="size-20 shrink-0 rounded-box bg-base-200" />
            )}
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-medium">{toolLabel(row.toolType)}</span>
              <span className="flex flex-wrap gap-1">
                <span className="badge badge-ghost badge-sm">{statusLabel(row.status)}</span>
                <span className="badge badge-ghost badge-sm">{visibilityLabel(row.visibility)}</span>
              </span>
              <span className="text-sm text-base-content/60">
                <span className="tabular-nums">{row.costCredits} credits</span>
                <span className="ml-2">{formatWhen(row.createdAt)}</span>
              </span>
            </span>
          </Link>
        ))}
      </div>
      {cursor ? (
        <button type="button" className="btn" disabled={loading} onClick={() => { setLoading(true); load(cursor, true); }}>
          {loading ? 'Loading' : 'Load more'}
        </button>
      ) : null}
    </div>
  );
}
