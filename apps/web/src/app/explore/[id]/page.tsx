'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api, ApiClientError, getToken, toolLabel, toolPath } from '@/lib/api';

type Item = { id: string; toolType: string; mimeType: string; url: string };

export default function ExploreItemPage() {
  return (
    <Suspense fallback={<div className="skeleton mx-auto aspect-square w-full max-w-xl" />}>
      <ExploreItem />
    </Suspense>
  );
}

function ExploreItem() {
  const params = useParams<{ id: string }>();
  const [item, setItem] = useState<Item | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    void api<{ data: Item }>(`/v1/explore/${params.id}`)
      .then((body) => setItem(body.data))
      .catch((caught) => {
        if (caught instanceof ApiClientError && caught.status === 404) setMissing(true);
        else setMissing(true);
      });
  }, [params.id]);

  if (missing) {
    return (
      <div className="mx-auto max-w-xl py-8">
        <h1 className="text-2xl font-semibold tracking-tight">This creation is no longer available.</h1>
        <p className="mt-2 text-sm text-base-content/70">It may have been unpublished or removed.</p>
        <Link href="/" className="btn mt-5">
          Back to Explore
        </Link>
      </div>
    );
  }
  if (!item) return <div className="skeleton mx-auto aspect-square w-full max-w-xl" />;
  const href = getToken() ? toolPath(item.toolType) : `/register?next=${encodeURIComponent(toolPath(item.toolType))}`;
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      {item.mimeType.startsWith('video/') ? (
        <video src={item.url} controls className="w-full rounded-box bg-base-200" />
      ) : (
        <img src={item.url} alt={toolLabel(item.toolType)} className="w-full rounded-box bg-base-200 object-contain" />
      )}
      <p className="text-sm text-base-content/70">{toolLabel(item.toolType)}</p>
      <Link href={href} className="btn btn-primary">
        Create something like this
      </Link>
    </div>
  );
}
