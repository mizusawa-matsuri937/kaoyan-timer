import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'
import { initSkin } from './skin'
import { init, installGlobalListeners } from './store'

initSkin()
installGlobalListeners()
void init()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
