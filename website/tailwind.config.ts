import typographyPlugin from '@tailwindcss/typography';
import type { Config } from 'tailwindcss';
import defaultTheme from 'tailwindcss/defaultTheme';

const colorPrimary: Record<string, string> = {
  50: '#EEF2FF',
  100: '#E0E7FF',
  200: '#C7D2FE',
  300: '#A5B4FC',
  400: '#818CF8',
  500: '#6366F1',
  600: '#4F46E5',
  700: '#4338CA',
  800: '#3730A3',
  900: '#312E81'
};

const colorSecondary: Record<string, string> = {
  50: '#FDF4FF',
  100: '#FAE8FF',
  200: '#F5D0FE',
  300: '#F0ABFC',
  400: '#E879F9',
  500: '#D946EF',
  600: '#C026D3',
  700: '#A21CAF',
  800: '#86198F',
  900: '#701A75'
};

const colorGray: Record<string, string> = {
  50: '#F8FAFC',
  100: '#F1F5F9',
  200: '#E2E8F0',
  300: '#CBD5E1',
  400: '#94A3B8',
  500: '#64748B',
  600: '#475569',
  700: '#334155',
  800: '#1E293B',
  900: '#0F172A'
};

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './config/**/*.json'
  ],
  theme: {
    fontFamily: {
      sans: ['Inter', ...defaultTheme.fontFamily.sans],
      heading: ['Inter', ...defaultTheme.fontFamily.sans],
      mono: ['JetBrains Mono', 'Fira Code', ...defaultTheme.fontFamily.mono]
    },
    extend: {
      colors: {
        gray: colorGray,
        primary: colorPrimary,
        secondary: colorSecondary
      },
      typography: {
        DEFAULT: {
          css: {
            maxWidth: 'none',
            code: {
              backgroundColor: '#1E293B',
              color: '#E2E8F0',
              padding: '0.2em 0.4em',
              borderRadius: '0.375rem',
              fontWeight: '400',
              fontSize: '0.875em'
            },
            'code::before': { content: '""' },
            'code::after': { content: '""' },
            pre: {
              backgroundColor: '#0F172A',
              borderRadius: '0.5rem'
            }
          }
        }
      },
      fontSize: {
        'heading-xs': ['16px', '1.375'],
        'heading-sm': ['20px', '1.375'],
        'heading-md': ['24px', '1.375'],
        'heading-lg': ['36px', '1.375'],
        'heading-xl': ['48px', '1.25'],
        'heading-xxl': ['64px', '1.125']
      }
    }
  },
  plugins: [typographyPlugin]
};

export default config;
