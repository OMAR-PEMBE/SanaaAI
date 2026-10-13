'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Clapperboard, Image as ImageIcon, Video } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api, ApiClientError, formatWhen, getToken, statusLabel, toolLabel } from '@/lib/api';

type Wallet = { balanceCredits: number; heldCredits: number };
type Generation = { id: string; toolType: string; status: string; costCredits: number; createdAt?: string };

const tools = [
  { href: '/create/image', title: 'AI Image', copy: 'Create an image from a description.', icon: ImageIcon },
  { href: '/create/text-to-video', title: 'Text to Video', copy: 'Create a short video from a description.', icon: Video },
  { href: '/create/image-to-video', title: 'Image to Video', copy: 'Turn one image into a short video.', icon: Clapperboard },
];

export default function DashboardPage() {
  const router = useRouter();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [recent, setRecent] = useState<Generation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    void Promise.all([
      api<{ data: Wallet }>('/v1/wallet'),
      api<{ data: Generation[] }>('/v1/generations?limit=4'),
    ])
      .then(([walletBody, recentBody]) => {
        setWallet(walletBody.data);
        setRecent(recentBody.data);
      })
      .catch((caught) => setError(caught instanceof ApiClientError ? caught.message : 'The dashboard could not be loaded.'))
      .finally(() => setLoading(false));
  }, [router]);

  const available = wallet ? wallet.balanceCredits - wallet.heldCredits : null;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
      </header>
      {error ? (
        <div role="alert" className="alert alert-error alert-soft">
          <span>{error}</span>
        </div>
      ) : null}
      {loading ? (
        <div className="skeleton h-28 w-full" />
      ) : (
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
              <div className="stat-desc">reserved until the creation finishes</div>
            </div>
          ) : null}
        </div>
      )}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Make something</h2>
        <ul className="grid gap-3 md:grid-cols-3">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <li key={tool.href}>
                <Link
                  href={tool.href}
                  className="flex h-full flex-col gap-4 rounded-box border border-base-300 bg-base-100 p-4 transition-colors hover:border-primary/40 hover:bg-base-200"
                >
                  <span className="grid size-10 place-items-center rounded-box bg-primary/10 text-primary">
                    <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block font-semibold">{tool.title}</span>
                    <span className="mt-1 block text-sm text-base-content/70">{tool.copy}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Recent creations</h2>
          <Link href="/generations" className="text-sm underline decoration-base-300 underline-offset-4">
            History
          </Link>
        </div>
        {!loading && recent.length === 0 ? (
          <p className="text-sm text-base-content/70">Nothing here yet. Open a tool above to start.</p>
        ) : null}
        <ul className="flex flex-col gap-2">
          {recent.map((item) => (
            <li key={item.id}>
              <Link
                href={`/generations/${item.id}`}
                className="flex items-center justify-between gap-3 rounded-box border border-base-300 px-3 py-3 text-sm hover:bg-base-200"
              >
                <span className="font-medium">{toolLabel(item.toolType)}</span>
                <span className="text-base-content/70">
                  <span className="badge badge-ghost badge-sm">{statusLabel(item.status)}</span>
                  <span className="ml-2 tabular-nums">{item.costCredits} credits</span>
                  {item.createdAt ? <span className="ml-2 hidden sm:inline">{formatWhen(item.createdAt)}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
