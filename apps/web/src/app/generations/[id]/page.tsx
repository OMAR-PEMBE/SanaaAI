'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { GenerationDetail } from '@/components/generation-detail';

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <GenerationRoute />
    </Suspense>
  );
}

function GenerationRoute() {
  const params = useParams<{ id: string }>();
  return <GenerationDetail id={params.id} />;
}
