import Mermaid from '@/components/MDX/Mermaid';

// Global MDX components available in all .mdx files without importing
export function useMDXComponents(components: Record<string, React.ComponentType<any>>) {
  return {
    Mermaid,
    ...components
  };
}
