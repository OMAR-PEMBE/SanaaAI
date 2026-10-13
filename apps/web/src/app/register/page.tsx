'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { Field } from '@/components/field';
import { api, ApiClientError, isValidEmail, safeNext, setToken } from '@/lib/api';

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const name = fullName.trim();
  const clientErrors: Record<string, string> = {
    fullName: name.length === 0 ? 'Enter your name.' : name.length > 120 ? 'Use 120 characters or fewer.' : '',
    email: isValidEmail(email) ? '' : 'Enter a valid email.',
    password: password.length < 8 ? 'Use at least 8 characters.' : password.length > 72 ? 'Use at most 72 characters.' : '',
  };
  const ready = !clientErrors.fullName && !clientErrors.email && !clientErrors.password;

  function shown(name: string): string | undefined {
    return fieldErrors[name] || (touched[name] ? clientErrors[name] : '') || undefined;
  }

  function touch(name: string) {
    setTouched((current) => ({ ...current, [name]: true }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setTouched({ fullName: true, email: true, password: true });
    setFieldErrors({});
    setError(null);
    if (!ready) return;
    setBusy(true);
    try {
      const body = await api<{ data: { accessToken: string } }>('/v1/auth/register', {
        method: 'POST',
        json: { fullName: name, email: email.trim(), password },
      });
      setToken(body.data.accessToken);
      router.push(safeNext(params.get('next')));
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.fields && Object.keys(caught.fields).length > 0) {
        setFieldErrors(caught.fields);
      } else if (caught instanceof ApiClientError) {
        setError(caught.message);
      } else {
        setError('SanaaAI could not be reached. Try again.');
      }
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card card-border w-full bg-base-100">
      <div className="card-body gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <Field label="Full name" error={shown('fullName')}>
          <input
            className="input w-full"
            autoComplete="name"
            required
            aria-invalid={Boolean(shown('fullName'))}
            value={fullName}
            onBlur={() => touch('fullName')}
            onChange={(event) => setFullName(event.target.value)}
          />
        </Field>
        <Field label="Email" error={shown('email')}>
          <input
            className="input w-full"
            type="email"
            autoComplete="email"
            required
            aria-invalid={Boolean(shown('email'))}
            value={email}
            onBlur={() => touch('email')}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="Password" hint="At least 8 characters." error={shown('password')}>
          <input
            className="input w-full"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            aria-invalid={Boolean(shown('password'))}
            value={password}
            onBlur={() => touch('password')}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {error ? (
          <div role="alert" className="alert alert-error alert-soft">
            <span>{error}</span>
          </div>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={!ready || busy}>
          {busy ? <span className="loading loading-spinner loading-sm" /> : null}
          Register
        </button>
        <Link href="/login" className="text-sm underline decoration-base-300 underline-offset-4">
          Already have an account
        </Link>
      </div>
    </form>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="skeleton mx-auto h-96 w-full max-w-md" />}>
      <AuthFrame>
        <RegisterForm />
      </AuthFrame>
    </Suspense>
  );
}
