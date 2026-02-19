import { defineEndpoint } from '@directus/extensions-sdk';
import type { Router } from 'express';

export default defineEndpoint((router: Router) => {
  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      extension: 'tax-sync-endpoint'
    });
  });
});
