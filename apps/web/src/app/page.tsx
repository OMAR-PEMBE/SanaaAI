'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Clapperboard, Image as ImageIcon, Video } from 'lucide-react';
import { api, ApiClientError, getToken, toolLabel, toolPath } from '@/lib/api';

type Item = { id: string; assetId: string; toolType: string; mimeType: string; url: string; publishedAt: string };

const starters = [
  { href: '/create/image', title: 'AI Image', copy: 'From a description', icon: ImageIcon },
  { href: '/create/text-to-video', title: 'Text to Video', copy: 'From a description', icon: Video },
  { href: '/create/image-to-video', title: 'Image to Video', copy: 'From one still', icon: Clapperboard },
];

export default function ExplorePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setAuthed(Boolean(getToken()));
  }, []);

  function load(next?: string | null, append = false) {
    setLoading(true);
    const query = next ? `?cursor=${encodeURIComponent(next)}` : '';
    void api<{ data: Item[]; meta: { nextCursor: string | null } }>(`/v1/explore${query}`)
      .then((body) => {
        setItems((current) => (append ? [...current, ...body.data] : body.data));
        setCursor(body.meta.nextCursor);
        setError(null);
      })
      .catch((caught) => setError(caught instanceof ApiClientError ? caught.message : 'Explore could not be loaded.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let cancelled = false;
    void api<{ data: Item[]; meta: { nextCursor: string | null } }>('/v1/explore')
      .then((body) => {
        if (cancelled) return;
        setItems(body.data);
        setCursor(body.meta.nextCursor);
        setError(null);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiClientError ? caught.message : 'Explore could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <header className="max-w-2xl">
        <p className="text-sm font-semibold text-primary">Create. Promote. Grow.</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">Explore</h1>
        <p className="mt-3 text-lg leading-relaxed text-base-content/70">Images and short videos people chose to share.</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        {starters.map((tool) => {
          const Icon = tool.icon;
          const href = authed ? tool.href : `/register?next=${encodeURIComponent(tool.href)}`;
          return (
            <Link
              key={tool.href}
              href={href}
              className="flex items-center gap-3 rounded-box border border-base-300 bg-base-100 px-4 py-4 transition-colors hover:border-primary/40 hover:bg-base-200"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-box bg-primary/10 text-primary">
                <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span>
                <span className="block font-semibold">{tool.title}</span>
                <span className="block text-sm text-base-content/70">{tool.copy}</span>
              </span>
            </Link>
          );
        })}
      </div>
      {error ? (
        <div role="alert" className="alert alert-error alert-soft">
          <span>{error}</span>
          <button type="button" className="btn btn-sm" onClick={() => load()}>
            Retry
          </button>
        </div>
      ) : null}
      {loading && items.length === 0 ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="skeleton aspect-square w-full" />
          ))}
        </div>
      ) : null}
      {!loading && items.length === 0 && !error ? (
        <div className="rounded-box border border-base-300 bg-base-200 px-6 py-10">
          <p className="text-lg font-medium">No shared creations yet.</p>
          <p className="mt-1 max-w-[45ch] text-sm text-base-content/70">Be the first to make something and share it here.</p>
          <Link href="/register" className="btn btn-primary mt-5">
            Create the first one
          </Link>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-3">
        {items.map((item, index) => {
          const createHref = authed
            ? toolPath(item.toolType)
            : `/register?next=${encodeURIComponent(toolPath(item.toolType))}`;
          return (
            <article key={item.assetId} className={index === 0 ? 'col-span-2 md:col-span-2' : undefined}>
              <Link href={`/explore/${item.id}`} className="block overflow-hidden rounded-box border border-base-300 bg-base-200">
                {item.mimeType.startsWith('video/') ? (
                  <video
                    src={item.url}
                    className={`w-full bg-base-200 object-cover ${index === 0 ? 'aspect-[16/10]' : 'aspect-square'}`}
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <img
                    src={item.url}
                    alt={toolLabel(item.toolType)}
                    className={`w-full bg-base-200 object-cover ${index === 0 ? 'aspect-[16/10]' : 'aspect-square'}`}
                  />
                )}
              </Link>
              <div className="mt-2 flex flex-col items-start gap-1 text-sm">
                <span className="badge badge-ghost">{toolLabel(item.toolType)}</span>
                <Link href={createHref} className="underline decoration-base-300 underline-offset-4">
                  Create something like this
                </Link>
              </div>
            </article>
          );
        })}
      </div>
      {cursor ? (
        <button type="button" className="btn" disabled={loading} onClick={() => load(cursor, true)}>
          {loading ? <span className="loading loading-spinner loading-sm" /> : null}
          {loading ? 'Loading' : 'Load more'}
        </button>
      ) : null}
    </div>
  );
}
