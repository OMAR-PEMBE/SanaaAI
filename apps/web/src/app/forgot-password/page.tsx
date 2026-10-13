'use client';

import { useState } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { Field } from '@/components/field';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    await api('/v1/auth/password/forgot', { method: 'POST', json: { email } }).catch(() => undefined);
    setSent(true);
    setBusy(false);
  }

  return (
    <AuthFrame>
    <form onSubmit={onSubmit} className="card card-border w-full bg-base-100">
      <div className="card-body gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        {sent ? (
          <div role="status" className="alert alert-success alert-soft">
            <span>If that email exists, a reset link has been sent.</span>
          </div>
        ) : null}
        <Field label="Email">
          <input className="input w-full" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? <span className="loading loading-spinner loading-sm" /> : null}
          Send reset link
        </button>
      </div>
    </form>
    </AuthFrame>
  );
}
