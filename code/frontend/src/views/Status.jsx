import { useEffect, useState } from 'react'
import { api } from '../api'
import { Err, Head, RawJson, Spinner } from '../components'

export default function Status({ health, reload, azure, reloadAzure }) {
  const [config, setConfig] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(true)
  const [feedback, setFeedback] = useState(null)
  const [feedbackError, setFeedbackError] = useState(null)

  useEffect(() => {
    api.config().then(setConfig).catch((e) => setError(e.message)).finally(() => setBusy(false))
  }, [])

  function loadFeedback() {
    api.listFeedback(20).then(setFeedback).catch((e) => setFeedbackError(e.message))
  }
  useEffect(() => { loadFeedback() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const rows = health ? [
    ['API', health.status, health.status === 'ok'],
    ['Vector store', `${health.qdrant} · ${health.qdrant_url}`, health.qdrant === 'ok'],
    ['Chat model', `${health.llm.provider} · ${health.llm.model}`, true],
    ['Embeddings', `${health.embeddings.provider} · ${health.embeddings.model}`, true],
    ['Agent mode', `${health.agents?.mode} · default “${health.agents?.default_persona}”`, true],
    ['Personas', (health.agents?.available || []).join(', ') || '—', true],
    ['Speech', health.speech?.configured ? `configured · ${health.speech.region}` : 'not configured', !!health.speech?.configured],
  ] : []

  return (
    <>
      <Head title="Status">
        What this console is talking to. Every value here comes from the backend's own
        <code> /health</code> and <code>/config</code> endpoints.
      </Head>

      <div className="card">
        <div className="row" style={{ marginBottom: '.5rem' }}>
          <h3 style={{ margin: 0 }}>Health</h3>
          <button className="btn btn-outline btn-sm shrink" onClick={reload}>refresh</button>
        </div>
        {health ? (
          <table>
            <tbody>
              {rows.map(([k, v, ok]) => (
                <tr key={k}>
                  <td style={{ width: '11rem' }} className="muted">{k}</td>
                  <td className="mono">{v}</td>
                  <td style={{ width: '3rem' }}>
                    <span className={`badge ${ok ? '' : 'crimson'}`}>{ok ? 'ok' : '!'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="faint">Backend unreachable — is it running on port 7799?</p>}
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: '.6rem' }}>
          <h3 style={{ margin: 0 }}>Azure environment</h3>
          <button className="btn btn-outline btn-sm shrink" onClick={reloadAzure}>refresh</button>
          {azure?.foundry_url && (
            <a className="btn btn-outline btn-sm shrink" href={azure.foundry_url} target="_blank" rel="noreferrer">
              Foundry portal ↗
            </a>
          )}
          {azure?.portal_url && (
            <a className="btn btn-outline btn-sm shrink" href={azure.portal_url} target="_blank" rel="noreferrer">
              Azure portal ↗
            </a>
          )}
        </div>

        {!azure ? <p className="faint">Loading…</p> : !azure.configured ? (
          <p className="faint">No Azure endpoint configured — set <code>AZURE_AI_ENDPOINT</code> in <code>.env</code>.</p>
        ) : (
          <>
            <table>
              <tbody>
                {[
                  ['Resource', azure.resource],
                  ['Resource group', azure.resource_group],
                  ['Project', azure.project],
                  ['Region', azure.location],
                  ['Subscription', azure.subscription_id],
                  ['Authentication', azure.auth === 'identity' ? 'identity (Microsoft Entra)' : 'key'],
                  ['Chat deployment', azure.chat_deployment],
                  ['Embedding deployment', azure.embedding_deployment],
                  ['Inference endpoint', azure.inference_endpoint],
                  ['Project endpoint', azure.project_endpoint],
                  ['Azure OpenAI endpoint', azure.openai_endpoint],
                ].filter(([, v]) => v).map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ width: '12rem' }} className="muted">{k}</td>
                    <td className="mono" style={{ wordBreak: 'break-all' }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {azure.auth_note && (
              <div className="err" style={{ marginTop: '.8rem', borderLeftColor: 'var(--c-gold)',
                                            background: 'rgba(228,192,46,.10)' }}>
                {azure.auth_note}
              </div>
            )}

            <label style={{ marginTop: '1rem' }}>model deployments</label>
            {azure.deployments.available ? (
              <table>
                <thead>
                  <tr><th>deployment</th><th>model</th><th>version</th><th>sku</th><th>TPM</th><th>state</th></tr>
                </thead>
                <tbody>
                  {azure.deployments.items.map((d) => (
                    <tr key={d.name}>
                      <td className="mono"><strong>{d.name}</strong></td>
                      <td className="mono">{d.model}</td>
                      <td className="faint mono">{d.version}</td>
                      <td className="mono">{d.sku}</td>
                      <td className="mono">{d.capacity}</td>
                      <td><span className="badge">{d.state}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="faint" style={{ marginTop: '.3rem' }}>{azure.deployments.reason}</p>
            )}
            <RawJson data={azure} label="raw /azure" />
          </>
        )}
      </div>

      <div className="card">
        <h3>Configuration <span className="faint">(secrets masked by the API)</span></h3>
        {busy && <Spinner label="loading" />}
        <Err error={error} />
        {config && (
          <div className="grid2">
            <div>
              <label>chunking</label>
              <pre className="out">{JSON.stringify(config.chunking, null, 2)}</pre>
              <label style={{ marginTop: '.7rem' }}>retrieval</label>
              <pre className="out">{JSON.stringify(config.retrieval, null, 2)}</pre>
            </div>
            <div>
              <label>generation</label>
              <pre className="out">{JSON.stringify(config.generation, null, 2)}</pre>
              <label style={{ marginTop: '.7rem' }}>providers</label>
              <pre className="out">{JSON.stringify(config.providers, null, 2)}</pre>
            </div>
          </div>
        )}
        <RawJson data={health} label="raw /health" />
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: '.5rem' }}>
          <h3 style={{ margin: 0 }}>Recent feedback</h3>
          <button className="btn btn-outline btn-sm shrink" onClick={loadFeedback}>refresh</button>
        </div>
        <Err error={feedbackError} />
        {!feedback ? <Spinner label="loading" /> : feedback.count === 0 ? (
          <p className="faint">No 👍/👎 submitted yet — vote on an answer in Chat to see it here.</p>
        ) : (
          <table>
            <thead>
              <tr><th style={{ width: '3rem' }}>rating</th><th>question</th><th style={{ width: '8rem' }}>agent</th>
                  <th style={{ width: '7rem' }}>mode</th><th style={{ width: '9rem' }}>when</th></tr>
            </thead>
            <tbody>
              {feedback.items.map((f) => (
                <tr key={f.id}>
                  <td><span className={`badge ${f.rating === 'up' ? '' : 'crimson'}`}>{f.rating === 'up' ? '👍' : '👎'}</span></td>
                  <td>{f.question}</td>
                  <td className="faint">{f.agent || '—'}</td>
                  <td className="faint">{f.mode || '—'}{f.augmented ? ' · rag' : ''}</td>
                  <td className="faint mono">{f.created_at.replace('T', ' ').replace(/\+00:00$/, ' UTC')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
