export default {
  id: 'landing',
  area: 'marketing',
  title: 'Marketing landing page renders',
  description: 'Opens the marketing root and checks it renders with Hypertask branding and no visible error text.',
  safe: true,
  steps: [
    { action: 'goto', arg: 'https://hypertask.ai', fallback: 'https://app.hypertask.ai' },
    { action: 'aiAssert', arg: 'the page shows Hypertask product branding (logo or name) and no error message or blank page' },
  ],
};
