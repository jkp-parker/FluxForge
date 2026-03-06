import { useEffect, useState, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Server, Tag, Database, Activity, ArrowRight, Loader2, Layers,
} from 'lucide-react'
import { getMetrics } from '../services/api'
import * as d3 from 'd3'
import { sankey as d3Sankey, sankeyLinkHorizontal } from 'd3-sankey'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

function StatCard({ icon: Icon, label, value, sub, color = 'blue', to }) {
  const colorMap = {
    blue: 'bg-blue-900/40 text-blue-400',
    green: 'bg-green-900/40 text-green-400',
    yellow: 'bg-yellow-900/40 text-yellow-400',
    purple: 'bg-purple-900/40 text-purple-400',
  }
  const inner = (
    <div className="card p-5 h-full hover:border-gray-600 transition-colors">
      <div className="flex items-start justify-between h-full">
        <div>
          <p className="text-sm text-gray-400 font-medium">{label}</p>
          <p className="text-3xl font-bold text-gray-100 mt-1">{value}</p>
          <p className={`text-xs mt-1 ${sub ? 'text-gray-500' : 'invisible'}`}>{sub || '\u00A0'}</p>
        </div>
        <div className={`p-2.5 rounded-lg ${colorMap[color]}`}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  )
  return to ? <Link to={to}>{inner}</Link> : inner
}

function DeviceRow({ device }) {
  return (
    <tr className="hover:bg-gray-800/50">
      <td className="table-td">
        <Link to={`/devices/${device.id}`} className="font-medium text-blue-400 hover:text-blue-300">
          {device.name}
        </Link>
      </td>
      <td className="table-td text-gray-400 font-mono text-xs truncate" title={device.endpoint_url}>{device.endpoint_url}</td>
      <td className="table-td">
        <span className={`badge ${device.enabled ? 'badge-green' : 'badge-gray'}`}>
          {device.enabled ? 'Enabled' : 'Disabled'}
        </span>
      </td>
      <td className="table-td text-center font-semibold">{device.enabled_tag_count}</td>
      <td className="table-td text-gray-400 text-xs">{device.instance_name || '—'}</td>
      <td className="table-td text-gray-400 text-xs">{device.influxdb_name || '—'}</td>
    </tr>
  )
}

// Sankey diagram: scan classes -> instances (tag flow)
function SankeyChart({ data }) {
  const svgRef = useRef(null)
  const containerRef = useRef(null)

  const draw = useCallback(() => {
    try {
      if (!data || data.length === 0 || !svgRef.current || !containerRef.current) return

      const container = containerRef.current
      const width = container.clientWidth
      if (width <= 0) return
      const height = Math.max(250, data.length * 20 + 60)

      const svg = d3.select(svgRef.current)
      svg.selectAll('*').remove()
      svg.attr('width', width).attr('height', height).attr('overflow', 'visible')

      // Build nodes and links for sankey
      const nodeNames = new Set()
      data.forEach(d => {
        nodeNames.add(`sc:${d.scan_class_name}`)
        nodeNames.add(`inst:${d.instance_name}`)
      })
      const nodeArray = Array.from(nodeNames)
      const nodeIndex = {}
      nodeArray.forEach((n, i) => { nodeIndex[n] = i })

      const nodes = nodeArray.map(n => {
        const isScanClass = n.startsWith('sc:')
        return { name: n.replace(/^(sc:|inst:)/, ''), type: isScanClass ? 'scan_class' : 'instance' }
      })
      const links = data.map(d => ({
        source: nodeIndex[`sc:${d.scan_class_name}`],
        target: nodeIndex[`inst:${d.instance_name}`],
        value: d.tag_count,
      }))

      const sankeyGen = d3Sankey()
        .nodeWidth(16)
        .nodePadding(12)
        .extent([[60, 8], [width - 60, height - 8]])
        .nodeSort(null)

      const { nodes: sNodes, links: sLinks } = sankeyGen({
        nodes: nodes.map(d => ({ ...d })),
        links: links.map(d => ({ ...d })),
      })

      // Color scales
      const scanClassColors = {}
      const instanceColors = {}
      let scIdx = 0, instIdx = 0
      sNodes.forEach(n => {
        if (n.type === 'scan_class') {
          scanClassColors[n.name] = COLORS[scIdx++ % COLORS.length]
        } else {
          instanceColors[n.name] = COLORS[(instIdx + 3) % COLORS.length]
          instIdx++
        }
      })

      const g = svg.append('g')

      // Links
      g.append('g')
        .attr('fill', 'none')
        .selectAll('path')
        .data(sLinks)
        .join('path')
        .attr('d', sankeyLinkHorizontal())
        .attr('stroke', d => scanClassColors[d.source.name] || '#4b5563')
        .attr('stroke-width', d => Math.max(1, d.width))
        .attr('stroke-opacity', 0.35)
        .on('mouseover', function () { d3.select(this).attr('stroke-opacity', 0.6) })
        .on('mouseout', function () { d3.select(this).attr('stroke-opacity', 0.35) })
        .append('title')
        .text(d => `${d.source.name} → ${d.target.name}: ${d.value} tags`)

      // Nodes
      g.append('g')
        .selectAll('rect')
        .data(sNodes)
        .join('rect')
        .attr('x', d => d.x0)
        .attr('y', d => d.y0)
        .attr('height', d => Math.max(1, d.y1 - d.y0))
        .attr('width', d => d.x1 - d.x0)
        .attr('fill', d => d.type === 'scan_class' ? (scanClassColors[d.name] || '#6b7280') : (instanceColors[d.name] || '#6b7280'))
        .attr('rx', 3)
        .append('title')
        .text(d => `${d.name}: ${d.value} tags`)

      // Labels
      g.append('g')
        .selectAll('text')
        .data(sNodes)
        .join('text')
        .attr('x', d => d.type === 'scan_class' ? d.x0 - 6 : d.x1 + 6)
        .attr('y', d => (d.y0 + d.y1) / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', d => d.type === 'scan_class' ? 'end' : 'start')
        .attr('fill', '#d1d5db')
        .attr('font-size', '11px')
        .text(d => `${d.name} (${d.value})`)
    } catch (e) {
      console.error('SankeyChart draw error:', e)
    }
  }, [data])

  useEffect(() => {
    draw()
    const observer = new ResizeObserver(draw)
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [draw])

  return (
    <div ref={containerRef} className="w-full">
      <svg ref={svgRef} className="w-full" style={{ overflow: 'visible' }} />
    </div>
  )
}

// Flow diagram: devices -> telegraf instances -> influx targets
function FlowDiagram({ flowLinks, deviceSummary, instanceSummary, influxSummary }) {
  const svgRef = useRef(null)
  const containerRef = useRef(null)

  const draw = useCallback(() => {
    try {
    if (!svgRef.current || !containerRef.current) return

    const container = containerRef.current
    const width = container.clientWidth
    if (width <= 0) return
    const enabledDevices = (deviceSummary || []).filter(d => d.enabled)
    const enabledInstances = (instanceSummary || []).filter(i => i.enabled)
    const influxTargets = influxSummary || []

    if (enabledDevices.length === 0 && enabledInstances.length === 0 && influxTargets.length === 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    // Layout constants
    const colWidth = 200
    const nodeHeight = 64
    const nodePadding = 12
    const margin = { top: 40, bottom: 20, left: 20, right: 20 }

    const maxRows = Math.max(enabledDevices.length, enabledInstances.length, influxTargets.length, 1)
    const totalHeight = margin.top + margin.bottom + maxRows * (nodeHeight + nodePadding)

    svg.attr('width', width).attr('height', totalHeight)

    const cols = [
      { x: margin.left, label: 'OPC UA Devices', items: enabledDevices, type: 'device' },
      { x: width / 2 - colWidth / 2, label: 'Telegraf Instances', items: enabledInstances, type: 'instance' },
      { x: width - colWidth - margin.right, label: 'InfluxDB Targets', items: influxTargets, type: 'influx' },
    ]

    // Calculate node positions
    const nodePositions = {}
    cols.forEach(col => {
      const totalItemHeight = col.items.length * nodeHeight + (col.items.length - 1) * nodePadding
      const startY = margin.top + (totalHeight - margin.top - margin.bottom - totalItemHeight) / 2
      col.items.forEach((item, i) => {
        const y = startY + i * (nodeHeight + nodePadding)
        const key = `${col.type}:${item.name}`
        nodePositions[key] = { x: col.x, y, w: colWidth, h: nodeHeight }
      })
    })

    const g = svg.append('g')

    // Column headers
    cols.forEach(col => {
      g.append('text')
        .attr('x', col.x + colWidth / 2)
        .attr('y', 22)
        .attr('text-anchor', 'middle')
        .attr('fill', '#9ca3af')
        .attr('font-size', '12px')
        .attr('font-weight', '600')
        .text(col.label)
    })

    // Draw links
    const linkData = flowLinks || []
    linkData.forEach(link => {
      const srcKey = `${link.source_type}:${link.source}`
      const tgtKey = `${link.target_type}:${link.target}`
      const src = nodePositions[srcKey]
      const tgt = nodePositions[tgtKey]
      if (!src || !tgt) return

      const x1 = src.x + src.w
      const y1 = src.y + src.h / 2
      const x2 = tgt.x
      const y2 = tgt.y + tgt.h / 2
      const midX = (x1 + x2) / 2

      // Thickness based on tag count
      const maxTags = Math.max(...linkData.map(l => l.tag_count), 1)
      const thickness = Math.max(2, (link.tag_count / maxTags) * 12)

      const path = g.append('path')
        .attr('d', `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`)
        .attr('fill', 'none')
        .attr('stroke', link.source_type === 'device' ? '#3b82f6' : '#8b5cf6')
        .attr('stroke-width', thickness)
        .attr('stroke-opacity', 0.3)

      path.on('mouseover', function () { d3.select(this).attr('stroke-opacity', 0.6) })
        .on('mouseout', function () { d3.select(this).attr('stroke-opacity', 0.3) })

      // Tag count label on link
      g.append('text')
        .attr('x', midX)
        .attr('y', (y1 + y2) / 2 - 6)
        .attr('text-anchor', 'middle')
        .attr('fill', '#6b7280')
        .attr('font-size', '10px')
        .text(`${link.tag_count} tags`)
    })

    // Draw nodes
    const colorByType = {
      device: { bg: '#1e3a5f', border: '#3b82f6', accent: '#60a5fa' },
      instance: { bg: '#3b1f5e', border: '#8b5cf6', accent: '#a78bfa' },
      influx: { bg: '#1a3a2a', border: '#10b981', accent: '#34d399' },
    }

    cols.forEach(col => {
      col.items.forEach(item => {
        const key = `${col.type}:${item.name}`
        const pos = nodePositions[key]
        if (!pos) return
        const colors = colorByType[col.type]

        // Node background
        g.append('rect')
          .attr('x', pos.x)
          .attr('y', pos.y)
          .attr('width', pos.w)
          .attr('height', pos.h)
          .attr('rx', 8)
          .attr('fill', colors.bg)
          .attr('stroke', colors.border)
          .attr('stroke-width', 1.5)
          .attr('stroke-opacity', 0.6)

        // Node name
        g.append('text')
          .attr('x', pos.x + 12)
          .attr('y', pos.y + 20)
          .attr('fill', '#e5e7eb')
          .attr('font-size', '12px')
          .attr('font-weight', '600')
          .text(item.name.length > 22 ? item.name.slice(0, 20) + '...' : item.name)

        // Status indicator
        const isEnabled = item.enabled !== false
        g.append('circle')
          .attr('cx', pos.x + pos.w - 16)
          .attr('cy', pos.y + 18)
          .attr('r', 4)
          .attr('fill', isEnabled ? '#10b981' : '#6b7280')

        // Metrics line
        let metricsText = ''
        if (col.type === 'device') {
          metricsText = `${item.enabled_tag_count} tags`
        } else if (col.type === 'instance') {
          metricsText = `${item.device_count} devices | ${item.tag_count} tags`
        } else if (col.type === 'influx') {
          metricsText = `${item.device_count} devices | ${item.tag_count} tags`
        }

        g.append('text')
          .attr('x', pos.x + 12)
          .attr('y', pos.y + 38)
          .attr('fill', '#9ca3af')
          .attr('font-size', '10px')
          .text(metricsText)

        // Secondary info
        let secondaryText = ''
        if (col.type === 'device') {
          secondaryText = item.endpoint_url || ''
          if (secondaryText.length > 30) secondaryText = secondaryText.slice(0, 28) + '...'
        } else if (col.type === 'influx') {
          secondaryText = `${item.org || ''}/${item.bucket || ''}`
          if (secondaryText.length > 30) secondaryText = secondaryText.slice(0, 28) + '...'
        }

        if (secondaryText) {
          g.append('text')
            .attr('x', pos.x + 12)
            .attr('y', pos.y + 52)
            .attr('fill', '#6b7280')
            .attr('font-size', '9px')
            .attr('font-family', 'monospace')
            .text(secondaryText)
        }
      })
    })
    } catch (e) {
      console.error('FlowDiagram draw error:', e)
    }
  }, [flowLinks, deviceSummary, instanceSummary, influxSummary])

  useEffect(() => {
    draw()
    const observer = new ResizeObserver(draw)
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [draw])

  return (
    <div ref={containerRef} className="w-full overflow-x-auto">
      <svg ref={svgRef} className="w-full" />
    </div>
  )
}

export default function Dashboard() {
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getMetrics().then(setMetrics).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={32} className="animate-spin text-blue-500" />
      </div>
    )
  }

  if (!metrics) return <p className="text-red-400">Failed to load metrics.</p>

  const hasFlowData = (metrics.flow_links || []).length > 0
    || (metrics.device_summary || []).length > 0
    || (metrics.instance_summary || []).length > 0
    || (metrics.influx_summary || []).length > 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Dashboard</h1>
        <p className="text-sm text-gray-400 mt-1">Overview of your OPC UA → Telegraf → InfluxDB pipeline</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Server} label="OPC UA Devices" value={metrics.total_devices}
          sub={`${metrics.enabled_devices} enabled`} color="blue" to="/devices" />
        <StatCard icon={Tag} label="Active Tags" value={metrics.enabled_tags}
          sub={`${metrics.total_tags} total configured`} color="green" to="/tags" />
        <StatCard icon={Layers} label="Telegraf Instances" value={metrics.instance_count}
          color="yellow" to="/scan-classes" />
        <StatCard icon={Database} label="InfluxDB Targets" value={metrics.influxdb_count}
          color="purple" to="/influxdb" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sankey: scan class -> instance tag distribution */}
        <div className="card p-5">
          <h2 className="text-base font-semibold text-gray-100 mb-4 flex items-center gap-2">
            <Activity size={16} className="text-blue-400" /> Tag Distribution
          </h2>
          <p className="text-xs text-gray-500 mb-3">Scan Class → Telegraf Instance</p>
          {(metrics.tags_by_instance_scan_class || []).length === 0 ? (
            <div className="text-center text-gray-500 py-8 text-sm">
              No tag assignments found.{' '}
              <Link to="/tags" className="text-blue-400 hover:underline">Assign tags</Link>
            </div>
          ) : (
            <SankeyChart data={metrics.tags_by_instance_scan_class} />
          )}
        </div>

        {/* InfluxDB targets with instances */}
        <div className="card p-5">
          <h2 className="text-base font-semibold text-gray-100 mb-4 flex items-center gap-2">
            <Database size={16} className="text-blue-400" /> InfluxDB Targets
          </h2>
          {metrics.influx_summary.length === 0 ? (
            <div className="text-center text-gray-500 py-8 text-sm">
              No InfluxDB targets configured.{' '}
              <Link to="/influxdb" className="text-blue-400 hover:underline">Add one</Link>
            </div>
          ) : (
            <div className="space-y-3">
              {metrics.influx_summary.map(cfg => (
                <div key={cfg.id} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
                  <div>
                    <p className="font-medium text-sm text-gray-200">{cfg.name}</p>
                    <p className="text-xs text-gray-400 font-mono">{cfg.url}</p>
                    <p className="text-xs text-gray-500">{cfg.org} / {cfg.bucket}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-semibold text-gray-300">{cfg.device_count}</span>
                    <p className="text-xs text-gray-500">devices</p>
                    <span className="text-sm font-semibold text-gray-300">{cfg.tag_count}</span>
                    <p className="text-xs text-gray-500">tags</p>
                    {cfg.is_default && <span className="badge badge-blue mt-1">default</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Device table */}
      <div className="card">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h2 className="text-base font-semibold text-gray-100">Devices</h2>
          <Link to="/devices" className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1">
            Manage <ArrowRight size={14} />
          </Link>
        </div>
        {metrics.device_summary.length === 0 ? (
          <div className="text-center text-gray-500 py-10 text-sm">
            No devices configured.{' '}
            <Link to="/devices" className="text-blue-400 hover:underline">Add a device</Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-800/50 border-b border-gray-700">
                <tr>
                  <th className="table-th">Name</th>
                  <th className="table-th">Endpoint</th>
                  <th className="table-th">Status</th>
                  <th className="table-th text-center">Active Tags</th>
                  <th className="table-th">Instance</th>
                  <th className="table-th">InfluxDB Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {metrics.device_summary.map(d => <DeviceRow key={d.id} device={d} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pipeline flow diagram */}
      <div className="card p-5">
        <h2 className="text-base font-semibold text-gray-100 mb-4 flex items-center gap-2">
          <Activity size={16} className="text-purple-400" /> Pipeline Flow
        </h2>
        <p className="text-xs text-gray-500 mb-4">Devices → Telegraf Instances → InfluxDB Targets</p>
        {!hasFlowData ? (
          <div className="text-center text-gray-500 py-10 text-sm">
            No pipeline connections found. Assign devices to instances and InfluxDB targets to visualize the flow.
          </div>
        ) : (
          <FlowDiagram
            flowLinks={metrics.flow_links}
            deviceSummary={metrics.device_summary}
            instanceSummary={metrics.instance_summary}
            influxSummary={metrics.influx_summary}
          />
        )}
      </div>
    </div>
  )
}
