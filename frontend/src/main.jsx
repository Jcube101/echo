import React from 'react'
import ReactDOM from 'react-dom/client'
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
//
// The app (three.js and friends, ~1.3 MB) is its own chunk, fetched only on
// /app, so the landing page downloads just React and its own code.
//
// It is loaded with a plain dynamic import — deliberately NOT React.lazy +
// <Suspense>. react-three-fiber's <Canvas> re-throws suspensions from inside
// the 3D scene (drei <Text> loading its font) into the DOM tree; with a
// Suspense boundary above the app, React swaps the WHOLE app for the fallback
// every time the scene mounts. With no boundary it keeps the app on screen.
const root = ReactDOM.createRoot(document.getElementById('root'))
const render = (Page) => root.render(<React.StrictMode><Page /></React.StrictMode>)

if (isAppPath(window.location.pathname)) {
  import('./App.jsx').then(({ default: App }) => render(App))
} else {
  render(Landing)
}
