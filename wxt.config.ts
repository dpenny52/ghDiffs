import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    permissions: ['storage'],
    host_permissions: [
      'https://github.com/*',
      'https://patch-diff.githubusercontent.com/*',
      'https://raw.githubusercontent.com/*',
    ],
  },
  // Force ASCII-only output. @pierre/diffs bundles onigasm/Shiki, which embed
  // U+FFFF sentinels in the source. Chrome rejects content scripts that
  // contain non-character UTF-8 code points ("isn't UTF-8 encoded"), even
  // though they're technically valid UTF-8. Escaping all non-ASCII to \uXXXX
  // keeps the JS semantically identical and bypasses the loader check.
  vite: () => ({
    esbuild: { charset: 'ascii' },
    build: {
      rollupOptions: {
        plugins: [
          {
            name: 'escape-non-ascii',
            generateBundle(_options: unknown, bundle: Record<string, { type: string; code?: string }>) {
              for (const filename in bundle) {
                const file = bundle[filename];
                if (file.type === 'chunk' && typeof file.code === 'string') {
                  file.code = file.code.replace(
                    /[-￿]/g,
                    (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'),
                  );
                }
              }
            },
          },
        ],
      },
    },
  }),
});
