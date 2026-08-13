import Link from 'next/link';

const comparisons = [
  {
    title: 'What it is',
    items: [
      'A YAML/JSON format for describing agent behavior sequences',
      'A vocabulary of observable actions (says, calls, informs, selects...)',
      'An evaluation layer that makes specs executable as tests',
      'Versioned with normative JSON Schema for tool validation'
    ]
  },
  {
    title: 'What it is NOT',
    items: [
      'Not a prompt format or LLM configuration',
      'Not an orchestration or agent framework',
      'Not a replacement for OpenAPI/AsyncAPI — it complements them',
      'Not (yet) a ratified standard — v0.2 is open for review'
    ]
  }
];

export default function About() {
  return (
    <section className="py-16 sm:py-24 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12">
          {comparisons.map((col) => (
            <div key={col.title}>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">{col.title}</h3>
              <ul className="space-y-3">
                {col.items.map((item) => (
                  <li key={item} className="flex gap-3 text-sm text-gray-600">
                    <svg className="w-5 h-5 text-primary-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center">
          <Link
            href="/docs/manifesto"
            className="inline-flex items-center text-sm font-medium text-primary-600 hover:text-primary-500"
          >
            Read the full manifesto
            <svg className="ml-1 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}
