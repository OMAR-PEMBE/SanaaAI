'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { Field } from '@/components/field';
import { api, ApiClientError, isValidEmail, safeNext, setToken } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const next = params.get('next');
  const clientErrors: Record<string, string> = {
    email: isValidEmail(email) ? '' : 'Enter a valid email.',
    password: password.length < 8 ? 'Use at least 8 characters.' : password.length > 72 ? 'Use at most 72 characters.' : '',
  };

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (clientErrors.email || clientErrors.password) {
      setFieldErrors(clientErrors);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      const body = await api<{ data: { accessToken: string } }>('/v1/auth/login', {
        method: 'POST',
        json: { email: email.trim(), password },
      });
      setToken(body.data.accessToken);
      router.push(safeNext(next));
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === 'VALIDATION_ERROR' && caught.fields) {
        setFieldErrors(caught.fields);
      } else if (caught instanceof ApiClientError) {
        setError(caught.code === 'INVALID_CREDENTIALS' ? 'Invalid email or password.' : caught.message);
      } else {
        setError('SanaaAI could not be reached. Try again.');
      }
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card card-border w-full bg-base-100">
      <div className="card-body gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
        <Field label="Email" error={fieldErrors.email || undefined}>
          <input
            className="input w-full"
            type="email"
            autoComplete="email"
            required
            aria-invalid={Boolean(fieldErrors.email)}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="Password" hint="At least 8 characters." error={fieldErrors.password || undefined}>
          <input
            className="input w-full"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            maxLength={72}
            aria-invalid={Boolean(fieldErrors.password)}
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
          Log in
        </button>
        <Link href="/forgot-password" className="text-sm underline decoration-base-300 underline-offset-4">
          Forgot password
        </Link>
        <Link
          href={`/register${next ? `?next=${encodeURIComponent(next)}` : ''}`}
          className="text-sm underline decoration-base-300 underline-offset-4"
        >
          Create an account
        </Link>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="skeleton mx-auto h-80 w-full max-w-md" />}>
      <AuthFrame>
        <LoginForm />
      </AuthFrame>
    </Suspense>
  );
}
