'use client';

import { Suspense } from 'react';
import { CreateForm } from '@/components/create-form';

export default function Page() {
  return (
    <Suspense>
      <CreateForm tool="ai_image" />
    </Suspense>
  );
}
