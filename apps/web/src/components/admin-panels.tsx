'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Field } from '@/components/field';
import { api, ApiClientError, formatTzs, toolLabel } from '@/lib/api';

type Page<T> = { data: T[]; meta: { nextCursor: string | null } };

const adminLinks = [
  ['/admin', 'Overview'],
  ['/admin/users', 'Users'],
  ['/admin/payments', 'Payments'],
  ['/admin/generations', 'Creations'],
  ['/admin/ledger', 'Ledger'],
];

function AdminNavMenu() {
  const pathname = usePathname();
  return (
    <ul className="menu menu-horizontal menu-sm w-full flex-nowrap overflow-x-auto rounded-box bg-base-200">
      {adminLinks.map(([href, label]) => (
        <li key={href}>
          <Link href={href} className={`whitespace-nowrap ${pathname === href ? 'menu-active' : ''}`}>
            {label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function AdminNav() {
  return (
    <Suspense fallback={<div className="h-12 rounded-box bg-base-200" />}>
      <AdminNavMenu />
    </Suspense>
  );
}

type UserDetail = {
  id: string;
  fullName: string;
  email: string;
  role: string;
  status: string;
  wallet: { balanceCredits: number; heldCredits: number; availableCredits: number } | null;
  generationCount: number;
  paymentCount: number;
};

export function AdminUsers() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Array<{ id: string; fullName: string; email: string; role: string; status: string }>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [amount, setAmount] = useState('10');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function load(query = q) {
    void api<Page<{ id: string; fullName: string; email: string; role: string; status: string }>>(
      `/v1/admin/users?q=${encodeURIComponent(query)}`,
    ).then((body) => setRows(body.data));
  }

  useEffect(() => {
    load('');
    // Initial list only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function open(id: string) {
    setSelected(id);
    const body = await api<{ data: UserDetail }>(`/v1/admin/users/${id}`);
    setDetail(body.data);
  }

  async function act(path: string, json: unknown) {
    setMessage(null);
    try {
      await api(path, { method: 'POST', json });
      setOk(true);
      setMessage('Saved.');
      if (selected) await open(selected);
    } catch (caught) {
      setOk(false);
      setMessage(caught instanceof ApiClientError ? caught.message : 'That change was rejected.');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-semibold tracking-tight">Users</h1>
      <AdminNav />
      <form
        className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          load();
        }}
      >
        <Field label="Search">
          <input className="input w-full sm:w-80" value={q} onChange={(event) => setQ(event.target.value)} />
        </Field>
        <button type="submit" className="btn">
          Search
        </button>
      </form>
      <div className="overflow-x-auto rounded-box border border-base-300">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={selected === row.id ? 'bg-base-200' : undefined}>
                <td>
                  <button type="button" className="text-left underline decoration-base-300 underline-offset-4" onClick={() => void open(row.id)}>
                    {row.fullName}
                  </button>
                </td>
                <td>{row.email}</td>
                <td>{row.role}</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail ? (
        <div className="flex flex-col gap-4 rounded-box border border-base-300 p-4">
          <div>
            <p className="font-medium">{detail.fullName}</p>
            <p className="text-sm text-base-content/70">{detail.email}</p>
          </div>
          <div className="stats stats-vertical w-full border border-base-300 sm:stats-horizontal">
            <div className="stat">
              <div className="stat-title">Available</div>
              <div className="stat-value text-2xl tabular-nums">{detail.wallet?.availableCredits ?? 0}</div>
            </div>
            <div className="stat">
              <div className="stat-title">Creations</div>
              <div className="stat-value text-2xl tabular-nums">{detail.generationCount}</div>
            </div>
            <div className="stat">
              <div className="stat-title">Payments</div>
              <div className="stat-value text-2xl tabular-nums">{detail.paymentCount}</div>
            </div>
          </div>
          <Field label="Credits" hint="Use a negative number to remove credits. 1,000 or more asks the server to confirm.">
            <input className="input w-full" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </Field>
          <Field label="Reason" hint="Required for a credit change, a suspension, or a reactivation.">
            <textarea className="textarea min-h-20 w-full" value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!reason.trim()}
              onClick={() =>
                void act(`/v1/admin/users/${selected}/credit-adjustments`, {
                  amountCredits: Number(amount),
                  reason,
                  confirm: Math.abs(Number(amount)) >= 1000,
                })
              }
            >
              Adjust credits
            </button>
            <button type="button" className="btn" disabled={!reason.trim()} onClick={() => void act(`/v1/admin/users/${selected}/suspend`, { reason })}>
              Suspend
            </button>
            <button type="button" className="btn" disabled={!reason.trim()} onClick={() => void act(`/v1/admin/users/${selected}/reactivate`, { reason })}>
              Reactivate
            </button>
          </div>
          {message ? (
            <div role="status" className={`alert alert-soft ${ok ? 'alert-success' : 'alert-error'}`}>
              <span>{message}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AdminPayments() {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<Array<{ id: string; status: string; amountTzs: number; creditsGranted: number; userId: string }>>([]);
  useEffect(() => {
    const query = status ? `?status=${status}` : '';
    void api<Page<{ id: string; status: string; amountTzs: number; creditsGranted: number; userId: string }>>(`/v1/admin/payments${query}`).then((body) => setRows(body.data));
  }, [status]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-semibold tracking-tight">Payments</h1>
      <AdminNav />
      <Field label="Status">
        <select className="select w-full max-w-xs" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="failed">Failed</option>
        </select>
      </Field>
      <div className="overflow-x-auto rounded-box border border-base-300">
        <table className="table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Amount</th>
              <th>Credits</th>
              <th>User</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.status}</td>
                <td className="tabular-nums">{formatTzs(row.amountTzs)}</td>
                <td className="tabular-nums">{row.creditsGranted}</td>
                <td className="font-mono text-xs">{row.userId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminGenerations() {
  const [rows, setRows] = useState<Array<{ id: string; status: string; toolType: string; failureReason: string | null; assetId: string | null; userId: string }>>([]);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    void api<Page<{ id: string; status: string; toolType: string; failureReason: string | null; assetId: string | null; userId: string }>>('/v1/admin/generations').then((body) => setRows(body.data));
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-semibold tracking-tight">Creations</h1>
      <AdminNav />
      <Field label="Reason to hide" hint="Required before a published item can be removed from Explore.">
        <textarea className="textarea min-h-20 w-full" value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      <div className="overflow-x-auto rounded-box border border-base-300">
        <table className="table">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Status</th>
              <th>Failure</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{toolLabel(row.toolType)}</td>
                <td>{row.status}</td>
                <td className="max-w-xs text-xs">{row.failureReason ?? ''}</td>
                <td>
                  {row.assetId ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!reason.trim()}
                      onClick={() => {
                        void api(`/v1/admin/explore/${row.assetId}/hide`, { method: 'POST', json: { reason } })
                          .then(() => {
                            setOk(true);
                            setMessage('Hidden.');
                          })
                          .catch((caught) => {
                            setOk(false);
                            setMessage(caught instanceof ApiClientError ? caught.message : 'Not hidden.');
                          });
                      }}
                    >
                      Hide
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {message ? (
        <div role="status" className={`alert alert-soft ${ok ? 'alert-success' : 'alert-error'}`}>
          <span>{message}</span>
        </div>
      ) : null}
    </div>
  );
}

export function AdminLedger() {
  const [userId, setUserId] = useState('');
  const [rows, setRows] = useState<Array<{ id: string; type: string; amountCredits: number; description: string; userId: string }>>([]);
  function load(event?: React.FormEvent) {
    event?.preventDefault();
    const query = userId ? `?userId=${encodeURIComponent(userId)}` : '';
    void api<Page<{ id: string; type: string; amountCredits: number; description: string; userId: string }>>(`/v1/admin/wallet-transactions${query}`).then((body) => setRows(body.data));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-semibold tracking-tight">Ledger</h1>
      <AdminNav />
      <form onSubmit={load} className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end">
        <Field label="User id">
          <input className="input w-full sm:w-96" value={userId} onChange={(event) => setUserId(event.target.value)} />
        </Field>
        <button type="submit" className="btn">
          Filter
        </button>
      </form>
      <div className="overflow-x-auto rounded-box border border-base-300">
        <table className="table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Credits</th>
              <th>Description</th>
              <th>User</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.type}</td>
                <td className="tabular-nums">{row.amountCredits}</td>
                <td>{row.description}</td>
                <td className="font-mono text-xs">{row.userId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
