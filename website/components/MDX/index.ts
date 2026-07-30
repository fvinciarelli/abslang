import Mermaid from './Mermaid';

// MDX components that get merged into all MDX files via @mdx-js/react
const mdxComponents = {
  Mermaid,
  // Map common HTML elements that mermaid code blocks might need
  pre: (props: any) => {
    const className = props.children?.props?.className || '';
    if (className.includes('language-mermaid')) {
      const chart = props.children?.props?.children || '';
      return <Mermaid chart={chart.trim()} />;
    }
    return <pre {...props} />;
  }
};

export default mdxComponents;
