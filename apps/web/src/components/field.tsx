export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="fieldset p-0">
      <legend className="fieldset-legend">{label}</legend>
      {children}
      {error ? <p className="label text-error">{error}</p> : hint ? <p className="label text-base-content/70">{hint}</p> : null}
    </fieldset>
  );
}

export function PageIntro({ title, lede }: { title: string; lede?: string }) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
      {lede ? <p className="max-w-[65ch] text-base leading-relaxed text-base-content/70">{lede}</p> : null}
    </header>
  );
}
