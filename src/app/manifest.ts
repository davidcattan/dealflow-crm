import type { MetadataRoute } from 'next'

// Lets the CRM be installed on a phone's home screen ("Add to Home
// Screen"), opening full-screen like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'JED Capital CRM',
    short_name: 'JED',
    description: 'JED Capital deal pipeline, lenders and inbox',
    start_url: '/pipeline',
    scope: '/',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#0f172a',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
