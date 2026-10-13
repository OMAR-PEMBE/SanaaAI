'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Clock, Compass, Plus, User, Wallet } from 'lucide-react';
import { api, getToken, setToken } from '@/lib/api';
import { ThemeToggle } from '@/components/theme-toggle';

type Profile = { id: string; fullName: string; email: string; role: string };
type WalletView = { balanceCredits: number; heldCredits: number };

const tabs = [
  { href: '/', label: 'Explore', icon: Compass },
  { href: '/dashboard', label: 'Create', icon: Plus },
  { href: '/generations', label: 'History', icon: Clock },
  { href: '/wallet', label: 'Wallet', icon: Wallet },
  { href: '/account', label: 'Account', icon: User },
];

function tabActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/' || pathname.startsWith('/explore');
  if (href === '/dashboard') return pathname.startsWith('/dashboard') || pathname.startsWith('/create');
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavigationRefresh() {
  const pathname = usePathname();
  useEffect(() => {
    window.dispatchEvent(new Event('sanaaai-session'));
  }, [pathname]);
  return null;
}

function MobileNav({ authed }: { authed: boolean }) {
  const pathname = usePathname();
  return (
    <div className="dock dock-sm z-30 md:hidden">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = tabActive(tab.href, pathname);
        return (
          <Link
            key={tab.href}
            href={authed || tab.href === '/' ? tab.href : '/login'}
            className={active ? 'dock-active' : undefined}
            aria-current={active ? 'page' : undefined}
          >
            <Icon className="size-5" strokeWidth={1.75} />
            <span className="dock-label">{tab.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

function HeaderBar({
  profile,
  wallet,
  onLogout,
}: {
  profile: Profile | null;
  wallet: WalletView | null;
  onLogout: () => void;
}) {
  const pathname = usePathname();
  const available = wallet ? wallet.balanceCredits - wallet.heldCredits : null;
  const onLogin = pathname === '/login';
  const onRegister = pathname === '/register';

  return (
    <div className="navbar mx-auto h-16 min-h-16 w-full max-w-6xl flex-nowrap px-3 md:px-4">
      <div className="flex min-w-0 items-center gap-1">
        <Link href="/" className="flex items-center gap-2 px-2 text-base font-semibold tracking-tight whitespace-nowrap">
          <span className="grid size-7 place-items-center rounded-box bg-primary text-sm text-primary-content">S</span>
          SanaaAI
        </Link>
        <ul className="menu menu-horizontal menu-sm hidden px-0 md:flex">
          <li>
            <Link href="/" className={tabActive('/', pathname) ? 'menu-active' : undefined}>
              Explore
            </Link>
          </li>
          {profile ? (
            <li>
              <Link href="/dashboard" className={tabActive('/dashboard', pathname) ? 'menu-active' : undefined}>
                Dashboard
              </Link>
            </li>
          ) : null}
          {profile ? (
            <li>
              <Link href="/generations" className={tabActive('/generations', pathname) ? 'menu-active' : undefined}>
                History
              </Link>
            </li>
          ) : null}
        </ul>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <ThemeToggle />
        {profile && available !== null ? (
          <>
            <Link href="/wallet" className="btn btn-ghost btn-sm px-2 tabular-nums whitespace-nowrap">
              {available}
              <span className="hidden md:inline">credits</span>
              {wallet && wallet.heldCredits > 0 ? (
                <span className="hidden text-base-content/60 lg:inline">{wallet.heldCredits} in progress</span>
              ) : null}
            </Link>
            <Link href="/wallet" className="btn btn-sm whitespace-nowrap">
              Top up
            </Link>
            <details className="dropdown dropdown-end max-md:hidden">
              <summary className="btn btn-ghost btn-sm whitespace-nowrap">{profile.fullName.split(' ')[0]}</summary>
              <ul className="dropdown-content menu z-40 mt-2 w-48 rounded-box border border-base-300 bg-base-100 p-1">
                <li>
                  <Link href="/account">Account</Link>
                </li>
                {profile.role === 'admin' ? (
                  <li>
                    <Link href="/admin">Admin</Link>
                  </li>
                ) : null}
                <li>
                  <button type="button" onClick={onLogout}>
                    Log out
                  </button>
                </li>
              </ul>
            </details>
          </>
        ) : (
          <>
            {onLogin ? null : (
              <Link href="/login" className="btn btn-ghost btn-sm whitespace-nowrap">
                Log in
              </Link>
            )}
            {onRegister ? null : (
              <Link href="/register" className="btn btn-sm whitespace-nowrap">
                Register
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function HeaderFallback() {
  return (
    <div className="navbar mx-auto h-16 min-h-16 w-full max-w-6xl px-4">
      <Link href="/" className="flex items-center gap-2 px-2 text-base font-semibold tracking-tight">
        <span className="grid size-7 place-items-center rounded-box bg-primary text-sm text-primary-content">S</span>
        SanaaAI
      </Link>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [wallet, setWallet] = useState<WalletView | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      if (!getToken()) {
        setProfile(null);
        setWallet(null);
        return;
      }
      void api<{ data: Profile }>('/v1/auth/me')
        .then((body) => {
          if (!active) return;
          setProfile(body.data);
          return api<{ data: WalletView }>('/v1/wallet');
        })
        .then((body) => {
          if (active && body) setWallet(body.data);
        })
        .catch(() => {
          if (!active) return;
          setProfile(null);
          setWallet(null);
        });
    };
    load();
    window.addEventListener('sanaaai-session', load);
    return () => {
      active = false;
      window.removeEventListener('sanaaai-session', load);
    };
  }, []);

  function logOut() {
    void api('/v1/auth/logout', { method: 'POST' }).finally(() => setToken(null));
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-30 border-b border-base-300 bg-base-100/90 backdrop-blur">
        <Suspense fallback={<HeaderFallback />}>
          <HeaderBar profile={profile} wallet={wallet} onLogout={logOut} />
        </Suspense>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      <footer className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 pt-2 pb-24 text-sm text-base-content/60 md:pb-8">
        <p>Create. Promote. Grow.</p>
        <Link href="/privacy" className="underline decoration-base-300 underline-offset-4">
          Privacy
        </Link>
      </footer>
      <Suspense fallback={null}>
        <NavigationRefresh />
      </Suspense>
      <Suspense
        fallback={
          <div className="dock dock-sm z-30 md:hidden">
            {tabs.map((tab) => (
              <Link key={tab.href} href={tab.href}>
                <tab.icon className="size-5" strokeWidth={1.75} />
                <span className="dock-label">{tab.label}</span>
              </Link>
            ))}
          </div>
        }
      >
        <MobileNav authed={Boolean(profile)} />
      </Suspense>
    </div>
  );
}

export function signOut(): void {
  setToken(null);
}
