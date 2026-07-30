'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import siteConfig from '@/config/site.json';

export default function DocsNav() {
  const pathname = usePathname();
  const sidebar = siteConfig.docs.sidebar;

  return (
    <nav className="w-64 shrink-0 hidden lg:block">
      <div className="sticky top-24 overflow-y-auto max-h-[calc(100vh-6rem)] pr-4 pb-8">
        {sidebar.map((section) => (
          <div key={section.heading}>
            <h3 className="docs-link-heading">{section.heading}</h3>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={
                      pathname === item.href ||
                      (item.href !== '/docs' && pathname.startsWith(item.href))
                        ? 'docs-link-active'
                        : 'docs-link'
                    }
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* Version badge */}
        <div className="mt-6 pt-4 border-t border-gray-200">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
            v0.1
          </span>
        </div>
      </div>
    </nav>
  );
}
