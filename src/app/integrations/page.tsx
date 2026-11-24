import type { Metadata } from 'next';
import IntegrationsComponent from './IntegrationsComponent';

export const metadata: Metadata = { title: 'Integrations' };

export default function IntegrationsPage() {
  return <IntegrationsComponent />;
}
