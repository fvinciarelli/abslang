import NavBar from '@/components/navigation/NavBar';
import DocsNav from '@/components/navigation/DocsNav';
import DocsMobileMenu from '@/components/navigation/DocsMobileMenu';
import Footer from '@/components/layout/Footer';

interface Frontmatter {
  title?: string;
  description?: string;
}

export default function DocsLayout({
  children,
  frontmatter
}: {
  children: React.ReactNode;
  frontmatter?: Frontmatter;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />
      <div className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8">
        <div className="flex gap-8 py-8">
          <DocsNav />
          <div className="flex-1 min-w-0">
            <DocsMobileMenu />
            {frontmatter?.title && (
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                {frontmatter.title}
              </h1>
            )}
            {frontmatter?.description && (
              <p className="text-lg text-gray-500 mb-8">{frontmatter.description}</p>
            )}
            <div className="prose prose-gray max-w-none">
              {children}
            </div>

            {/* Edit this page */}
            <div className="mt-12 pt-6 border-t border-gray-200">
              <a
                href="https://github.com/fvinciarelli/abslang"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-gray-400 hover:text-primary-600 transition-colors"
              >
                <svg className="inline-block w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Edit this page on GitHub
              </a>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
