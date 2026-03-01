import { useEffect, useState, useRef } from 'react'
import {
  Download, RefreshCw, Loader2, FileCode, Copy, CheckCircle,
  Upload, Edit3, Save, X, RotateCcw, AlertTriangle, Database,
  Server, Tag, FileText, ArrowLeft, Check
} from 'lucide-react'
import {
  getTelegrafConfig, previewTelegrafImport, confirmTelegrafImport,
  saveTelegrafOverride, revertTelegrafOverride
} from '../services/api'
import Modal from '../components/Modal'

export default function TelegrafConfig() {
  const [config, setConfig] = useState('')
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [configMode, setConfigMode] = useState('generated')

  // Edit mode
  const [editMode, setEditMode] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [reverting, setReverting] = useState(false)

  // Import modal
  const [importOpen, setImportOpen] = useState(false)
  const [importStep, setImportStep] = useState(1)
  const [importContent, setImportContent] = useState('')
  const [importPreview, setImportPreview] = useState(null)
  const [importResult, setImportResult] = useState(null)
  const [importing, setImporting] = useState(false)
  const [skipExisting, setSkipExisting] = useState(true)
  const fileInputRef = useRef(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await getTelegrafConfig()
      setConfig(res.data)
      setConfigMode(res.headers['x-config-mode'] || 'generated')
    } catch {
      setConfig('# Error loading config')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(editMode ? editContent : config)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    const blob = new Blob([editMode ? editContent : config], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'telegraf.conf'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Edit mode handlers
  const enterEdit = () => {
    setEditContent(config)
    setEditMode(true)
  }

  const cancelEdit = () => {
    setEditMode(false)
    setEditContent('')
  }

  const saveEdit = async () => {
    setSaving(true)
    try {
      await saveTelegrafOverride(editContent)
      setEditMode(false)
      await load()
    } catch (e) {
      console.error('Save failed:', e)
    } finally {
      setSaving(false)
    }
  }

  const handleRevert = async () => {
    setReverting(true)
    try {
      await revertTelegrafOverride()
      setEditMode(false)
      await load()
    } catch (e) {
      console.error('Revert failed:', e)
    } finally {
      setReverting(false)
    }
  }

  // Import handlers
  const openImport = () => {
    setImportOpen(true)
    setImportStep(1)
    setImportContent('')
    setImportPreview(null)
    setImportResult(null)
  }

  const closeImport = () => {
    setImportOpen(false)
    if (importResult) load()
  }

  const handleFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setImportContent(ev.target.result)
    reader.readAsText(file)
    e.target.value = ''
  }

  const handlePreview = async () => {
    setImporting(true)
    try {
      const result = await previewTelegrafImport(importContent)
      setImportPreview(result)
      setImportStep(2)
    } catch (e) {
      console.error('Preview failed:', e)
    } finally {
      setImporting(false)
    }
  }

  const handleConfirm = async () => {
    setImporting(true)
    try {
      const result = await confirmTelegrafImport({
        influxdb_configs: importPreview.influxdb_configs,
        devices: importPreview.devices,
        passthrough_sections: importPreview.passthrough_sections,
        skip_existing: skipExisting,
      })
      setImportResult(result)
      setImportStep(3)
    } catch (e) {
      console.error('Import confirm failed:', e)
    } finally {
      setImporting(false)
    }
  }

  const lineCount = (editMode ? editContent : config).split('\n').length
  const totalImportTags = importPreview?.devices?.reduce((sum, d) => sum + d.tags.length, 0) || 0

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Telegraf Configuration</h1>
          <p className="text-sm text-gray-400 mt-1">
            {configMode === 'override'
              ? 'Manually edited config — not auto-generated'
              : 'Auto-generated config based on your devices and tag selections'}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={openImport} className="btn-secondary">
            <Upload size={14} /> Import
          </button>
          {editMode ? (
            <>
              <button onClick={cancelEdit} className="btn-secondary">
                <X size={14} /> Cancel
              </button>
              <button onClick={saveEdit} disabled={saving} className="btn-primary">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Override
              </button>
            </>
          ) : (
            <>
              <button onClick={enterEdit} className="btn-secondary">
                <Edit3 size={14} /> Edit
              </button>
              <button onClick={load} disabled={loading} className="btn-secondary">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Regenerate
              </button>
              <button onClick={handleCopy} className="btn-secondary">
                {copied ? <CheckCircle size={14} className="text-green-400" /> : <Copy size={14} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button onClick={handleDownload} className="btn-primary">
                <Download size={14} /> Download
              </button>
            </>
          )}
        </div>
      </div>

      {/* Override banner */}
      {configMode === 'override' && !editMode && (
        <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-amber-900/30 border border-amber-700/50">
          <div className="flex items-center gap-2 text-amber-300 text-sm">
            <AlertTriangle size={16} />
            <span>Manual override active — config is not auto-generated from your devices/tags.</span>
          </div>
          <button
            onClick={handleRevert}
            disabled={reverting}
            className="btn-secondary text-xs !py-1 !px-3 border-amber-600 text-amber-300 hover:bg-amber-900/50"
          >
            {reverting ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
            Revert to Generated
          </button>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800/50">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <FileCode size={14} />
            <span className="font-mono">telegraf.conf</span>
            <span className="text-gray-600">·</span>
            <span className="text-gray-500">{lineCount} lines</span>
            {configMode === 'override' && (
              <span className="badge bg-amber-900/50 text-amber-400 ml-1">override</span>
            )}
          </div>
          <div className="flex gap-2">
            <span className="w-3 h-3 rounded-full bg-red-500/60" />
            <span className="w-3 h-3 rounded-full bg-yellow-500/60" />
            <span className="w-3 h-3 rounded-full bg-green-500/60" />
          </div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={28} className="animate-spin text-blue-500" />
          </div>
        ) : editMode ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full p-5 text-xs font-mono text-green-400 bg-gray-950 min-h-[70vh] leading-relaxed resize-none focus:outline-none"
            spellCheck={false}
          />
        ) : (
          <pre className="p-5 text-xs font-mono text-green-400 bg-gray-950 overflow-auto max-h-[70vh] leading-relaxed whitespace-pre-wrap">
            {config || '# No devices or tags configured yet.'}
          </pre>
        )}
      </div>

      {!editMode && (
        <div className="card p-4 bg-blue-900/20 border-blue-800">
          <h3 className="text-sm font-semibold text-blue-300 mb-2">Usage</h3>
          <p className="text-sm text-blue-300/80 mb-2">
            Download this file and place it at your configured Telegraf config path. Then reload Telegraf:
          </p>
          <code className="block bg-gray-800 rounded px-3 py-2 text-xs font-mono text-blue-400">
            systemctl reload telegraf
          </code>
          <p className="text-xs text-blue-400/60 mt-2">
            You can configure the config path and reload command in <strong>Administration</strong>.
          </p>
        </div>
      )}

      {/* Import Modal */}
      <Modal open={importOpen} onClose={closeImport} title="Import Telegraf Config" size="lg">
        {importStep === 1 && (
          <div className="space-y-4">
            <p className="text-sm text-gray-400">
              Paste or upload an existing <code className="text-blue-400">telegraf.conf</code> to automatically create
              InfluxDB targets, OPC-UA devices, and tags. Non-OPC-UA sections will be preserved as passthrough config.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Config Content</label>
              <textarea
                value={importContent}
                onChange={(e) => setImportContent(e.target.value)}
                placeholder="Paste your telegraf.conf content here..."
                className="w-full h-64 p-3 text-xs font-mono bg-gray-800 text-gray-200 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                spellCheck={false}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".conf,.toml,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-secondary text-sm"
                >
                  <Upload size={14} /> Upload File
                </button>
              </div>
              <button
                onClick={handlePreview}
                disabled={!importContent.trim() || importing}
                className="btn-primary"
              >
                {importing ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                Preview Import
              </button>
            </div>
          </div>
        )}

        {importStep === 2 && importPreview && (
          <div className="space-y-4">
            {/* Warnings */}
            {importPreview.warnings.length > 0 && (
              <div className="bg-amber-900/30 border border-amber-700/50 rounded-lg p-3 space-y-1">
                {importPreview.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-amber-300">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            {/* InfluxDB Targets */}
            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-200 mb-3">
                <Database size={16} className="text-purple-400" />
                <span>InfluxDB Targets</span>
                <span className="badge badge-primary ml-auto">{importPreview.influxdb_configs.length}</span>
              </div>
              {importPreview.influxdb_configs.length === 0 ? (
                <p className="text-sm text-gray-500">No InfluxDB outputs found</p>
              ) : (
                <div className="space-y-2">
                  {importPreview.influxdb_configs.map((cfg, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm bg-gray-900/50 rounded px-3 py-2">
                      <span className="text-gray-200 font-medium">{cfg.name}</span>
                      <span className="text-gray-500">{cfg.url}</span>
                      <span className="text-gray-500">→ {cfg.bucket}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* OPC-UA Devices */}
            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-200 mb-3">
                <Server size={16} className="text-blue-400" />
                <span>OPC-UA Devices</span>
                <span className="badge badge-primary ml-auto">{importPreview.devices.length}</span>
              </div>
              {importPreview.devices.length === 0 ? (
                <p className="text-sm text-gray-500">No OPC-UA inputs found</p>
              ) : (
                <div className="space-y-2">
                  {importPreview.devices.map((dev, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm bg-gray-900/50 rounded px-3 py-2">
                      <span className="text-gray-200 font-medium">{dev.name}</span>
                      <span className="text-gray-500 truncate">{dev.endpoint_url}</span>
                      <span className="badge badge-secondary ml-auto">
                        <Tag size={10} /> {dev.tags.length} tags
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Passthrough */}
            {importPreview.passthrough_sections.trim() && (
              <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-200 mb-2">
                  <FileText size={16} className="text-green-400" />
                  <span>Passthrough Sections</span>
                </div>
                <p className="text-sm text-gray-400">
                  Non-OPC-UA config sections will be preserved and appended to the generated config.
                </p>
                <pre className="mt-2 p-2 text-xs font-mono text-gray-400 bg-gray-900/50 rounded max-h-32 overflow-auto">
                  {importPreview.passthrough_sections.trim().substring(0, 500)}
                  {importPreview.passthrough_sections.trim().length > 500 && '...'}
                </pre>
              </div>
            )}

            {/* Summary */}
            <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
              <p className="text-sm text-gray-300">
                This will create <strong>{importPreview.influxdb_configs.length}</strong> InfluxDB target(s),{' '}
                <strong>{importPreview.devices.length}</strong> device(s), and{' '}
                <strong>{totalImportTags}</strong> tag(s).
              </p>
              <label className="flex items-center gap-2 mt-2 text-sm text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={skipExisting}
                  onChange={(e) => setSkipExisting(e.target.checked)}
                  className="checkbox checkbox-sm"
                />
                Skip devices and InfluxDB targets that already exist (by name)
              </label>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button onClick={() => setImportStep(1)} className="btn-secondary">
                <ArrowLeft size={14} /> Back
              </button>
              <button onClick={handleConfirm} disabled={importing} className="btn-primary">
                {importing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Confirm Import
              </button>
            </div>
          </div>
        )}

        {importStep === 3 && importResult && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-green-900/50 flex items-center justify-center">
                <CheckCircle size={20} className="text-green-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-100">Import Complete</h3>
                <p className="text-sm text-gray-400">Your config has been imported successfully.</p>
              </div>
            </div>

            <div className="space-y-2">
              {importResult.influxdb_created > 0 && (
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <Database size={14} className="text-purple-400" />
                  Created {importResult.influxdb_created} InfluxDB target(s)
                  {importResult.influxdb_skipped > 0 && (
                    <span className="text-gray-500">({importResult.influxdb_skipped} skipped — already exist)</span>
                  )}
                </div>
              )}
              {importResult.influxdb_skipped > 0 && importResult.influxdb_created === 0 && (
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <Database size={14} className="text-gray-500" />
                  {importResult.influxdb_skipped} InfluxDB target(s) skipped — already exist
                </div>
              )}
              {importResult.devices_created > 0 && (
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <Server size={14} className="text-blue-400" />
                  Created {importResult.devices_created} device(s) with {importResult.tags_created} tag(s)
                  {importResult.devices_skipped > 0 && (
                    <span className="text-gray-500">({importResult.devices_skipped} skipped)</span>
                  )}
                </div>
              )}
              {importResult.devices_skipped > 0 && importResult.devices_created === 0 && (
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <Server size={14} className="text-gray-500" />
                  {importResult.devices_skipped} device(s) skipped — already exist
                </div>
              )}
              {importResult.passthrough_saved && (
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <FileText size={14} className="text-green-400" />
                  Passthrough sections saved — will appear in generated config
                </div>
              )}
            </div>

            {importResult.warnings.length > 0 && (
              <div className="bg-amber-900/30 border border-amber-700/50 rounded-lg p-3 space-y-1">
                {importResult.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-amber-300">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button onClick={closeImport} className="btn-primary">
                Done
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
