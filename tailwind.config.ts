import type { Config } from 'tailwindcss';
export default {
  content: [
    './src/renderer/**/*.{svelte,ts,html}',
    './node_modules/nearbytes-widgets/dist/**/*.{svelte,js}',
    './node_modules/nearbytes-components/dist/**/*.{svelte,js}'
  ],
} satisfies Config;
