import GenericLayout from '@/components/layout/GenericLayout';
import Hero from '@/components/home/Hero';
import Features from '@/components/home/Features';
import About from '@/components/home/About';
import Head from 'next/head';

export default function HomePage() {
  return (
    <GenericLayout>
      <Head>
        <title>ABS — Agent Behavior Specification</title>
        <meta name="description" content="A vendor-neutral, human-readable format for describing the observable behavior of AI agents." />
      </Head>
      <Hero />
      <Features />
      <About />
    </GenericLayout>
  );
}
