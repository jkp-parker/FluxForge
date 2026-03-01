import { useEffect, useState } from 'react'
import {
  Plus, Pencil, Trash2, Loader2, AlertCircle, CheckCircle, Database,
  Star, RefreshCw,
} from 'lucide-react'
import Modal from '../components/Modal'
import {
  listInfluxConfigs, createInfluxConfig, updateInfluxConfig,
  deleteInfluxConfig, testInfluxConfig, testInfluxConnectionRaw, listBuckets,
} from '../services/api'

const EMPTY = { name: '', url: 'http://influxdb:8086', token: '', org: '', bucket: '', version: 2, is_default: false }

export default function InfluxConfig() {
  const [configs, setConfigs] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [editTarget, setEditTarget] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [modalTesting, setModalTesting] = useState(false)
  const [modalTestResult, setModalTestResult] = useState(null)
  const [testResults, setTestResults] = useState({})
  const [testingId, setTestingId] = useState(null)
  const [buckets, setBuckets] = useState({})
  const [loadingBuckets, setLoadingBuckets] = useState(null)

  const load = () => listInfluxConfigs().then(setConfigs).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const openAdd = () => { setForm(EMPTY); setEditTarget(null); setError(''); setModalTestResult(null); setModal('form') }
  const openEdit = (cfg) => {
    setForm({ name: cfg.name, url: cfg.url, token: cfg.token, org: cfg.org, bucket: cfg.bucket, version: cfg.version || 2, is_default: cfg.is_default })
    setEditTarget(cfg); setError(''); setModalTestResult(null); setModal('form')
  }

  const handleSave = async () => {
    if (!form.name || !form.url || !form.token || !form.bucket || (form.version === 2 && !form.org)) {
      setError('All required fields must be filled'); return
    }
    setSaving(true); setError('')
    try {
      if (editTarget) await updateInfluxConfig(editTarget.id, form)
      else await createInfluxConfig(form)
      setModal(null); load()
    } catch (e) {
      setError(e.response?.data?.detail || 'Save failed')
    } finally { setSaving(false) }
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this InfluxDB configuration?')) return
    await deleteInfluxConfig(id); load()
  }

  const handleTest = async (id) => {
    setTestingId(id)
    try {
      const result = await testInfluxConfig(id)
      setTestResults(r => ({ ...r, [id]: result }))
    } catch {
      setTestResults(r => ({ ...r, [id]: { success: false, message: 'Request failed' } }))
    } finally { setTestingId(null) }
  }

  const handleListBuckets = async (id) => {
    setLoadingBuckets(id)
    try {
      const result = await listBuckets(id)
      setBuckets(b => ({ ...b, [id]: result.buckets }))
    } catch (e) {
      setBuckets(b => ({ ...b, [id]: [] }))
    } finally { setLoadingBuckets(null) }
  }

  const handleModalTest = async () => {
    if (!form.url || !form.token || (form.version === 2 && !form.org)) {
      setModalTestResult({ success: false, message: form.version === 2 ? 'Enter URL, token and organisation first' : 'Enter URL and token first' }); return
    }
    setModalTesting(true); setModalTestResult(null)
    try {
      const result = await testInfluxConnectionRaw({ url: form.url, token: form.token, org: form.org })
      setModalTestResult(result)
    } catch {
      setModalTestResult({ success: false, message: 'Request failed' })
    } finally {
      setModalTesting(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 size={32} className="animate-spin text-blue-500" />
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">InfluxDB Targets</h1>
          <p className="text-sm text-gray-400 mt-1">Configure InfluxDB connections for your devices</p>
        </div>
        <button onClick={openAdd} className="btn-primary">
          <Plus size={16} /> Add Connection
        </button>
      </div>

      {configs.length === 0 ? (
        <div className="card p-12 text-center text-gray-500">
          <Database className="mx-auto mb-3 text-gray-600" size={40} />
          <p className="font-medium text-gray-300">No InfluxDB targets configured</p>
          <p className="text-sm mt-1">Add a connection to route device data to InfluxDB</p>
          <button onClick={openAdd} className="btn-primary mt-4 mx-auto"><Plus size={16} /> Add Connection</button>
        </div>
      ) : (
        <div className="space-y-4">
          {configs.map(cfg => {
            const tr = testResults[cfg.id]
            const cfgBuckets = buckets[cfg.id]
            const isV3 = cfg.version === 3
            return (
              <div key={cfg.id} className="card p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-100 text-lg">{cfg.name}</h3>
                      <span className="badge badge-blue text-[10px]">v{cfg.version || 2}</span>
                      {cfg.is_default && (
                        <span className="badge badge-yellow flex items-center gap-1">
                          <Star size={10} /> Default
                        </span>
                      )}
                      <span className="badge badge-gray">{cfg.device_count} devices</span>
                    </div>
                    <div className={`mt-2 grid grid-cols-2 ${isV3 ? 'sm:grid-cols-3' : 'sm:grid-cols-4'} gap-3 text-sm`}>
                      <div>
                        <span className="text-gray-500 text-xs">URL</span>
                        <p className="font-mono text-gray-300 text-xs break-all">{cfg.url}</p>
                      </div>
                      {!isV3 && (
                        <div>
                          <span className="text-gray-500 text-xs">Organisation</span>
                          <p className="text-gray-300">{cfg.org}</p>
                        </div>
                      )}
                      <div>
                        <span className="text-gray-500 text-xs">{isV3 ? 'Database' : 'Bucket'}</span>
                        <p className="text-gray-200 font-medium">{cfg.bucket}</p>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs">Token</span>
                        <p className="text-gray-500 font-mono text-xs">{'•'.repeat(12)}</p>
                      </div>
                    </div>

                    {tr && (
                      <div className={`mt-3 text-sm flex items-center gap-1.5 ${tr.success ? 'text-green-400' : 'text-red-400'}`}>
                        {tr.success ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                        {tr.message}
                      </div>
                    )}

                    {cfgBuckets && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {cfgBuckets.length === 0
                          ? <span className="text-xs text-gray-500">No {isV3 ? 'databases' : 'buckets'} found</span>
                          : cfgBuckets.map(b => (
                              <span key={b} className={`badge ${b === cfg.bucket ? 'badge-blue' : 'badge-gray'}`}>{b}</span>
                            ))
                        }
                      </div>
                    )}
                  </div>

                  <div className="flex items-start gap-1 ml-4">
                    <button onClick={() => handleTest(cfg.id)} disabled={testingId === cfg.id} className="btn-secondary py-1 text-xs">
                      {testingId === cfg.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                      Test
                    </button>
                    <button onClick={() => handleListBuckets(cfg.id)} disabled={loadingBuckets === cfg.id} className="btn-secondary py-1 text-xs">
                      {loadingBuckets === cfg.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                      {isV3 ? 'Databases' : 'Buckets'}
                    </button>
                    <button onClick={() => openEdit(cfg)} className="btn-ghost py-1 px-2"><Pencil size={13} /></button>
                    <button onClick={() => handleDelete(cfg.id)} className="btn-ghost py-1 px-2 text-red-400 hover:bg-red-900/30">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal open={modal === 'form'} onClose={() => setModal(null)}
        title={editTarget ? 'Edit InfluxDB Connection' : 'Add InfluxDB Connection'}>
        <div className="space-y-4">
          <div>
            <label className="label">InfluxDB Version *</label>
            <div className="flex gap-3 mt-1">
              {[2, 3].map(v => (
                <label key={v} className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-colors ${
                  form.version === v
                    ? 'border-blue-500 bg-blue-900/20 text-blue-400'
                    : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600'
                }`}>
                  <input
                    type="radio"
                    name="influx_version"
                    checked={form.version === v}
                    onChange={() => set('version', v)}
                    className="sr-only"
                  />
                  <span className="text-sm font-medium">InfluxDB {v}.x</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Connection Name *</label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Production InfluxDB" />
          </div>
          <div>
            <label className="label">InfluxDB URL *</label>
            <input className="input font-mono" value={form.url} onChange={e => set('url', e.target.value)} placeholder="http://influxdb:8086" />
          </div>
          <div>
            <label className="label">API Token *</label>
            <input className="input" type="password" value={form.token} onChange={e => set('token', e.target.value)} placeholder="your-api-token" />
          </div>
          {form.version === 2 ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Organisation *</label>
                <input className="input" value={form.org} onChange={e => set('org', e.target.value)} placeholder="myorg" />
              </div>
              <div>
                <label className="label">Default Bucket *</label>
                <input className="input" value={form.bucket} onChange={e => set('bucket', e.target.value)} placeholder="opcua" />
              </div>
            </div>
          ) : (
            <div>
              <label className="label">Default Database *</label>
              <input className="input" value={form.bucket} onChange={e => set('bucket', e.target.value)} placeholder="opcua" />
            </div>
          )}
          <div className="flex items-center gap-2">
            <input type="checkbox" id="is_default" checked={form.is_default} onChange={e => set('is_default', e.target.checked)} className="rounded border-gray-600 bg-gray-800 text-blue-500" />
            <label htmlFor="is_default" className="text-sm text-gray-300">Set as default for new devices</label>
          </div>
        </div>
        {modalTestResult && (
          <div className={`mt-3 text-sm flex items-center gap-1.5 ${modalTestResult.success ? 'text-green-400' : 'text-red-400'}`}>
            {modalTestResult.success ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
            {modalTestResult.message}
          </div>
        )}
        {error && <p className="text-sm text-red-400 mt-3 flex items-center gap-1"><AlertCircle size={14} />{error}</p>}
        <div className="flex justify-between gap-2 mt-5 pt-4 border-t border-gray-700">
          <button onClick={handleModalTest} disabled={modalTesting} className="btn-secondary">
            {modalTesting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            Test Connection
          </button>
          <div className="flex gap-2">
            <button onClick={() => setModal(null)} className="btn-secondary">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving && <Loader2 size={14} className="animate-spin" />} Save
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
