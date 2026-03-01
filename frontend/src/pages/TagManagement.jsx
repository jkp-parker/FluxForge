import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Tag, Search, Loader2, CheckSquare, Square, MinusSquare, SortAsc, SortDesc,
  ChevronDown, ChevronRight, Trash2, Power, PowerOff, Filter,
  Plus, GripVertical, RefreshCw, FolderClosed, Server, ChevronsUpDown, ChevronsDownUp, Activity,
} from 'lucide-react'
import {
  listDevices, getDeviceTags, saveDeviceTags, listScanClasses,
  patchTag, deleteTag, getScanStatus, startScan, readTagValues,
  getDeviceNodeIncludes, createNodeInclude, patchNodeInclude, deleteNodeInclude as deleteNodeIncludeApi,
} from '../services/api'
import Modal from '../components/Modal'

function matchGlob(pattern, text) {
  if (!pattern) return true
  const regex = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
    'i'
  )
  return regex.test(text)
}

// ── Resizable column hook ──
function useResizableColumns(defaultWidths) {
  const [widths, setWidths] = useState(defaultWidths)
  const dragging = useRef(null)

  const onMouseDown = useCallback((colIndex, e) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = widths[colIndex]

    const onMouseMove = (e) => {
      const delta = e.clientX - startX
      setWidths(prev => {
        const next = [...prev]
        next[colIndex] = Math.max(40, startWidth + delta)
        return next
      })
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      dragging.current = null
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    dragging.current = colIndex
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [widths])

  return { widths, onMouseDown }
}

// ── Tree builder ──
function buildTree(tags) {
  const deviceMap = new Map()
  const folderMaps = new Map() // device_id -> Map<path, folderNode>

  for (const tag of tags) {
    if (!deviceMap.has(tag.device_id)) {
      deviceMap.set(tag.device_id, {
        type: 'device',
        id: `device:${tag.device_id}`,
        label: tag.device_name,
        device_id: tag.device_id,
        children: [],
      })
      folderMaps.set(tag.device_id, new Map())
    }

    const deviceNode = deviceMap.get(tag.device_id)
    const fMap = folderMaps.get(tag.device_id)
    const parts = (tag.path || tag.display_name).split('/')

    let parent = deviceNode
    let pathSoFar = ''

    for (let i = 0; i < parts.length - 1; i++) {
      pathSoFar = pathSoFar ? `${pathSoFar}/${parts[i]}` : parts[i]
      const folderKey = `${tag.device_id}:${pathSoFar}`

      if (!fMap.has(folderKey)) {
        const folder = {
          type: 'folder',
          id: folderKey,
          label: parts[i],
          path: pathSoFar,
          device_id: tag.device_id,
          children: [],
        }
        fMap.set(folderKey, folder)
        parent.children.push(folder)
      }
      parent = fMap.get(folderKey)
    }

    parent.children.push({
      type: 'tag',
      id: `${tag.device_id}:${tag.node_id}`,
      label: parts[parts.length - 1] || tag.display_name,
      tag: tag,
      device_id: tag.device_id,
    })
  }

  return [...deviceMap.values()]
}

function getNodeStats(node) {
  if (node.type === 'tag') {
    return {
      total: 1,
      collected: node.tag.is_collected ? 1 : 0,
      enabled: (node.tag.is_collected && node.tag.enabled) ? 1 : 0,
    }
  }
  let total = 0, collected = 0, enabled = 0
  for (const child of (node.children || [])) {
    const s = getNodeStats(child)
    total += s.total
    collected += s.collected
    enabled += s.enabled
  }
  return { total, collected, enabled }
}

function getAllLeafKeys(node) {
  if (node.type === 'tag') return [`${node.tag.device_id}:${node.tag.node_id}`]
  return (node.children || []).flatMap(c => getAllLeafKeys(c))
}

function getAllLeafTags(node) {
  if (node.type === 'tag') return [node.tag]
  return (node.children || []).flatMap(c => getAllLeafTags(c))
}

function collectAllNodeIds(node) {
  const ids = [node.id]
  for (const child of (node.children || [])) {
    ids.push(...collectAllNodeIds(child))
  }
  return ids
}

function getVisibleLeafTags(tree, expanded) {
  const tags = []
  const walk = (nodes, parentExpanded) => {
    for (const node of nodes) {
      if (!parentExpanded) continue
      if (node.type === 'tag') {
        tags.push(node.tag)
      } else if (node.children) {
        walk(node.children, expanded.has(node.id))
      }
    }
  }
  walk(tree, true)
  return tags
}

function formatLiveValue(entry) {
  if (!entry) return <span className="text-gray-600">{'\u2014'}</span>
  if (entry.status && entry.status !== 'Good' && entry.status.startsWith('Error'))
    return <span className="text-red-400" title={entry.status}>err</span>
  const v = entry.value
  if (v === null || v === undefined) return <span className="text-gray-500">null</span>
  if (typeof v === 'boolean') return <span className={v ? 'text-green-400' : 'text-red-400'}>{String(v)}</span>
  if (typeof v === 'number') return <span className="text-cyan-400">{Number.isInteger(v) ? v : v.toFixed(4)}</span>
  return <span className="text-gray-300">{String(v).slice(0, 30)}</span>
}

export default function TagManagement() {
  const [searchParams] = useSearchParams()
  const initialDeviceFilter = searchParams.get('device') || ''

  const [devices, setDevices] = useState([])
  const [mergedTags, setMergedTags] = useState([])
  const [scanClasses, setScanClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [savedTagsByDevice, setSavedTagsByDevice] = useState({})
  const [nodeIncludesByDevice, setNodeIncludesByDevice] = useState({})

  // View mode
  const [viewMode, setViewMode] = useState('all')

  // Filters
  const [search, setSearch] = useState('')
  const [wildcardPattern, setWildcardPattern] = useState('')
  const [filterDevice, setFilterDevice] = useState(initialDeviceFilter)
  const [filterScanClass, setFilterScanClass] = useState('')
  const [filterDataType, setFilterDataType] = useState('')
  const [filterEnabled, setFilterEnabled] = useState('')
  const [filterNs, setFilterNs] = useState('')

  // Sort
  const [sortKey, setSortKey] = useState('display_name')
  const [sortDir, setSortDir] = useState('asc')

  // Selection
  const [selected, setSelected] = useState(new Set())

  // Bulk actions
  const [bulkScanClass, setBulkScanClass] = useState('')

  // Grouping / View style
  const [groupBy, setGroupBy] = useState('tree')
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())

  // Refresh scanning
  const [scanning, setScanning] = useState(false)

  // Tree expand/collapse
  const [expanded, setExpanded] = useState(new Set())

  // Branch dialog
  const [branchDialog, setBranchDialog] = useState(null)
  const [branchScanClass, setBranchScanClass] = useState('')

  // Live values
  const [liveValues, setLiveValues] = useState({})  // { "node_id": { value, status, timestamp } }
  const [liveEnabled, setLiveEnabled] = useState(false)
  const liveIntervalRef = useRef(null)

  // Column resize — tree layout
  const { widths: treeColWidths, onMouseDown: onTreeColResize } = useResizableColumns([
    36,   // checkbox
    300,  // name (with indent)
    100,  // value (live)
    100,  // status / summary
    50,   // ns
    100,  // type
    130,  // measurement
    120,  // scan class
    70,   // enabled
    40,   // actions
  ])

  // Column resize — flat layout
  const { widths: flatColWidths, onMouseDown: onFlatColResize } = useResizableColumns([
    36,   // checkbox
    90,   // status
    120,  // device
    160,  // tag name
    200,  // path
    100,  // value (live)
    50,   // ns
    100,  // type
    130,  // measurement
    120,  // scan class
    70,   // enabled
    40,   // actions
  ])

  const loadAll = async () => {
    setLoading(true)
    try {
      const [devs, scs] = await Promise.all([listDevices(), listScanClasses()])
      setDevices(devs)
      setScanClasses(scs)

      const perDevice = await Promise.all(devs.map(async (d) => {
        const [tags, scanResult, nodeIncludes] = await Promise.all([
          getDeviceTags(d.id),
          getScanStatus(d.id).catch(() => ({ status: 'none', nodes: [] })),
          getDeviceNodeIncludes(d.id),
        ])
        return {
          device: d, tags,
          scanNodes: scanResult.status === 'complete' ? (scanResult.nodes || []) : [],
          nodeIncludes,
        }
      }))

      const savedByDevice = {}
      const niByDevice = {}
      const allMerged = []

      for (const { device, tags, scanNodes, nodeIncludes } of perDevice) {
        const savedByNodeId = new Map(tags.map(t => [t.node_id, t]))
        savedByDevice[device.id] = tags
        niByDevice[device.id] = nodeIncludes

        const seenNodeIds = new Set()
        for (const node of scanNodes) {
          if (seenNodeIds.has(node.node_id)) continue
          seenNodeIds.add(node.node_id)

          const saved = savedByNodeId.get(node.node_id)
          allMerged.push({
            node_id: node.node_id,
            device_id: device.id,
            device_name: device.name,
            display_name: node.display_name,
            path: node.path || '',
            namespace: node.namespace,
            identifier: node.identifier,
            identifier_type: node.identifier_type || 's',
            data_type: node.data_type || '',
            is_collected: !!saved,
            saved_tag_id: saved?.id || null,
            measurement_name: saved?.measurement_name || '',
            scan_class_id: saved?.scan_class_id || null,
            scan_class_name: saved?.scan_class_name || '',
            enabled: saved?.enabled ?? false,
          })
        }

        for (const tag of tags) {
          if (!seenNodeIds.has(tag.node_id)) {
            allMerged.push({
              node_id: tag.node_id,
              device_id: device.id,
              device_name: device.name,
              display_name: tag.display_name,
              path: tag.path || '',
              namespace: tag.namespace,
              identifier: tag.identifier,
              identifier_type: tag.identifier_type || 's',
              data_type: tag.data_type || '',
              is_collected: true,
              saved_tag_id: tag.id,
              measurement_name: tag.measurement_name || '',
              scan_class_id: tag.scan_class_id || null,
              scan_class_name: tag.scan_class_name || '',
              enabled: tag.enabled,
            })
          }
        }
      }

      // Mark tags covered by enabled NodeIncludes as collected via branch subscription
      for (const tag of allMerged) {
        if (tag.is_collected) continue
        const deviceIncludes = niByDevice[tag.device_id] || []
        for (const ni of deviceIncludes) {
          if (ni.enabled && tag.path) {
            const prefix = ni.parent_path + '/'
            if (tag.path.startsWith(prefix) || tag.path === ni.parent_path) {
              tag.is_collected = true
              tag.collected_via_include = true
              break
            }
          }
        }
      }

      setSavedTagsByDevice(savedByDevice)
      setNodeIncludesByDevice(niByDevice)
      setMergedTags(allMerged)
    } finally {
      setLoading(false)
    }
  }

  const refreshAllScans = async () => {
    setScanning(true)
    try {
      const devs = devices.length ? devices : await listDevices()
      await Promise.all(devs.map(d => startScan(d.id)))

      const poll = () => new Promise((resolve) => {
        const interval = setInterval(async () => {
          const statuses = await Promise.all(devs.map(d => getScanStatus(d.id).catch(() => ({ status: 'error' }))))
          if (statuses.every(s => s.status !== 'scanning')) {
            clearInterval(interval)
            resolve()
          }
        }, 1500)
      })
      await poll()
      await loadAll()
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  const defaultScanClass = useMemo(() => scanClasses.find(sc => sc.is_default), [scanClasses])

  const namespaces = useMemo(() => [...new Set(mergedTags.map(t => t.namespace))].sort(), [mergedTags])
  const dataTypes = useMemo(() => [...new Set(mergedTags.map(t => t.data_type).filter(Boolean))].sort(), [mergedTags])

  const filtered = useMemo(() => {
    return mergedTags
      .filter(t => {
        if (viewMode === 'collected' && !t.is_collected) return false
        if (viewMode === 'available' && t.is_collected) return false

        if (search) {
          const s = search.toLowerCase()
          if (!t.display_name.toLowerCase().includes(s) &&
              !t.path.toLowerCase().includes(s) &&
              !t.node_id.toLowerCase().includes(s) &&
              !t.measurement_name.toLowerCase().includes(s)) return false
        }
        if (wildcardPattern && !matchGlob(wildcardPattern, t.path || t.display_name)) return false
        if (filterDevice && t.device_id !== Number(filterDevice)) return false
        if (filterScanClass) {
          if (filterScanClass === '__none__' && t.scan_class_id) return false
          if (filterScanClass !== '__none__' && t.scan_class_id !== Number(filterScanClass)) return false
        }
        if (filterDataType && t.data_type !== filterDataType) return false
        if (filterEnabled === 'true' && !t.enabled) return false
        if (filterEnabled === 'false' && t.enabled) return false
        if (filterNs !== '' && t.namespace !== Number(filterNs)) return false
        return true
      })
      .sort((a, b) => {
        const av = a[sortKey] ?? ''
        const bv = b[sortKey] ?? ''
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv))
        return sortDir === 'asc' ? cmp : -cmp
      })
  }, [mergedTags, viewMode, search, wildcardPattern, filterDevice, filterScanClass, filterDataType, filterEnabled, filterNs, sortKey, sortDir])

  // Build tree from filtered data
  const tree = useMemo(() => buildTree(filtered), [filtered])

  // Live value polling — only poll tags visible in expanded tree branches
  const fetchLiveValues = useCallback(async () => {
    if (!devices.length || !mergedTags.length) return
    const tagsToRead = groupBy === 'tree'
      ? getVisibleLeafTags(tree, expanded)
      : mergedTags
    if (!tagsToRead.length) return
    const byDevice = new Map()
    for (const t of tagsToRead) {
      if (!byDevice.has(t.device_id)) byDevice.set(t.device_id, [])
      byDevice.get(t.device_id).push(t.node_id)
    }
    const allValues = {}
    await Promise.all([...byDevice.entries()].map(async ([deviceId, nodeIds]) => {
      try {
        const vals = await readTagValues(deviceId, nodeIds)
        Object.assign(allValues, vals)
      } catch { /* device offline — skip */ }
    }))
    setLiveValues(allValues)
  }, [devices, mergedTags, groupBy, tree, expanded])

  useEffect(() => {
    if (liveIntervalRef.current) {
      clearInterval(liveIntervalRef.current)
      liveIntervalRef.current = null
    }
    if (liveEnabled) {
      fetchLiveValues()
      liveIntervalRef.current = setInterval(fetchLiveValues, 5000)
    } else {
      setLiveValues({})
    }
    return () => {
      if (liveIntervalRef.current) clearInterval(liveIntervalRef.current)
    }
  }, [liveEnabled, fetchLiveValues])

  // Build node include lookup map: "deviceId:path" -> include record
  const nodeIncludeMap = useMemo(() => {
    const map = {}
    for (const [deviceId, includes] of Object.entries(nodeIncludesByDevice)) {
      for (const ni of includes) {
        map[`${deviceId}:${ni.parent_path}`] = ni
      }
    }
    return map
  }, [nodeIncludesByDevice])

  // Groups for flat view
  const groups = useMemo(() => {
    if (groupBy === 'tree' || groupBy === 'flat') return null
    const map = new Map()
    for (const tag of filtered) {
      let key
      if (groupBy === 'device') key = tag.device_name || `Device ${tag.device_id}`
      else if (groupBy === 'scan_class') key = tag.scan_class_name || 'No Scan Class'
      else if (groupBy === 'namespace') key = `Namespace ${tag.namespace}`
      else if (groupBy === 'data_type') key = tag.data_type || 'Unknown'
      else if (groupBy === 'status') key = tag.is_collected ? 'Collected' : 'Available'
      else key = 'Other'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(tag)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered, groupBy])

  // Auto-expand when filtering
  useEffect(() => {
    if (search || wildcardPattern) {
      const allIds = new Set()
      const walk = (nodes) => {
        for (const n of nodes) {
          if (n.children) { allIds.add(n.id); walk(n.children) }
        }
      }
      walk(tree)
      setExpanded(allIds)
    }
  }, [search, wildcardPattern, tree])

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const tKey = (t) => `${t.device_id}:${t.node_id}`

  const toggleSelect = (key) => {
    setSelected(s => {
      const next = new Set(s)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const toggleSelectBranch = (node) => {
    const leafKeys = getAllLeafKeys(node)
    setSelected(prev => {
      const next = new Set(prev)
      const allSelected = leafKeys.every(k => next.has(k))
      if (allSelected) {
        for (const k of leafKeys) next.delete(k)
      } else {
        for (const k of leafKeys) next.add(k)
      }
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map(t => tKey(t))))
  }

  const selectByPattern = () => {
    if (!wildcardPattern) return
    const matching = new Set()
    for (const t of filtered) {
      if (matchGlob(wildcardPattern, t.path || t.display_name)) {
        matching.add(tKey(t))
      }
    }
    setSelected(prev => {
      const next = new Set(prev)
      for (const k of matching) next.add(k)
      return next
    })
  }

  const toggleExpand = (nodeId) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(nodeId) ? next.delete(nodeId) : next.add(nodeId)
      return next
    })
  }

  const expandAll = () => {
    const allIds = new Set()
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.children) { allIds.add(n.id); walk(n.children) }
      }
    }
    walk(tree)
    setExpanded(allIds)
  }

  const collapseAll = () => setExpanded(new Set())

  // ── Actions for collected tags (patch/delete) ──

  const handlePatch = async (tag, field, value) => {
    if (!tag.saved_tag_id) return
    await patchTag(tag.device_id, tag.saved_tag_id, { [field]: value })
    await loadAll()
  }

  const handleRemoveFromCollection = async (tag) => {
    if (!tag.saved_tag_id) return
    await deleteTag(tag.device_id, tag.saved_tag_id)
    await loadAll()
  }

  // ── Actions for adding tags to collection ──

  const handleAddToCollection = async (tags, scanClassId) => {
    const byDevice = new Map()
    for (const tag of tags) {
      if (tag.is_collected) continue
      if (!byDevice.has(tag.device_id)) byDevice.set(tag.device_id, [])
      byDevice.get(tag.device_id).push(tag)
    }

    for (const [deviceId, newTags] of byDevice) {
      const existing = savedTagsByDevice[deviceId] || []
      const existingNodeIds = new Set(existing.map(t => t.node_id))
      const combined = [...existing]
      const addedNodeIds = new Set()
      for (const tag of newTags) {
        if (existingNodeIds.has(tag.node_id) || addedNodeIds.has(tag.node_id)) continue
        addedNodeIds.add(tag.node_id)
        combined.push({
          device_id: deviceId,
          node_id: tag.node_id,
          namespace: tag.namespace,
          identifier: tag.identifier,
          identifier_type: tag.identifier_type,
          display_name: tag.display_name,
          path: tag.path,
          data_type: tag.data_type,
          measurement_name: '',
          scan_class_id: scanClassId || null,
          enabled: true,
        })
      }
      await saveDeviceTags(deviceId, combined)
    }
    await loadAll()
  }

  // ── Branch subscription ──

  const handleAddBranchSubscription = async (node, scanClassId) => {
    await createNodeInclude(node.device_id, {
      device_id: node.device_id,
      parent_node_id: `path:${node.path || node.label}`,
      parent_path: node.path || node.label,
      display_name: node.label,
      scan_class_id: scanClassId || null,
      enabled: true,
    })
    await loadAll()
  }

  const handlePatchNodeInclude = async (ni, field, value) => {
    await patchNodeInclude(ni.device_id, ni.id, { [field]: value })
    await loadAll()
  }

  const handleDeleteNodeInclude = async (ni) => {
    await deleteNodeIncludeApi(ni.device_id, ni.id)
    await loadAll()
  }

  // ── Bulk actions ──

  const getSelectedTags = () => mergedTags.filter(t => selected.has(tKey(t)))

  // Find the highest complete branch for dialog
  const findCompleteBranch = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'tag') continue
      const leafKeys = getAllLeafKeys(node)
      if (leafKeys.length >= 2 && leafKeys.every(k => selected.has(k))) {
        return node
      }
      const deeper = findCompleteBranch(node.children || [])
      if (deeper) return deeper
    }
    return null
  }

  const handleBulkAddToCollection = async () => {
    const tags = getSelectedTags().filter(t => !t.is_collected)
    if (tags.length === 0) return
    const scId = bulkScanClass && bulkScanClass !== '__none__'
      ? Number(bulkScanClass)
      : (defaultScanClass?.id || null)

    // Check for complete branch selection in tree view
    if (groupBy === 'tree') {
      const branch = findCompleteBranch(tree)
      if (branch && branch.type === 'folder') {
        setBranchDialog({ node: branch, uncollectedTags: tags, scanClassId: scId })
        setBranchScanClass(scId ? String(scId) : '')
        return
      }
    }

    await handleAddToCollection(tags, scId)
    setSelected(new Set())
  }

  const handleBulkScanClass = async () => {
    const scId = bulkScanClass === '__none__' ? null : bulkScanClass ? Number(bulkScanClass) : null
    const tags = getSelectedTags().filter(t => t.is_collected && t.saved_tag_id)
    await Promise.all(tags.map(t => patchTag(t.device_id, t.saved_tag_id, { scan_class_id: scId })))
    setSelected(new Set())
    setBulkScanClass('')
    await loadAll()
  }

  const handleBulkEnable = async (enabled) => {
    const tags = getSelectedTags().filter(t => t.is_collected && t.saved_tag_id)
    await Promise.all(tags.map(t => patchTag(t.device_id, t.saved_tag_id, { enabled })))
    setSelected(new Set())
    await loadAll()
  }

  const handleBulkRemove = async () => {
    const tags = getSelectedTags().filter(t => t.is_collected && t.saved_tag_id)
    if (tags.length === 0) return
    if (!confirm(`Remove ${tags.length} tags from collection?`)) return
    await Promise.all(tags.map(t => deleteTag(t.device_id, t.saved_tag_id)))
    setSelected(new Set())
    await loadAll()
  }

  const toggleGroup = (key) => {
    setCollapsedGroups(s => {
      const next = new Set(s)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const SortIcon = ({ k }) => {
    if (sortKey !== k) return <SortAsc size={12} className="text-gray-600" />
    return sortDir === 'asc' ? <SortAsc size={12} className="text-blue-400" /> : <SortDesc size={12} className="text-blue-400" />
  }

  // Stats
  const totalAvailable = mergedTags.length
  const collectedCount = mergedTags.filter(t => t.is_collected).length
  const enabledCount = mergedTags.filter(t => t.is_collected && t.enabled).length
  const devicesWithTags = new Set(mergedTags.map(t => t.device_id)).size
  const selectedCollected = getSelectedTags().filter(t => t.is_collected).length
  const selectedUncollected = getSelectedTags().filter(t => !t.is_collected).length

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 size={32} className="animate-spin text-blue-500" />
    </div>
  )

  // ── Tree row rendering ──

  const TreeResizeTh = ({ index, children, className = '' }) => (
    <th className={`table-th relative ${className}`} style={{ width: treeColWidths[index], minWidth: 40 }}>
      {children}
      <div
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/40 z-20"
        onMouseDown={(e) => onTreeColResize(index, e)}
      />
    </th>
  )

  const renderTreeRow = (node, depth) => {
    const isExpanded = expanded.has(node.id)
    const indent = depth * 20

    if (node.type === 'tag') {
      const tag = node.tag
      const key = tKey(tag)
      const isBranchCollected = tag.collected_via_include
      return (
        <tr key={node.id} className={`hover:bg-gray-800/50 ${selected.has(key) ? 'bg-blue-900/20' : ''}`}>
          <td className="table-td" style={{ width: treeColWidths[0] }}>
            {isBranchCollected ? (
              <CheckSquare size={14} className="text-gray-600 cursor-not-allowed" title="Managed by branch subscription" />
            ) : (
              <button onClick={() => toggleSelect(key)}>
                {selected.has(key)
                  ? <CheckSquare size={14} className="text-blue-400" />
                  : <Square size={14} className="text-gray-500" />}
              </button>
            )}
          </td>
          <td className="table-td" style={{ width: treeColWidths[1] }}>
            <div className="flex items-center gap-1.5" style={{ paddingLeft: indent + 20 }}>
              <Tag size={12} className={isBranchCollected ? 'text-purple-400 flex-shrink-0' : 'text-blue-400 flex-shrink-0'} />
              <span className="truncate text-gray-200" title={tag.display_name}>{node.label}</span>
            </div>
          </td>
          <td className="table-td font-mono text-xs truncate" style={{ width: treeColWidths[2] }} title={liveValues[tag.node_id]?.status}>
            {liveEnabled ? formatLiveValue(liveValues[tag.node_id]) : <span className="text-gray-600">{'\u2014'}</span>}
          </td>
          <td className="table-td text-center" style={{ width: treeColWidths[3] }}>
            {isBranchCollected
              ? <span className="badge badge-purple">Branch</span>
              : tag.is_collected
                ? <span className="badge badge-green">Collected</span>
                : <span className="badge badge-gray">Available</span>}
          </td>
          <td className="table-td text-center" style={{ width: treeColWidths[4] }}>
            <span className="badge badge-gray">{tag.namespace}</span>
          </td>
          <td className="table-td text-xs text-gray-400 truncate" style={{ width: treeColWidths[5] }} title={tag.data_type}>
            {tag.data_type || '\u2014'}
          </td>
          {isBranchCollected ? (
            <>
              <td className="table-td text-gray-600 text-xs italic" style={{ width: treeColWidths[6] }}>inherited</td>
              <td className="table-td text-gray-600 text-xs italic" style={{ width: treeColWidths[7] }}>inherited</td>
              <td className="table-td text-center" style={{ width: treeColWidths[8] }}>
                <input type="checkbox" checked disabled
                  className="rounded border-gray-700 bg-gray-800 text-gray-600 cursor-not-allowed" />
              </td>
              <td className="table-td text-right" style={{ width: treeColWidths[9] }}></td>
            </>
          ) : tag.is_collected ? (
            <>
              <td className="table-td" style={{ width: treeColWidths[6] }}>
                <input className="input py-0.5 text-xs w-full"
                  defaultValue={tag.measurement_name}
                  onBlur={e => { if (e.target.value !== tag.measurement_name) handlePatch(tag, 'measurement_name', e.target.value) }}
                  placeholder={tag.display_name} />
              </td>
              <td className="table-td" style={{ width: treeColWidths[7] }}>
                <select className="input py-0.5 text-xs w-full"
                  value={tag.scan_class_id || ''}
                  onChange={e => handlePatch(tag, 'scan_class_id', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">None</option>
                  {scanClasses.map(sc => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
                </select>
              </td>
              <td className="table-td text-center" style={{ width: treeColWidths[8] }}>
                <input type="checkbox" checked={tag.enabled}
                  onChange={e => handlePatch(tag, 'enabled', e.target.checked)}
                  className="rounded border-gray-600 bg-gray-800 text-blue-500" />
              </td>
              <td className="table-td text-right" style={{ width: treeColWidths[9] }}>
                <button onClick={() => handleRemoveFromCollection(tag)} className="text-red-400 hover:text-red-300 p-1" title="Remove from collection">
                  <Trash2 size={12} />
                </button>
              </td>
            </>
          ) : (
            <>
              <td className="table-td text-gray-600 text-xs" style={{ width: treeColWidths[6] }}>{'\u2014'}</td>
              <td className="table-td text-gray-600 text-xs" style={{ width: treeColWidths[7] }}>{'\u2014'}</td>
              <td className="table-td text-center text-gray-600" style={{ width: treeColWidths[8] }}>{'\u2014'}</td>
              <td className="table-td text-right" style={{ width: treeColWidths[9] }}>
                <button onClick={() => handleAddToCollection([tag], defaultScanClass?.id || null)} className="text-green-400 hover:text-green-300 p-1" title="Add to collection">
                  <Plus size={12} />
                </button>
              </td>
            </>
          )}
        </tr>
      )
    }

    // Device or folder node
    const stats = getNodeStats(node)
    const niKey = `${node.device_id}:${node.path || ''}`
    const ni = node.type === 'folder' ? nodeIncludeMap[niKey] : null
    const leafKeys = getAllLeafKeys(node)
    const allSel = leafKeys.length > 0 && leafKeys.every(k => selected.has(k))
    const someSel = !allSel && leafKeys.some(k => selected.has(k))

    const IconComponent = node.type === 'device' ? Server : FolderClosed
    const iconColor = node.type === 'device' ? 'text-green-400' : 'text-yellow-500'

    return (
      <React.Fragment key={node.id}>
        <tr className="hover:bg-gray-800/50">
          <td className="table-td" style={{ width: treeColWidths[0] }}>
            <button onClick={(e) => { e.stopPropagation(); toggleSelectBranch(node) }}>
              {allSel ? <CheckSquare size={14} className="text-blue-400" />
                : someSel ? <MinusSquare size={14} className="text-blue-400/60" />
                : <Square size={14} className="text-gray-500" />}
            </button>
          </td>
          <td className="table-td cursor-pointer" style={{ width: treeColWidths[1] }} onClick={() => toggleExpand(node.id)}>
            <div className="flex items-center gap-1.5 font-medium" style={{ paddingLeft: indent }}>
              {isExpanded
                ? <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
                : <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />}
              <IconComponent size={14} className={`${iconColor} flex-shrink-0`} />
              <span className="text-gray-200 truncate">{node.label}</span>
            </div>
          </td>
          <td className="table-td text-gray-600 text-xs" style={{ width: treeColWidths[2] }}>{'\u2014'}</td>
          <td className="table-td" style={{ width: treeColWidths[3] }}>
            <div className="flex items-center gap-1 flex-wrap">
              <span className="badge badge-gray text-xs">{stats.collected}/{stats.total}</span>
              {ni && <span className="badge badge-blue text-xs">Branch sub</span>}
            </div>
          </td>
          <td className="table-td text-gray-600 text-center" style={{ width: treeColWidths[4] }}>{'\u2014'}</td>
          <td className="table-td text-gray-600 text-xs" style={{ width: treeColWidths[5] }}>{'\u2014'}</td>
          {ni ? (
            <>
              <td className="table-td" style={{ width: treeColWidths[6] }}>
                <input className="input py-0.5 text-xs w-full"
                  defaultValue={ni.measurement_name}
                  onClick={e => e.stopPropagation()}
                  onBlur={e => { if (e.target.value !== ni.measurement_name) handlePatchNodeInclude(ni, 'measurement_name', e.target.value) }}
                  placeholder={node.label} />
              </td>
              <td className="table-td" style={{ width: treeColWidths[7] }}>
                <select className="input py-0.5 text-xs w-full"
                  value={ni.scan_class_id || ''}
                  onClick={e => e.stopPropagation()}
                  onChange={e => handlePatchNodeInclude(ni, 'scan_class_id', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">None</option>
                  {scanClasses.map(sc => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
                </select>
              </td>
              <td className="table-td text-center" style={{ width: treeColWidths[8] }}>
                <input type="checkbox" checked={ni.enabled}
                  onClick={e => e.stopPropagation()}
                  onChange={e => handlePatchNodeInclude(ni, 'enabled', e.target.checked)}
                  className="rounded border-gray-600 bg-gray-800 text-blue-500" />
              </td>
              <td className="table-td text-right" style={{ width: treeColWidths[9] }}>
                <button onClick={(e) => { e.stopPropagation(); handleDeleteNodeInclude(ni) }} className="text-red-400 hover:text-red-300 p-1" title="Remove branch subscription">
                  <Trash2 size={12} />
                </button>
              </td>
            </>
          ) : (
            <>
              <td className="table-td text-gray-600 text-xs" style={{ width: treeColWidths[6] }}>{'\u2014'}</td>
              <td className="table-td text-gray-600 text-xs" style={{ width: treeColWidths[7] }}>{'\u2014'}</td>
              <td className="table-td text-center text-gray-600" style={{ width: treeColWidths[8] }}>{'\u2014'}</td>
              <td className="table-td text-right" style={{ width: treeColWidths[9] }}>
                {node.type === 'folder' && stats.collected < stats.total && (
                  <button onClick={(e) => {
                    e.stopPropagation()
                    const uncollected = getAllLeafTags(node).filter(t => !t.is_collected)
                    if (uncollected.length === 0) return
                    const scId = defaultScanClass?.id || null
                    setBranchDialog({ node, uncollectedTags: uncollected, scanClassId: scId })
                    setBranchScanClass(scId ? String(scId) : '')
                  }} className="text-green-400 hover:text-green-300 p-1" title="Add branch to collection">
                    <Plus size={12} />
                  </button>
                )}
              </td>
            </>
          )}
        </tr>
        {isExpanded && (node.children || []).map(child => renderTreeRow(child, depth + 1))}
      </React.Fragment>
    )
  }

  // ── Flat table rendering (preserved from original) ──

  const FlatResizeTh = ({ index, children, className = '' }) => (
    <th className={`table-th relative ${className}`} style={{ width: flatColWidths[index], minWidth: 40 }}>
      {children}
      <div
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/40 z-20"
        onMouseDown={(e) => onFlatColResize(index, e)}
      />
    </th>
  )

  const renderFlatTagRow = (tag, idx) => {
    const key = tKey(tag)
    const isBranchCollected = tag.collected_via_include
    return (
      <tr key={`${key}:${idx}`} className={`hover:bg-gray-800/50 ${selected.has(key) ? 'bg-blue-900/20' : ''}`}>
        <td className="table-td" style={{ width: flatColWidths[0] }}>
          {isBranchCollected ? (
            <CheckSquare size={14} className="text-gray-600 cursor-not-allowed" title="Managed by branch subscription" />
          ) : (
            <button onClick={() => toggleSelect(key)}>
              {selected.has(key)
                ? <CheckSquare size={14} className="text-blue-400" />
                : <Square size={14} className="text-gray-500" />}
            </button>
          )}
        </td>
        <td className="table-td text-center" style={{ width: flatColWidths[1] }}>
          {isBranchCollected ? (
            <span className="badge badge-purple">Branch</span>
          ) : tag.is_collected ? (
            <span className="badge badge-green">Collected</span>
          ) : (
            <span className="badge badge-gray">Available</span>
          )}
        </td>
        {groupBy !== 'device' && (
          <td className="table-td text-xs text-gray-400 truncate" style={{ width: flatColWidths[2] }}>{tag.device_name}</td>
        )}
        <td className="table-td font-medium text-gray-200 truncate" style={{ width: flatColWidths[3] }} title={tag.display_name}>{tag.display_name}</td>
        <td className="table-td text-xs text-gray-400 font-mono truncate" style={{ width: flatColWidths[4] }} title={tag.path}>{tag.path || `ns=${tag.namespace};${tag.identifier_type}=${tag.identifier}`}</td>
        <td className="table-td font-mono text-xs truncate" style={{ width: flatColWidths[5] }} title={liveValues[tag.node_id]?.status}>
          {liveEnabled ? formatLiveValue(liveValues[tag.node_id]) : <span className="text-gray-600">{'\u2014'}</span>}
        </td>
        {groupBy !== 'namespace' && (
          <td className="table-td text-center" style={{ width: flatColWidths[6] }}><span className="badge badge-gray">{tag.namespace}</span></td>
        )}
        {groupBy !== 'data_type' && (
          <td className="table-td text-xs text-gray-400 truncate" style={{ width: flatColWidths[7] }} title={tag.data_type}>{tag.data_type || '\u2014'}</td>
        )}
        {isBranchCollected ? (
          <>
            <td className="table-td text-gray-600 text-xs italic" style={{ width: flatColWidths[8] }}>inherited</td>
            <td className="table-td text-gray-600 text-xs italic" style={{ width: flatColWidths[9] }}>inherited</td>
            <td className="table-td text-center" style={{ width: flatColWidths[10] }}>
              <input type="checkbox" checked disabled
                className="rounded border-gray-700 bg-gray-800 text-gray-600 cursor-not-allowed" />
            </td>
            <td className="table-td text-right" style={{ width: flatColWidths[11] }}></td>
          </>
        ) : tag.is_collected ? (
          <>
            <td className="table-td" style={{ width: flatColWidths[8] }}>
              <input className="input py-0.5 text-xs w-full"
                defaultValue={tag.measurement_name}
                onBlur={e => { if (e.target.value !== tag.measurement_name) handlePatch(tag, 'measurement_name', e.target.value) }}
                placeholder={tag.display_name} />
            </td>
            <td className="table-td" style={{ width: flatColWidths[9] }}>
              <select className="input py-0.5 text-xs w-full"
                value={tag.scan_class_id || ''}
                onChange={e => handlePatch(tag, 'scan_class_id', e.target.value ? Number(e.target.value) : null)}>
                <option value="">None</option>
                {scanClasses.map(sc => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
              </select>
            </td>
            <td className="table-td text-center" style={{ width: flatColWidths[10] }}>
              <input type="checkbox" checked={tag.enabled}
                onChange={e => handlePatch(tag, 'enabled', e.target.checked)}
                className="rounded border-gray-600 bg-gray-800 text-blue-500" />
            </td>
            <td className="table-td text-right" style={{ width: flatColWidths[11] }}>
              <button onClick={() => handleRemoveFromCollection(tag)} className="text-red-400 hover:text-red-300 p-1" title="Remove from collection">
                <Trash2 size={12} />
              </button>
            </td>
          </>
        ) : (
          <>
            <td className="table-td text-gray-600 text-xs" style={{ width: flatColWidths[8] }}>{'\u2014'}</td>
            <td className="table-td text-gray-600 text-xs" style={{ width: flatColWidths[9] }}>{'\u2014'}</td>
            <td className="table-td text-center text-gray-600" style={{ width: flatColWidths[10] }}>{'\u2014'}</td>
            <td className="table-td text-right" style={{ width: flatColWidths[11] }}>
              <button onClick={() => handleAddToCollection([tag], defaultScanClass?.id || null)} className="text-green-400 hover:text-green-300 p-1" title="Add to collection">
                <Plus size={12} />
              </button>
            </td>
          </>
        )}
      </tr>
    )
  }

  const flatTableHeaders = (
    <tr>
      <FlatResizeTh index={0}>
        <button onClick={toggleAll}>
          {selected.size === filtered.length && filtered.length > 0
            ? <CheckSquare size={14} className="text-blue-400" />
            : <Square size={14} className="text-gray-500" />}
        </button>
      </FlatResizeTh>
      <FlatResizeTh index={1} className="cursor-pointer text-center">
        <span className="flex items-center justify-center gap-1" onClick={() => toggleSort('is_collected')}>Status <SortIcon k="is_collected" /></span>
      </FlatResizeTh>
      {groupBy !== 'device' && (
        <FlatResizeTh index={2} className="cursor-pointer">
          <span className="flex items-center gap-1" onClick={() => toggleSort('device_name')}>Device <SortIcon k="device_name" /></span>
        </FlatResizeTh>
      )}
      <FlatResizeTh index={3} className="cursor-pointer">
        <span className="flex items-center gap-1" onClick={() => toggleSort('display_name')}>Tag Name <SortIcon k="display_name" /></span>
      </FlatResizeTh>
      <FlatResizeTh index={4} className="cursor-pointer">
        <span className="flex items-center gap-1" onClick={() => toggleSort('path')}>Path <SortIcon k="path" /></span>
      </FlatResizeTh>
      <FlatResizeTh index={5}>Value</FlatResizeTh>
      {groupBy !== 'namespace' && (
        <FlatResizeTh index={6} className="cursor-pointer text-center">
          <span className="flex items-center justify-center gap-1" onClick={() => toggleSort('namespace')}>NS <SortIcon k="namespace" /></span>
        </FlatResizeTh>
      )}
      {groupBy !== 'data_type' && (
        <FlatResizeTh index={7} className="cursor-pointer">
          <span className="flex items-center gap-1" onClick={() => toggleSort('data_type')}>Type <SortIcon k="data_type" /></span>
        </FlatResizeTh>
      )}
      <FlatResizeTh index={8}>Measurement</FlatResizeTh>
      <FlatResizeTh index={9} className="cursor-pointer">
        <span className="flex items-center gap-1" onClick={() => toggleSort('scan_class_name')}>Scan Class <SortIcon k="scan_class_name" /></span>
      </FlatResizeTh>
      <FlatResizeTh index={10} className="text-center cursor-pointer">
        <span className="flex items-center justify-center gap-1" onClick={() => toggleSort('enabled')}>Enabled <SortIcon k="enabled" /></span>
      </FlatResizeTh>
      <th className="table-th" style={{ width: flatColWidths[11], minWidth: 40 }}></th>
    </tr>
  )

  const treeTableHeaders = (
    <tr>
      <TreeResizeTh index={0}>
        <button onClick={toggleAll}>
          {selected.size === filtered.length && filtered.length > 0
            ? <CheckSquare size={14} className="text-blue-400" />
            : <Square size={14} className="text-gray-500" />}
        </button>
      </TreeResizeTh>
      <TreeResizeTh index={1}>Name</TreeResizeTh>
      <TreeResizeTh index={2}>Value</TreeResizeTh>
      <TreeResizeTh index={3}>Status</TreeResizeTh>
      <TreeResizeTh index={4} className="text-center">NS</TreeResizeTh>
      <TreeResizeTh index={5}>Type</TreeResizeTh>
      <TreeResizeTh index={6}>Measurement</TreeResizeTh>
      <TreeResizeTh index={7}>Scan Class</TreeResizeTh>
      <TreeResizeTh index={8} className="text-center">Enabled</TreeResizeTh>
      <th className="table-th" style={{ width: treeColWidths[9], minWidth: 40 }}></th>
    </tr>
  )

  const isTreeView = groupBy === 'tree'

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Tag Management</h1>
          <p className="text-sm text-gray-400 mt-1">
            {totalAvailable} discovered across {devicesWithTags} device{devicesWithTags !== 1 ? 's' : ''} · {collectedCount} collected · {enabledCount} enabled
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLiveEnabled(v => !v)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              liveEnabled
                ? 'bg-green-900/40 text-green-400 border border-green-700'
                : 'btn-secondary'
            }`}
          >
            <Activity size={16} className={liveEnabled ? 'animate-pulse' : ''} />
            {liveEnabled ? 'Live (5s)' : 'Live Values'}
          </button>
          <button
            onClick={refreshAllScans}
            disabled={scanning || loading}
            className="btn-secondary flex items-center gap-2"
          >
            <RefreshCw size={16} className={scanning ? 'animate-spin' : ''} />
            {scanning ? 'Scanning...' : 'Refresh Tags'}
          </button>
        </div>
      </div>

      {/* View mode tabs */}
      <div className="border-b border-gray-700">
        <nav className="flex gap-0 -mb-px">
          {[
            { id: 'all', label: `All Tags (${totalAvailable})` },
            { id: 'collected', label: `Collected (${collectedCount})` },
            { id: 'available', label: `Available (${totalAvailable - collectedCount})` },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => { setViewMode(tab.id); setSelected(new Set()) }}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                viewMode === tab.id
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Filter toolbar */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input className="input pl-8 py-1.5 text-sm" value={search}
              onChange={e => setSearch(e.target.value)} placeholder="Search tags..." />
          </div>
          <div className="relative flex-1 min-w-48">
            <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input className="input pl-8 py-1.5 text-sm font-mono" value={wildcardPattern}
              onChange={e => setWildcardPattern(e.target.value)} placeholder="Wildcard: Channel1.*.Temperature" />
          </div>
          {wildcardPattern && (
            <button onClick={selectByPattern} className="btn-secondary py-1.5 text-xs">
              Select Matching
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <select className="input py-1.5 text-sm w-40" value={filterDevice} onChange={e => setFilterDevice(e.target.value)}>
            <option value="">All Devices</option>
            {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className="input py-1.5 text-sm w-36" value={filterScanClass} onChange={e => setFilterScanClass(e.target.value)}>
            <option value="">All Scan Classes</option>
            <option value="__none__">No Scan Class</option>
            {scanClasses.map(sc => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
          </select>
          <select className="input py-1.5 text-sm w-36" value={filterDataType} onChange={e => setFilterDataType(e.target.value)}>
            <option value="">All Data Types</option>
            {dataTypes.map(dt => <option key={dt} value={dt}>{dt}</option>)}
          </select>
          <select className="input py-1.5 text-sm w-28" value={filterNs} onChange={e => setFilterNs(e.target.value)}>
            <option value="">All NS</option>
            {namespaces.map(ns => <option key={ns} value={ns}>NS {ns}</option>)}
          </select>
          {viewMode !== 'available' && (
            <select className="input py-1.5 text-sm w-28" value={filterEnabled} onChange={e => setFilterEnabled(e.target.value)}>
              <option value="">All States</option>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          )}
          <div className="border-l border-gray-700 h-6 mx-1" />
          <select className="input py-1.5 text-sm w-36" value={groupBy} onChange={e => { setGroupBy(e.target.value); setCollapsedGroups(new Set()); setSelected(new Set()) }}>
            <option value="tree">Tree View</option>
            <option value="flat">Flat Table</option>
            <option value="device">Group by Device</option>
            <option value="scan_class">Group by Scan Class</option>
            <option value="namespace">Group by Namespace</option>
            <option value="data_type">Group by Data Type</option>
            <option value="status">Group by Status</option>
          </select>
          {isTreeView && (
            <>
              <button onClick={expandAll} className="btn-ghost py-1 px-2 text-xs flex items-center gap-1" title="Expand all">
                <ChevronsUpDown size={14} />
              </button>
              <button onClick={collapseAll} className="btn-ghost py-1 px-2 text-xs flex items-center gap-1" title="Collapse all">
                <ChevronsDownUp size={14} />
              </button>
            </>
          )}
          <span className="text-sm text-gray-500 ml-auto">{filtered.length} / {totalAvailable}</span>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 p-3 bg-blue-900/30 rounded-lg border border-blue-800">
          <span className="text-sm font-medium text-blue-400">{selected.size} selected</span>

          {selectedUncollected > 0 && (
            <>
              <div className="border-l border-blue-700 h-5" />
              <select className="input py-1 text-sm w-44" value={bulkScanClass} onChange={e => setBulkScanClass(e.target.value)}>
                <option value="">{defaultScanClass ? `Default: ${defaultScanClass.name}` : 'Scan Class...'}</option>
                {scanClasses.map(sc => <option key={sc.id} value={sc.id}>{sc.name}{sc.is_default ? ' (default)' : ''}</option>)}
              </select>
              <button onClick={handleBulkAddToCollection} className="btn-success py-1 text-xs">
                <Plus size={12} /> Collect {selectedUncollected} Tag{selectedUncollected !== 1 ? 's' : ''}
              </button>
            </>
          )}

          {selectedCollected > 0 && (
            <>
              <div className="border-l border-blue-700 h-5" />
              {selectedUncollected === 0 && (
                <>
                  <select className="input py-1 text-sm w-36" value={bulkScanClass} onChange={e => setBulkScanClass(e.target.value)}>
                    <option value="">Set Scan Class...</option>
                    <option value="__none__">None</option>
                    {scanClasses.map(sc => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
                  </select>
                  <button onClick={handleBulkScanClass} disabled={!bulkScanClass} className="btn-primary py-1 text-xs">Apply</button>
                  <div className="border-l border-blue-700 h-5" />
                </>
              )}
              <button onClick={() => handleBulkEnable(true)} className="btn-secondary py-1 text-xs">
                <Power size={12} /> Enable
              </button>
              <button onClick={() => handleBulkEnable(false)} className="btn-secondary py-1 text-xs">
                <PowerOff size={12} /> Disable
              </button>
              <div className="border-l border-blue-700 h-5" />
              <button onClick={handleBulkRemove} className="btn-danger py-1 text-xs">
                <Trash2 size={12} /> Remove {selectedCollected}
              </button>
            </>
          )}
        </div>
      )}

      {/* Table */}
      {mergedTags.length === 0 ? (
        <div className="card p-12 text-center text-gray-500">
          <Tag className="mx-auto mb-3 text-gray-600" size={40} />
          <p className="font-medium text-gray-300">No tags discovered</p>
          <p className="text-sm mt-1">Scan devices from the OPC UA Devices page to discover available tags</p>
        </div>
      ) : isTreeView ? (
        /* ── Tree View ── */
        <div className="card overflow-hidden">
          <div className="overflow-x-auto max-h-[75vh] overflow-y-auto">
            <table className="w-full text-sm table-fixed" key={`tree-${viewMode}`}>
              <thead className="bg-gray-800/50 border-b border-gray-700 sticky top-0 z-10">
                {treeTableHeaders}
              </thead>
              <tbody className="divide-y divide-gray-800">
                {tree.length > 0 ? (
                  tree.map(deviceNode => renderTreeRow(deviceNode, 0))
                ) : (
                  <tr><td colSpan={99} className="table-td text-center text-gray-500 py-8">No tags match the filters</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ── Flat / Grouped View ── */
        <div className="card overflow-hidden">
          <div className="overflow-x-auto max-h-[75vh] overflow-y-auto">
            <table className="w-full text-sm table-fixed" key={`${viewMode}-${groupBy}`}>
              <thead className="bg-gray-800/50 border-b border-gray-700 sticky top-0 z-10">
                {flatTableHeaders}
              </thead>
              {groups ? (
                groups.map(([groupName, groupTags]) => {
                  const isCollapsed = collapsedGroups.has(groupName)
                  const groupCollected = groupTags.filter(t => t.is_collected).length
                  return (
                    <tbody key={groupName} className="divide-y divide-gray-800">
                      <tr className="bg-gray-800/70 cursor-pointer hover:bg-gray-800" onClick={() => toggleGroup(groupName)}>
                        <td colSpan={99} className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            {isCollapsed ? <ChevronRight size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                            <span className="font-medium text-gray-200">{groupName}</span>
                            <span className="badge badge-gray">{groupTags.length} tags</span>
                            <span className="badge badge-green">{groupCollected} collected</span>
                          </div>
                        </td>
                      </tr>
                      {!isCollapsed && groupTags.map((tag, idx) => renderFlatTagRow(tag, idx))}
                    </tbody>
                  )
                })
              ) : (
                <tbody className="divide-y divide-gray-800">
                  {filtered.map((tag, idx) => renderFlatTagRow(tag, idx))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={99} className="table-td text-center text-gray-500 py-8">No tags match the filters</td></tr>
                  )}
                </tbody>
              )}
            </table>
          </div>
        </div>
      )}

      {/* Branch subscription dialog */}
      <Modal
        open={!!branchDialog}
        onClose={() => setBranchDialog(null)}
        title="Add Branch to Collection"
        size="md"
      >
        {branchDialog && (
          <div className="space-y-4">
            <p className="text-sm text-gray-300">
              You selected the branch{' '}
              <span className="font-mono font-medium text-gray-100">
                {branchDialog.node.path || branchDialog.node.label}
              </span>{' '}
              which contains{' '}
              <span className="font-semibold">{branchDialog.uncollectedTags.length}</span>{' '}
              uncollected tag{branchDialog.uncollectedTags.length !== 1 ? 's' : ''}.
            </p>

            <div>
              <label className="text-xs text-gray-400 mb-1 block">Scan Class</label>
              <select className="input py-1.5 text-sm w-full" value={branchScanClass} onChange={e => setBranchScanClass(e.target.value)}>
                <option value="">{defaultScanClass ? `Default: ${defaultScanClass.name}` : 'None'}</option>
                {scanClasses.map(sc => <option key={sc.id} value={sc.id}>{sc.name}{sc.is_default ? ' (default)' : ''}</option>)}
              </select>
            </div>

            <p className="text-sm text-gray-400">
              Choose how to add these tags:
            </p>

            <div className="space-y-3">
              <button
                onClick={async () => {
                  const scId = branchScanClass ? Number(branchScanClass) : (branchDialog.scanClassId || null)
                  await handleAddToCollection(branchDialog.uncollectedTags, scId)
                  setSelected(new Set())
                  setBranchDialog(null)
                }}
                className="w-full text-left p-4 rounded-lg border border-gray-700 hover:border-blue-500 hover:bg-blue-900/10 transition-colors"
              >
                <div className="font-medium text-gray-200">Expand to individual tags</div>
                <p className="text-xs text-gray-400 mt-1">
                  Each tag is saved individually. You can configure measurement name, scan class, and enabled status per tag.
                  Best for fine-grained control.
                </p>
              </button>

              <button
                onClick={async () => {
                  const scId = branchScanClass ? Number(branchScanClass) : (branchDialog.scanClassId || null)
                  await handleAddBranchSubscription(branchDialog.node, scId)
                  setSelected(new Set())
                  setBranchDialog(null)
                }}
                className="w-full text-left p-4 rounded-lg border border-gray-700 hover:border-green-500 hover:bg-green-900/10 transition-colors"
              >
                <div className="font-medium text-gray-200">Subscribe as branch</div>
                <p className="text-xs text-gray-400 mt-1">
                  Saves a single branch subscription. All tags under this path are included automatically when
                  generating the Telegraf config. New tags added to the server under this path will be picked up
                  on the next scan.
                </p>
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
