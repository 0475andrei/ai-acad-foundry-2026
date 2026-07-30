// A demo-grade gate, not real security: credentials are checked in the browser
// and the backend enforces nothing. It exists to separate the "simple user"
// chat experience from the admin pipeline-explorer views, not to protect data.
const SESSION_KEY = 'libra-assist-session'

const ACCOUNTS = {
  admin: { password: 'admin', role: 'admin' },
  user: { password: 'user', role: 'user' },
}

export function login(username, password) {
  const account = ACCOUNTS[username.trim().toLowerCase()]
  if (!account || account.password !== password) return null
  const session = { username: username.trim().toLowerCase(), role: account.role }
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)) } catch { /* storage unavailable */ }
  return session
}

export function logout() {
  try { sessionStorage.removeItem(SESSION_KEY) } catch { /* storage unavailable */ }
}

export function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
