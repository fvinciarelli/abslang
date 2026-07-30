import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import withMDX from '@next/mdx';

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/abs',
  pageExtensions: ['tsx', 'ts', 'md', 'mdx'],
  eslint: {
    ignoreDuringBuilds: true
  },
  typescript: {
    ignoreBuildErrors: true
  },
  output: 'export',
  images: {
    unoptimized: true
  }
};

const mdxConfig = withMDX({
  extension: /\.mdx?$/,
  options: {
    remarkPlugins: [remarkFrontmatter, remarkGfm],
    rehypePlugins: []
  }
});

export default mdxConfig(nextConfig);
