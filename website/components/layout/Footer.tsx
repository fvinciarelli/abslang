import Link from 'next/link';
import siteConfig from '@/config/site.json';

export default function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div>
            <Link href="/" className="text-lg font-bold text-gray-900">
              <span className="text-primary-600">ABS</span>
            </Link>
            <p className="mt-2 text-sm text-gray-500">
              {siteConfig.site.description}
            </p>
          </div>

          {/* Docs */}
          <div>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Docs</h4>
            <ul className="space-y-2">
              {siteConfig.docs.sidebar.flatMap(s => s.items).slice(0, 6).map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-sm text-gray-600 hover:text-primary-600">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Community */}
          <div>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Community</h4>
            <ul className="space-y-2">
              <li>
                <a href={siteConfig.site.github} target="_blank" rel="noopener noreferrer" className="text-sm text-gray-600 hover:text-primary-600">
                  GitHub
                </a>
              </li>
              <li>
                <a href={`${siteConfig.site.github}/issues`} target="_blank" rel="noopener noreferrer" className="text-sm text-gray-600 hover:text-primary-600">
                  Issues & Proposals
                </a>
              </li>
              <li>
                <a href={`${siteConfig.site.github}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer" className="text-sm text-gray-600 hover:text-primary-600">
                  License
                </a>
              </li>
            </ul>
          </div>

          {/* Status */}
          <div>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Status</h4>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
              v0.2 — Public Review
            </span>
            <p className="mt-2 text-xs text-gray-400">
              Apache 2.0 License
            </p>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-gray-200 text-center">
          <p className="text-xs text-gray-400">
            &copy; {new Date().getFullYear()} ABS contributors. Built with the same spirit as OpenAPI &amp; AsyncAPI.
          </p>
        </div>
      </div>
    </footer>
  );
}
