import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import App from './App.jsx'
import './index.css'

class AppErrorBoundary extends React.Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.error('Application render failed:', error)
  }

  render() {
    if (this.state.error) {
      return (
        <main className="min-h-screen bg-gray-50 p-6">
          <section className="mx-auto max-w-2xl border border-red-200 bg-white p-5">
            <h1 className="text-lg font-semibold text-red-800">This page encountered an error</h1>
            <p className="mt-2 text-sm text-gray-700">Refresh the page to try again. If the error repeats, share this message with support:</p>
            <pre className="mt-3 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-3 text-xs text-gray-700">{this.state.error.message}</pre>
            <button onClick={() => window.location.reload()} className="mt-4 rounded bg-accent px-3 py-2 text-sm font-medium text-white">Refresh page</button>
          </section>
        </main>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  </React.StrictMode>,
)
