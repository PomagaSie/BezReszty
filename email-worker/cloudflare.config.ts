import { defineConfig, bindings } from 'cf/config';
export default defineConfig({
  worker: {
    name: process.env.BEZRESZTY_WORKER_NAME || 'bezreszty-bank-mail',
    entrypoint: './index.js',
    workersDev: false,
    previewUrls: false,
    compatibilityDate: '2026-10-28',
    env: {
      BANK_WEBHOOK_URL: bindings.text(`https://${process.env.BEZRESZTY_DOMAIN || 'bezreszty.org.pl'}/api/bank-mail`),
      NOTIFICATION_DOMAIN: bindings.text(process.env.BEZRESZTY_NOTIFICATION_DOMAIN || 'bezreszty.org.pl'),
      BANK_WEBHOOK_SECRET: bindings.secret(),
    },
    observability: { enabled: true, redactQueryString: true, logs: { enabled: true, invocationLogs: false }, traces: { enabled: true, headSamplingRate: 0.1 } },
  },
});
