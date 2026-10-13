'use client';

import { useEffect, useState } from 'react';
import { Field, PageIntro } from '@/components/field';
import { api, ApiClientError, formatTzs, formatWhen } from '@/lib/api';

type Wallet = { balanceCredits: number; heldCredits: number };
type Package = { id: string; amountTzs: number; creditsGranted: number };
type Payment = { id: string; status: string; amountTzs: number; creditsGranted: number; devSimulation?: boolean };
type Entry = { id: string; type: string; amountCredits: number; description: string; balanceAfter: number; createdAt: string };

export default function WalletPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [packageId, setPackageId] = useState('');
  const [phone, setPhone] = useState('');
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  function refresh() {
    void api<{ data: Wallet }>('/v1/wallet').then((body) => {
      setWallet(body.data);
      window.dispatchEvent(new Event('sanaaai-session'));
    });
    void api<{ data: Entry[]; meta: { nextCursor: string | null } }>('/v1/wallet/transactions').then((body) => {
      setEntries(body.data);
      setCursor(body.meta.nextCursor);
    });
  }

  useEffect(() => {
    void api<{ data: Package[] }>('/v1/wallet/packages')
      .then((body) => {
        setPackages(body.data);
        setPackageId(body.data[0]?.id ?? '');
      })
      .catch((caught) => setError(caught instanceof ApiClientError ? caught.message : 'Packages could not be loaded.'));
    void Promise.all([
      api<{ data: Wallet }>('/v1/wallet'),
      api<{ data: Entry[]; meta: { nextCursor: string | null } }>('/v1/wallet/transactions'),
    ])
      .then(([walletBody, entriesBody]) => {
        setWallet(walletBody.data);
        setEntries(entriesBody.data);
        setCursor(entriesBody.meta.nextCursor);
      })
      .catch((caught) => setError(caught instanceof ApiClientError ? caught.message : 'The wallet could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!payment || payment.status !== 'pending') return undefined;
    const timer = setInterval(() => {
      void api<{ data: Payment }>(`/v1/payments/${payment.id}`).then((body) => {
        setPayment(body.data);
        if (body.data.status !== 'pending') refresh();
      });
    }, 2500);
    return () => clearInterval(timer);
  }, [payment]);

  async function topUp(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = await api<{ data: Payment }>('/v1/payments/topups', {
        method: 'POST',
        json: { creditPackageId: packageId, mobileMoneyDetails: { phoneNumber: phone } },
      });
      setPayment(body.data);
      if (body.data.devSimulation) {
        await api(`/v1/payments/${body.data.id}/dev-confirm`, { method: 'POST' });
        const confirmed = await api<{ data: Payment }>(`/v1/payments/${body.data.id}`);
        setPayment(confirmed.data);
        refresh();
      }
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'The payment could not be started.');
    } finally {
      setBusy(false);
    }
  }

  const available = wallet ? wallet.balanceCredits - wallet.heldCredits : null;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
      <PageIntro title="Wallet" lede="Pay with mobile money. Credits appear when the payment confirms." />
      {loading ? (
        <div className="skeleton h-28 w-full" />
      ) : wallet ? (
        <div className="stats stats-vertical w-full border border-base-300 sm:stats-horizontal">
          <div className="stat">
            <div className="stat-title">Available</div>
            <div className="stat-value tabular-nums">{available ?? '…'}</div>
            <div className="stat-desc">credits</div>
          </div>
          {wallet && wallet.heldCredits > 0 ? (
            <div className="stat">
              <div className="stat-title">In progress</div>
              <div className="stat-value tabular-nums">{wallet.heldCredits}</div>
              <div className="stat-desc">reserved for a creation</div>
            </div>
          ) : null}
        </div>
      ) : null}
      <form onSubmit={topUp} className="flex flex-col gap-4 rounded-box border border-base-300 p-4">
        <h2 className="text-lg font-semibold">Top up</h2>
        {error ? (
          <div role="alert" className="alert alert-error alert-soft">
            <span>{error}</span>
          </div>
        ) : null}
        {packages.length > 0 ? (
          <fieldset className="fieldset p-0">
            <legend className="fieldset-legend">Package</legend>
            <div className="flex flex-col gap-2">
              {packages.map((item) => (
                <label key={item.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-box border border-base-300 px-3 py-3 has-checked:border-base-content">
                  <span className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="package"
                      className="radio"
                      checked={packageId === item.id}
                      onChange={() => setPackageId(item.id)}
                    />
                    <span className="font-medium tabular-nums">{item.creditsGranted} credits</span>
                  </span>
                  <span className="text-sm tabular-nums text-base-content/70">{formatTzs(item.amountTzs)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : loading ? (
          <div className="skeleton h-16 w-full" />
        ) : null}
        <Field label="Mobile money number" hint="The number that will approve this payment.">
          <input
            className="input w-full"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="0712 345 678"
            required
          />
        </Field>
        {payment ? (
          <div role="status" className={`alert alert-soft ${payment.status === 'failed' ? 'alert-error' : payment.status === 'confirmed' ? 'alert-success' : ''}`}>
            {payment.status === 'pending' ? <span className="loading loading-spinner loading-sm" /> : null}
            <span>
              Payment {payment.status === 'confirmed' ? 'confirmed' : payment.status === 'failed' ? 'failed' : 'pending'}.
              {payment.status === 'pending' ? ' Approve it on your phone.' : null}
            </span>
          </div>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={busy || !packageId}>
          {busy ? <span className="loading loading-spinner loading-sm" /> : null}
          Pay with mobile money
        </button>
      </form>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Transactions</h2>
        {entries.length === 0 ? <p className="text-sm text-base-content/70">No transactions yet.</p> : null}
        <ul className="flex flex-col">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start justify-between gap-4 border-b border-base-300 py-3 text-sm last:border-b-0">
              <span>
                <span className="block">{entry.description}</span>
                <span className="text-base-content/60">{formatWhen(entry.createdAt)}</span>
              </span>
              <span className={`tabular-nums ${entry.amountCredits > 0 ? 'text-success' : 'text-base-content/70'}`}>
                {entry.amountCredits > 0 ? '+' : ''}
                {entry.amountCredits}
              </span>
            </li>
          ))}
        </ul>
        {cursor ? (
          <button
            type="button"
            className="btn"
            onClick={() => {
              void api<{ data: Entry[]; meta: { nextCursor: string | null } }>(`/v1/wallet/transactions?cursor=${encodeURIComponent(cursor)}`).then((body) => {
                setEntries((current) => [...current, ...body.data]);
                setCursor(body.meta.nextCursor);
              });
            }}
          >
            Load more
          </button>
        ) : null}
      </section>
    </div>
  );
}
