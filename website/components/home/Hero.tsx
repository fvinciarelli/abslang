import Link from 'next/link';

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-gray-900 via-gray-900 to-primary-900">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0" style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, rgb(148 163 184) 1px, transparent 0)`,
          backgroundSize: '40px 40px'
        }} />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 sm:py-32 lg:py-40">
        <div className="max-w-3xl">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary-500/10 border border-primary-500/20 text-primary-300 text-xs font-medium mb-6">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary-500" />
            </span>
            v0.1 — Public Review
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight leading-tight">
            Agent Behavior
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-secondary-400">
              Specification
            </span>
          </h1>

          <p className="mt-6 text-lg sm:text-xl text-gray-300 max-w-2xl leading-relaxed">
            A vendor-neutral, human-readable format for describing the observable behavior
            of AI agents — what users say, what agents do, and how it should be evaluated.
          </p>

          {/* Quick example */}
          <div className="mt-8 bg-gray-800/80 backdrop-blur rounded-lg border border-gray-700 overflow-hidden max-w-lg">
            <div className="flex items-center gap-1.5 px-4 py-2 bg-gray-800 border-b border-gray-700">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
              <span className="ml-2 text-xs text-gray-400 font-mono">session.abs.yaml</span>
            </div>
            <pre className="p-4 text-sm text-gray-200 font-mono leading-relaxed overflow-x-auto">
              <code>{`<span class="text-primary-400">session</span>: <span class="text-green-400">Refund request — approved</span>
<span class="text-primary-400">behaviors</span>:
  - <span class="text-primary-400">actor</span>: <span class="text-green-400">user</span>
    <span class="text-primary-400">action</span>: <span class="text-green-400">says</span>
    <span class="text-primary-400">content</span>: <span class="text-green-400">"I want to return order #8291, it arrived damaged"</span>
  - <span class="text-primary-400">actor</span>: <span class="text-green-400">assistant</span>
    <span class="text-primary-400">action</span>: <span class="text-green-400">asks</span>
    <span class="text-primary-400">content</span>: <span class="text-green-400">"Can you confirm your name and order date?"</span>
    <span class="text-primary-400">evaluations</span>:
      - <span class="text-primary-400">type</span>: <span class="text-green-400">llm_judge</span>
        <span class="text-primary-400">criteria</span>: <span class="text-green-400">|</span>
          <span class="text-green-400">1. Shows empathy</span>
          <span class="text-green-400">2. References order #8291</span>
          <span class="text-green-400">3. Asks for verification</span>
  - <span class="text-primary-400">actor</span>: <span class="text-green-400">assistant</span>
    <span class="text-primary-400">action</span>: <span class="text-green-400">calls</span>
    <span class="text-primary-400">target</span>: <span class="text-green-400">Orders API</span>
<span class="text-gray-500">  # ... tool round-trips, chain evaluations, variable checks</span>
<span class="text-primary-400">evaluations</span>:
  - <span class="text-primary-400">type</span>: <span class="text-green-400">sequence</span>
  - <span class="text-primary-400">type</span>: <span class="text-green-400">variable_consistency</span>
  - <span class="text-primary-400">type</span>: <span class="text-green-400">never</span>`}</code>
            </pre>
          </div>

          {/* CTA buttons */}
          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              href="/docs"
              className="inline-flex items-center px-6 py-3 rounded-lg bg-primary-600 text-white font-semibold text-sm hover:bg-primary-500 transition-colors shadow-lg shadow-primary-600/25"
            >
              Read the docs
              <svg className="ml-2 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
            <a
              href="https://github.com/fvinciarelli/abs"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-6 py-3 rounded-lg border border-gray-600 text-gray-300 font-semibold text-sm hover:border-gray-400 hover:text-white transition-colors"
            >
              <svg className="mr-2 w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
              </svg>
              View on GitHub
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
