import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import Landing from './Landing.jsx'
import { isAppPath } from './lib/route.js'
// Self-hosted fonts (DESIGN_V2.md D3) — no Google Fonts, so the installed PWA
// works offline. Latin subsets only for the two static families.
import '@fontsource-variable/fraunces/wght.css'
import '@fontsource/instrument-sans/latin-400.css'
import '@fontsource/instrument-sans/latin-500.css'
import '@fontsource/instrument-sans/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './index.css'

// Landing at /, the app at /app (DESIGN_V2.md §2). Plain links move between
// the two, so the choice is made once per page load.
const Root = isAppPath(window.location.pathname) ? App : Landing

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
