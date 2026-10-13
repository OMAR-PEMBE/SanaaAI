'use client';

import { Moon, Sun } from 'lucide-react';

export function ThemeToggle() {
  return (
    <label className="btn btn-ghost btn-sm btn-square" title="Switch theme">
      <input
        ref={(node) => {
          if (node) node.checked = document.documentElement.getAttribute('data-theme') === 'sanaa-dark';
        }}
        type="checkbox"
        className="theme-controller sr-only"
        value="sanaa-dark"
        aria-label="Use dark theme"
        onChange={(event) => {
          const next = event.target.checked;
          localStorage.setItem('sanaaai.theme', next ? 'sanaa-dark' : 'sanaa');
          document.documentElement.setAttribute('data-theme', next ? 'sanaa-dark' : 'sanaa');
        }}
      />
      <Sun className="when-dark size-4" strokeWidth={1.75} />
      <Moon className="when-light size-4" strokeWidth={1.75} />
    </label>
  );
}
