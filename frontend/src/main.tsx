import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './lib/AuthContext.tsx'
import { ThemeProvider } from './lib/ThemeContext.tsx'
import { SportProvider } from './lib/SportContext.tsx'
import { ModelHintsProvider } from './lib/ModelHintsContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <SportProvider>
          <ModelHintsProvider>
            <App />
          </ModelHintsProvider>
          </SportProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
