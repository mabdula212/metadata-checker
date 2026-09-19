import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import pdfInspectHandler from './api/pdf/inspect';
import recentDocumentsHandler from './api/documents/recent';
import healthHandler from './api/health';
import bankDetectionHandler from './api/bank-detection';
import transactionExtractionHandler from './api/transaction-extraction';

function apiPlugin(): Plugin {
  const handleApi = (req: any, res: any, next: any) => {
    const url = req.url?.split('?')[0];
    if (url === '/api/pdf/inspect') {
      return pdfInspectHandler(req, res);
    }
    if (url === '/api/bank-detection') {
      return bankDetectionHandler(req, res);
    }
    if (url === '/api/transaction-extraction') {
      return transactionExtractionHandler(req, res);
    }
    if (url === '/api/documents/recent') {
      return recentDocumentsHandler(req, res);
    }
    if (url === '/api/health') {
      return healthHandler(req, res);
    }
    next();
  };

  return {
    name: 'api-serverless-plugin',
    configureServer(server) {
      server.middlewares.use(handleApi);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleApi);
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), apiPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
