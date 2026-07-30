'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import siteConfig from '@/config/site.json';

export default function DocsMobileMenu() {
  const pathname = usePathname();
  const sidebar = siteConfig.docs.sidebar;

  return (
    <details className="lg:hidden mb-6">
      <summary className="flex items-center gap-2 px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg cursor-pointer text-sm font-medium text-gray-700 hover:bg-gray-100">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        Docs Navigation
      </summary>
      <nav className="mt-2 p-4 bg-gray-50 border border-gray-200 rounded-lg">
        {sidebar.map((section) => (
          <div key={section.heading} className="mb-3">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
              {section.heading}
            </h3>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`block px-2 py-1 text-sm rounded ${
                      pathname === item.href || (item.href !== '/docs' && pathname.startsWith(item.href))
                        ? 'text-primary-700 bg-primary-50 font-medium'
                        : 'text-gray-600 hover:text-primary-600'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </details>
  );
}
