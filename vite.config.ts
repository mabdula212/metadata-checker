import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import pdfInspectHandler from './api/pdf/inspect.js';
import recentDocumentsHandler from './api/documents/recent.js';
import healthHandler from './api/health.js';
import bankDetectionHandler from './api/bank-detection.js';
import transactionExtractionHandler from './api/transaction-extraction.js';
import excelExportHandler from './api/excel-export.js';
import loginHandler from './api/auth/login.js';
import registerHandler from './api/auth/register.js';
import logoutHandler from './api/auth/logout.js';
import sessionHandler from './api/auth/session.js';
import adminUsersHandler from './api/admin/users.js';
import adminResetPasswordHandler from './api/admin/reset-password.js';

function apiPlugin(): Plugin {
  const handleApi = (req: any, res: any, next: any) => {
    // Sensible security headers compatible with Google AI Studio iframe preview
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors *"
    );

    const url = req.url?.split('?')[0];
    if (url === '/api/auth/login') {
      return loginHandler(req, res);
    }
    if (url === '/api/auth/register') {
      return registerHandler(req, res);
    }
    if (url === '/api/auth/logout') {
      return logoutHandler(req, res);
    }
    if (url === '/api/auth/session') {
      return sessionHandler(req, res);
    }
    if (url === '/api/admin/users' || (url && url.startsWith('/api/admin/users/'))) {
      return adminUsersHandler(req, res);
    }
    if (url === '/api/admin/reset-password') {
      return adminResetPasswordHandler(req, res);
    }
    if (url === '/api/pdf/inspect') {
      return pdfInspectHandler(req, res);
    }
    if (url === '/api/bank-detection') {
      return bankDetectionHandler(req, res);
    }
    if (url === '/api/transaction-extraction') {
      return transactionExtractionHandler(req, res);
    }
    if (url === '/api/excel-export' || (url && url.startsWith('/api/excel-export/'))) {
      return excelExportHandler(req, res);
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
      allowedHosts: true,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      allowedHosts: true,
    },
  };
});
