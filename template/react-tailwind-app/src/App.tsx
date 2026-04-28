const metrics = [
  { label: "Components", value: "12" },
  { label: "Views", value: "3" },
  { label: "Checks", value: "100%" },
] as const;

function App() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center gap-10 px-6 py-10 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold tracking-wide text-teal-700 uppercase dark:text-teal-300">
            WorkspaceDev default template
          </p>
          <h1 className="mt-4 text-4xl font-semibold text-balance sm:text-5xl">
            React, TypeScript, Vite, and Tailwind ready for generated apps.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-700 dark:text-slate-300">
            This OSS-neutral starter keeps the runtime dependency surface small
            while leaving enough structure for generated screens, components,
            and design tokens to land cleanly.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {metrics.map((metric) => (
            <article
              className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
              key={metric.label}
            >
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {metric.label}
              </p>
              <p className="mt-2 text-3xl font-semibold">{metric.value}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
