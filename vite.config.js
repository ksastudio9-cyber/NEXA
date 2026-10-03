import { defineConfig } from 'vite';

function apiProxy() {
  return {
    target: 'http://127.0.0.1:4001',
    configure(proxy) {
      proxy.on('proxyReq', proxyRequest => proxyRequest.removeHeader('origin'));
    }
  };
}

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': apiProxy(),
      '/auth': apiProxy()
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': apiProxy(),
      '/auth': apiProxy()
    }
  }
});