/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Development server configuration
  server: {
    port: 5173,
    // Proxy API requests to Talor backend
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
      },
      '/event': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        // Disable buffering for SSE
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            // Ensure SSE responses are not buffered
            proxyRes.headers['cache-control'] = 'no-cache';
            proxyRes.headers['x-accel-buffering'] = 'no';
          });
        },
      },
      '/health': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  // Production build configuration
  build: {
    // Output directory
    outDir: 'dist',
    // Enable source maps for production debugging (optional, can be disabled for smaller builds)
    sourcemap: false,
    // Minification settings
    minify: 'esbuild',
    // Target modern browsers for better optimization
    target: 'es2020',
    // CSS code splitting
    cssCodeSplit: true,
    // Chunk size warning limit (in KB)
    chunkSizeWarningLimit: 500,
    // Rollup options for advanced optimization
    rollupOptions: {
      output: {
        // Manual chunk splitting for better caching
        manualChunks: (id) => {
          // Node modules chunking strategy
          if (id.includes('node_modules')) {
            // React core libraries
            if (id.includes('react-dom') || id.includes('/react/')) {
              return 'vendor-react';
            }
            // Router
            if (id.includes('react-router')) {
              return 'vendor-router';
            }
            // State management
            if (id.includes('zustand')) {
              return 'vendor-state';
            }
            // Markdown rendering
            if (id.includes('react-markdown') || id.includes('remark-gfm') || id.includes('mdast') || id.includes('micromark')) {
              return 'vendor-markdown';
            }
            // Syntax highlighting (larger dependency)
            if (id.includes('shiki') || id.includes('@shikijs')) {
              return 'vendor-shiki';
            }
            // Internationalization
            if (id.includes('i18next')) {
              return 'vendor-i18n';
            }
          }
          return undefined;
        },
        // Asset file naming with hash for cache busting
        assetFileNames: (assetInfo) => {
          const name = assetInfo.names?.[0] || assetInfo.name || '';
          const info = name.split('.');
          const ext = info[info.length - 1];
          if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(ext)) {
            return 'assets/images/[name]-[hash][extname]';
          }
          if (/woff2?|eot|ttf|otf/i.test(ext)) {
            return 'assets/fonts/[name]-[hash][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
        // Chunk file naming
        chunkFileNames: 'assets/js/[name]-[hash].js',
        // Entry file naming
        entryFileNames: 'assets/js/[name]-[hash].js',
      },
    },
    // Terser options for additional minification (when using terser)
    // Note: esbuild is faster and sufficient for most cases
    // terserOptions: {
    //   compress: {
    //     drop_console: true,
    //     drop_debugger: true,
    //   },
    // },
  },
  // Preview server configuration (for testing production builds locally)
  preview: {
    port: 4173,
    strictPort: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'src/test/'],
    },
  },
});
