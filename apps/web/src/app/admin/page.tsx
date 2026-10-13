'use client';

import Link from 'next/link';
import { AdminNav } from '@/components/admin-panels';

const links = [
  ['/admin/users', 'Users', 'Search accounts, adjust credits, suspend or restore access.'],
  ['/admin/payments', 'Payments', 'See mobile-money top-ups and their status.'],
  ['/admin/generations', 'Creations', 'Review jobs and hide something from Explore.'],
  ['/admin/ledger', 'Ledger', 'Read wallet movements for one account or everyone.'],
];

export default function AdminHomePage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
      </header>
      <AdminNav />
      <ul className="grid gap-3 md:grid-cols-2">
        {links.map(([href, label, copy]) => (
          <li key={href}>
            <Link href={href} className="block rounded-box border border-base-300 px-4 py-4 hover:bg-base-200">
              <span className="font-medium">{label}</span>
              <span className="mt-1 block text-sm text-base-content/70">{copy}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
