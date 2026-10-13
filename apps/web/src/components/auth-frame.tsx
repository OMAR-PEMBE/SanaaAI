export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-5xl items-center gap-8 md:grid-cols-2 md:gap-16">
      <div className="max-md:hidden">
        <p className="text-sm font-semibold text-primary">Create. Promote. Grow.</p>
        <p className="mt-3 max-w-sm text-4xl font-semibold tracking-tight">Images and short videos, with the price shown first.</p>
        <p className="mt-4 max-w-sm text-base leading-relaxed text-base-content/70">
          Pick an outcome, pay in credits, and keep the result private until you choose to share it.
        </p>
      </div>
      {children}
    </div>
  );
}
