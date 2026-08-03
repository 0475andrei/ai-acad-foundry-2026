import { useState } from 'react'
import { api } from '../api'
import { Err, Head, RawJson, Spinner } from '../components'

export default function Tools() {
  // --- web fetch --------------------------------------------------------------
  const [url, setUrl] = useState('https://example.com')
  const [page, setPage] = useState(null)
  // --- speech -----------------------------------------------------------------
  const [text, setText] = useState('Your card was blocked after three failed PIN attempts.')
  const [audio, setAudio] = useState(null)
  const [transcript, setTranscript] = useState(null)

  // --- banking calculators (plain math, see app/finance.py — no LLM involved) --
  const [loanPrincipal, setLoanPrincipal] = useState('80000')
  const [loanRate, setLoanRate] = useState('6.5')
  const [loanYears, setLoanYears] = useState('30')
  const [loanPaymentResult, setLoanPaymentResult] = useState(null)

  const [payoffPrincipal, setPayoffPrincipal] = useState('80000')
  const [payoffRate, setPayoffRate] = useState('6.5')
  const [payoffMonthly, setPayoffMonthly] = useState('600')
  const [payoffResult, setPayoffResult] = useState(null)

  const [savingsPrincipal, setSavingsPrincipal] = useState('5000')
  const [savingsRate, setSavingsRate] = useState('3.2')
  const [savingsYears, setSavingsYears] = useState('5')
  const [savingsMonthly, setSavingsMonthly] = useState('200')
  const [savingsResult, setSavingsResult] = useState(null)

  const [busy, setBusy] = useState('')
  const [error, setError] = useState(null)

  async function fetchPage() {
    setBusy('fetching'); setError(null)
    try { setPage(await api.webFetch({ url })) } catch (e) { setError(e.message); setPage(null) } finally { setBusy('') }
  }

  async function speak() {
    setBusy('synthesizing'); setError(null)
    try {
      const blob = await api.speak({ text })
      setAudio({ url: URL.createObjectURL(blob), blob, size: blob.size })
    } catch (e) { setError(e.message); setAudio(null) } finally { setBusy('') }
  }

  async function transcribeGenerated() {
    if (!audio) return
    setBusy('transcribing'); setError(null)
    try {
      const file = new File([audio.blob], 'libra-assist.wav', { type: 'audio/wav' })
      setTranscript(await api.transcribe(file))
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  async function transcribeUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy('transcribing'); setError(null)
    try { setTranscript(await api.transcribe(file)) } catch (err) { setError(err.message) } finally { setBusy('') }
  }

  async function calcLoanPayment() {
    setBusy('calculating'); setError(null)
    try {
      setLoanPaymentResult(await api.loanPayment({
        principal: Number(loanPrincipal), annual_rate_percent: Number(loanRate), years: Number(loanYears),
      }))
    } catch (e) { setError(e.message); setLoanPaymentResult(null) } finally { setBusy('') }
  }

  async function calcLoanPayoff() {
    setBusy('calculating'); setError(null)
    try {
      setPayoffResult(await api.loanPayoff({
        principal: Number(payoffPrincipal), annual_rate_percent: Number(payoffRate),
        monthly_payment: Number(payoffMonthly),
      }))
    } catch (e) { setError(e.message); setPayoffResult(null) } finally { setBusy('') }
  }

  async function calcSavingsGrowth() {
    setBusy('calculating'); setError(null)
    try {
      setSavingsResult(await api.savingsGrowth({
        principal: Number(savingsPrincipal), annual_rate_percent: Number(savingsRate),
        years: Number(savingsYears), monthly_contribution: Number(savingsMonthly),
      }))
    } catch (e) { setError(e.message); setSavingsResult(null) } finally { setBusy('') }
  }

  return (
    <>
      <Head title="Tools">
        The capabilities an agent can call — and what they cost to build yourself. Each of these
        is a separate service with its own endpoint and its own permissions.
      </Head>

      <div className="card">
        <h3>Web fetch — the do-it-yourself lane</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          A plain scraper: fetch, parse, strip to text. Read the warnings — they are everything
          the naive approach could not handle, and the argument for managed grounding.
        </p>
        <div className="row">
          <div style={{ flex: 3 }}><label>URL</label>
            <input type="text" value={url} onChange={(e) => setUrl(e.target.value)}
                   onKeyDown={(e) => e.key === 'Enter' && fetchPage()} /></div>
          <button className="btn btn-primary shrink" onClick={fetchPage} disabled={!!busy}>Fetch</button>
        </div>
        {page && (
          <div style={{ marginTop: '.9rem' }}>
            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
              <span className="badge muted">HTTP {page.status_code}</span>
              <span className="badge muted">{page.chars} chars</span>
              <span className="badge muted">~{page.approx_tokens} tokens</span>
              <span className="badge muted">signal {(page.stats.signal_ratio * 100).toFixed(1)}%</span>
              <span className="badge muted">{page.stats.script_tags} scripts</span>
              <span className={`badge ${page.warnings.length ? 'crimson' : 'gold'}`}>
                {page.warnings.length} warning{page.warnings.length === 1 ? '' : 's'}
              </span>
            </div>
            {page.warnings.length > 0 && (
              <ul className="muted" style={{ fontSize: '.85rem', marginTop: 0 }}>
                {page.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
            <label>extracted text</label>
            <pre className="out" style={{ maxHeight: '16rem', overflowY: 'auto' }}>{page.text || '(nothing extracted)'}</pre>
            <RawJson data={page} />
          </div>
        )}
      </div>

      <div className="card">
        <h3>Speech — the voice loop, in two calls</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Text becomes audio; that audio becomes text again. Needs an Azure Speech resource
          (its own key and region — a different service from the model).
        </p>
        <label>Text to speak</label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 70 }} />
        <div className="row" style={{ marginTop: '.7rem' }}>
          <button className="btn btn-primary shrink" onClick={speak} disabled={!!busy}>Synthesize</button>
          <button className="btn btn-outline shrink" onClick={transcribeGenerated} disabled={!!busy || !audio}>
            Transcribe it back
          </button>
          <label className="btn btn-outline btn-sm shrink" style={{ textTransform: 'none', letterSpacing: 0, margin: 0 }}>
            or upload a WAV
            <input type="file" accept="audio/*" onChange={transcribeUpload} style={{ display: 'none' }} />
          </label>
        </div>
        {audio && (
          <div style={{ marginTop: '.8rem' }}>
            <audio controls src={audio.url} style={{ width: '100%' }} />
            <p className="faint" style={{ margin: '.3rem 0 0' }}>{(audio.size / 1024).toFixed(0)} KB of WAV</p>
          </div>
        )}
        {transcript && (
          <div style={{ marginTop: '.8rem' }}>
            <label>transcription</label>
            <pre className="out">{transcript.text}</pre>
            <p className="faint" style={{ margin: '.3rem 0 0' }}>
              status {transcript.status} · confidence {transcript.confidence ?? '—'} · {transcript.duration_seconds}s
            </p>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Loan payment — fixed-rate amortization</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Plain math (see <code>app/finance.py</code>), not a model call — the exact answer for
          the class of question a RAG lookup over product docs can't actually compute.
        </p>
        <div className="row">
          <div><label>Principal</label>
            <input type="number" value={loanPrincipal} onChange={(e) => setLoanPrincipal(e.target.value)} /></div>
          <div><label>Annual rate %</label>
            <input type="number" value={loanRate} onChange={(e) => setLoanRate(e.target.value)} /></div>
          <div><label>Years</label>
            <input type="number" value={loanYears} onChange={(e) => setLoanYears(e.target.value)} /></div>
          <button className="btn btn-primary shrink" onClick={calcLoanPayment} disabled={!!busy}>Calculate</button>
        </div>
        {loanPaymentResult && (
          <div style={{ marginTop: '.8rem' }}>
            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
              <span className="badge gold">{loanPaymentResult.monthly_payment} / month</span>
              <span className="badge muted">{loanPaymentResult.months} months</span>
              <span className="badge muted">total paid {loanPaymentResult.total_paid}</span>
              <span className="badge muted">total interest {loanPaymentResult.total_interest}</span>
            </div>
            <RawJson data={loanPaymentResult} />
          </div>
        )}
      </div>

      <div className="card">
        <h3>Loan payoff time — the inverse question</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          "I can pay this much a month — how long until it's gone?" Errors (422) if the payment
          doesn't even cover the interest accruing each month.
        </p>
        <div className="row">
          <div><label>Principal</label>
            <input type="number" value={payoffPrincipal} onChange={(e) => setPayoffPrincipal(e.target.value)} /></div>
          <div><label>Annual rate %</label>
            <input type="number" value={payoffRate} onChange={(e) => setPayoffRate(e.target.value)} /></div>
          <div><label>Monthly payment</label>
            <input type="number" value={payoffMonthly} onChange={(e) => setPayoffMonthly(e.target.value)} /></div>
          <button className="btn btn-primary shrink" onClick={calcLoanPayoff} disabled={!!busy}>Calculate</button>
        </div>
        {payoffResult && (
          <div style={{ marginTop: '.8rem' }}>
            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
              <span className="badge gold">{payoffResult.years} years</span>
              <span className="badge muted">{payoffResult.months} months</span>
              <span className="badge muted">total paid {payoffResult.total_paid}</span>
              <span className="badge muted">total interest {payoffResult.total_interest}</span>
            </div>
            <RawJson data={payoffResult} />
          </div>
        )}
      </div>

      <div className="card">
        <h3>Savings growth — the deposit side</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Compound growth of a starting deposit plus a fixed monthly contribution, compounded
          monthly. The savings-side counterpart to the two loan calculators above.
        </p>
        <div className="row">
          <div><label>Starting deposit</label>
            <input type="number" value={savingsPrincipal} onChange={(e) => setSavingsPrincipal(e.target.value)} /></div>
          <div><label>Annual rate %</label>
            <input type="number" value={savingsRate} onChange={(e) => setSavingsRate(e.target.value)} /></div>
          <div><label>Years</label>
            <input type="number" value={savingsYears} onChange={(e) => setSavingsYears(e.target.value)} /></div>
          <div><label>Monthly contribution</label>
            <input type="number" value={savingsMonthly} onChange={(e) => setSavingsMonthly(e.target.value)} /></div>
          <button className="btn btn-primary shrink" onClick={calcSavingsGrowth} disabled={!!busy}>Calculate</button>
        </div>
        {savingsResult && (
          <div style={{ marginTop: '.8rem' }}>
            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
              <span className="badge gold">final balance {savingsResult.final_balance}</span>
              <span className="badge muted">contributed {savingsResult.total_contributed}</span>
              <span className="badge muted">interest earned {savingsResult.total_interest}</span>
            </div>
            <RawJson data={savingsResult} />
          </div>
        )}
      </div>

      {busy && <Spinner label={busy} />}
      <Err error={error} />
    </>
  )
}
