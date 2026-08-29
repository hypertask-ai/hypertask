'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import axios from 'axios';

export default function IntegrationsComponent() {
  const [message, setMessage] = useState<{ type: 'success' | 'error' | null, text: string }>({ type: null, text: '' });
  const searchParams = useSearchParams();

  useEffect(() => {
    const success = searchParams?.get('success');
    const error = searchParams?.get('error');

    if (success === 'true') {
      setMessage({ type: 'success', text: 'Slack integration connected successfully!' });
    } else if (error) {
      let errorText = 'An error occurred';
      switch (error) {
        case 'access_denied':
          errorText = 'Access was denied. Please try again and grant the necessary permissions.';
          break;
        case 'no_code':
          errorText = 'No authorization code received. Please try again.';
          break;
        case 'slack_failed':
          errorText = 'Slack connection failed. Please check your configuration and try again.';
          break;
        case 'server_error':
          errorText = 'A server error occurred. Please try again later.';
          break;
        default:
          errorText = 'An unknown error occurred. Please try again.';
      }
      setMessage({ type: 'error', text: errorText });
    }
  }, [searchParams]);

  const connectSlack = async () => {
    try {
      const response = await axios.get('/api/slack');

      if (response.status === 200) {
        setMessage({ type: 'success', text: 'Slack integration connected successfully!' });
      } else {
        setMessage({ type: 'error', text: 'Failed to connect Slack integration. Please try again.' });
      }
    } catch (error) {
      console.error('Error connecting Slack:', error);
      setMessage({ type: 'error', text: 'An error occurred while connecting to Slack.' });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow rounded-lg">
          <div className="px-6 py-8">
            <h1 className="text-display font-bold text-gray-900 mb-2">Integrations</h1>
            <p className="text-gray-600 mb-8">Connect your favorite tools to streamline your workflow</p>

            {/* Success/Error Messages */}
            {message.type && (
              <div className={`mb-6 p-4 rounded-md ${
                message.type === 'success' 
                  ? 'bg-green-50 border border-green-200' 
                  : 'bg-red-50 border border-red-200'
              }`}>
                <div className="flex">
                  <div className="flex-shrink-0">
                    {message.type === 'success' ? (
                      <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                  <div className="ml-3">
                    <p className={`text-content font-medium ${
                      message.type === 'success' ? 'text-green-800' : 'text-red-800'
                    }`}>
                      {message.text}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Integrations Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              
              {/* Slack Integration */}
              <div className="border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
                <div className="flex items-center mb-4">
                  <div className="flex-shrink-0">
                    <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none">
                      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52-2.523A2.528 2.528 0 0 1 5.042 10.1h2.52v2.542a2.528 2.528 0 0 1-2.52 2.523z" fill="#E01E5A"/>
                      <path d="M6.313 5.042a2.528 2.528 0 0 1 2.521-2.52 2.528 2.528 0 0 1 2.521 2.52v2.521H8.834a2.528 2.528 0 0 1-2.521-2.521z" fill="#36C5F0"/>
                      <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522 2.521 2.528 2.528 0 0 1-2.522 2.521h-2.521V11.355a2.528 2.528 0 0 1 2.521-2.521z" fill="#2EB67D"/>
                      <path d="M17.688 18.956a2.528 2.528 0 0 1-2.523 2.522 2.528 2.528 0 0 1-2.521-2.522v-2.521h2.521a2.528 2.528 0 0 1 2.523 2.521z" fill="#ECB22E"/>
                    </svg>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-subheading font-medium text-gray-900">Slack</h3>
                  </div>
                </div>
                <p className="text-gray-600 text-content mb-4">
                  Connect Slack to receive notifications and updates directly in your workspace channels.
                </p>
                <div className="space-y-2 text-meta text-gray-500 mb-4">
                  <div>• Get task notifications</div>
                  <div>• Receive project updates</div>
                  <div>• Share tasks to channels</div>
                </div>
                <button
                  onClick={connectSlack}
                  className="w-full bg-[#4A154B] hover:bg-[#611f69] text-white font-medium py-2 px-4 rounded-md transition-colors"
                >
                  Connect Slack
                </button>
              </div>

              {/* Placeholder for future integrations */}
              <div className="border border-gray-200 rounded-lg p-6 opacity-50">
                <div className="flex items-center mb-4">
                  <div className="flex-shrink-0">
                    <div className="h-8 w-8 bg-gray-300 rounded"></div>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-subheading font-medium text-gray-500">Discord</h3>
                  </div>
                </div>
                <p className="text-gray-500 text-content mb-4">
                  Discord integration coming soon...
                </p>
                <button
                  disabled
                  className="w-full bg-gray-300 text-gray-500 font-medium py-2 px-4 rounded-md cursor-not-allowed"
                >
                  Coming Soon
                </button>
              </div>

              <div className="border border-gray-200 rounded-lg p-6 opacity-50">
                <div className="flex items-center mb-4">
                  <div className="flex-shrink-0">
                    <div className="h-8 w-8 bg-gray-300 rounded"></div>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-subheading font-medium text-gray-500">Microsoft Teams</h3>
                  </div>
                </div>
                <p className="text-gray-500 text-content mb-4">
                  Microsoft Teams integration coming soon...
                </p>
                <button
                  disabled
                  className="w-full bg-gray-300 text-gray-500 font-medium py-2 px-4 rounded-md cursor-not-allowed"
                >
                  Coming Soon
                </button>
              </div>

            </div>

            {/* Info Section */}
            <div className="mt-8 bg-blue-50 border border-blue-200 rounded-md p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-content font-medium text-blue-800">
                    Need help with integrations?
                  </h3>
                  <div className="mt-2 text-content text-blue-700">
                    <p>
                      Check our documentation for detailed setup guides and troubleshooting tips. 
                      If you need assistance, contact our support team.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 
