import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyAppBrandToDocument } from './branding'

applyAppBrandToDocument()

createRoot(document.getElementById('root')!).render(<App />)
