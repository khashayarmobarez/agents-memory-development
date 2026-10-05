import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Only relative paths travel through `next` — an absolute URL here would be
  // an open redirect handed to anyone who can craft a link.
  const requested = (await searchParams).next;
  const raw = Array.isArray(requested) ? requested[0] : requested;
  const next = raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/memory";

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-20">
      <header className="reveal">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-ink-faint">
          Restricted records
        </p>
        <h1 className="mt-5 font-display text-5xl font-semibold leading-[1.05] tracking-tight">
          Credentials.
        </h1>
        <p className="mt-5 font-display text-[15px] italic leading-relaxed text-ink-soft">
          The desk answers to one password. Agents may file proposals — only a
          human may stamp them.
        </p>
      </header>

      <div aria-hidden className="mt-9 border-t-2 border-ink" />
      <div aria-hidden className="mt-[3px] border-t border-rule" />

      <div className="mt-8">
        <LoginForm next={next} />
      </div>
    </div>
  );
}
