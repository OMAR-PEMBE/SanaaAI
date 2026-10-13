'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field, PageIntro } from '@/components/field';
import { api, ApiClientError, getToken, setToken } from '@/lib/api';

type Profile = { fullName: string; email: string; role: string };

export default function AccountPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    void api<{ data: Profile }>('/v1/auth/me').then((body) => setProfile(body.data));
  }, [router]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      const body = await api<{ data: { accessToken: string } }>('/v1/auth/password/change', {
        method: 'POST',
        json: { currentPassword, newPassword },
      });
      setToken(body.data.accessToken);
      setCurrentPassword('');
      setNewPassword('');
      setOk(true);
      setMessage('Password updated.');
    } catch (caught) {
      setOk(false);
      setMessage(caught instanceof ApiClientError ? caught.message : 'The password was not changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <PageIntro title="Account" />
      {profile ? (
        <div className="rounded-box border border-base-300 px-4 py-4">
          <p className="font-medium">{profile.fullName}</p>
          <p className="text-sm text-base-content/70">{profile.email}</p>
          {profile.role === 'admin' ? (
            <Link href="/admin" className="mt-3 inline-block text-sm underline decoration-base-300 underline-offset-4">
              Admin
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="skeleton h-20 w-full" />
      )}
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Change password</h2>
        <Field label="Current password">
          <input
            className="input w-full"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </Field>
        <Field label="New password" hint="At least 8 characters.">
          <input
            className="input w-full"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </Field>
        {message ? (
          <div role="status" className={`alert alert-soft ${ok ? 'alert-success' : 'alert-error'}`}>
            <span>{message}</span>
          </div>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? <span className="loading loading-spinner loading-sm" /> : null}
          Update password
        </button>
      </form>
    </div>
  );
}
