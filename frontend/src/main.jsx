import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import Landing from './Landing.jsx'
import { isAppPath } from './lib/route.js'
import './index.css'

// Landing at /, the app at /app (DESIGN_V2.md §2). Plain links move between
// the two, so the choice is made once per page load.
const Root = isAppPath(window.location.pathname) ? App : Landing

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
