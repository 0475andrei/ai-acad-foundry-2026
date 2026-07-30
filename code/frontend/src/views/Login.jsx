import { useState } from 'react'
import { Logo } from '../components'
import { login } from '../auth'

export default function Login({ onSignIn }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)

  function submit(e) {
    e.preventDefault()
    const session = login(username, password)
    if (!session) { setError('Wrong username or password.'); return }
    setError(null)
    onSignIn(session)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form onSubmit={submit} className="card" style={{ width: '22rem', maxWidth: '90vw' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '1.3rem' }}>
          <Logo size={34} />
          <div>
            <h3 style={{ margin: 0, color: 'var(--accent)' }}>Libra Assist</h3>
            <p className="faint" style={{ margin: 0 }}>sign in to continue</p>
          </div>
        </div>

        <label htmlFor="login-user">Username</label>
        <input id="login-user" type="text" autoFocus value={username}
               onChange={(e) => setUsername(e.target.value)} placeholder="admin or user"
               style={{ marginBottom: '.9rem' }} />

        <label htmlFor="login-pass">Password</label>
        <input id="login-pass" type="password" value={password}
               onChange={(e) => setPassword(e.target.value)} placeholder="••••••"
               style={{ marginBottom: '1.1rem' }} />

        {error && <p className="faint" style={{ color: 'var(--c-crimson)', margin: '0 0 .9rem' }}>{error}</p>}

        <button className="btn btn-primary" type="submit" style={{ width: '100%' }}>Sign in</button>

        <p className="faint" style={{ marginTop: '1rem', marginBottom: 0, textAlign: 'center' }}>
          admin / admin for the full console · user / user for chat only
        </p>
      </form>
    </div>
  )
}
