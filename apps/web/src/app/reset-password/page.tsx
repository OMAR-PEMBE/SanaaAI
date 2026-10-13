'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { Field } from '@/components/field';
import { api, ApiClientError } from '@/lib/api';

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api('/v1/auth/password/reset', {
        method: 'POST',
        json: { token: params.get('token') ?? '', newPassword: password },
      });
      router.push('/login');
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'This reset link is invalid or expired.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card card-border w-full bg-base-100">
      <div className="card-body gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <Field label="New password" hint="At least 8 characters.">
          <input
            className="input w-full"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {error ? (
          <div role="alert" className="alert alert-error alert-soft">
            <span>{error}</span>
          </div>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? <span className="loading loading-spinner loading-sm" /> : null}
          Update password
        </button>
      </div>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="skeleton mx-auto h-64 w-full max-w-md" />}>
      <AuthFrame>
        <ResetForm />
      </AuthFrame>
    </Suspense>
  );
}
