import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Server, Tag, Clock, Database,
  FileCode, Settings, Link,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { getSystemConfig } from '../services/api'

const mainNavItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/devices', icon: Server, label: 'OPC UA Devices' },
  { to: '/tags', icon: Tag, label: 'Tag Management' },
  { to: '/scan-classes', icon: Clock, label: 'Scan Classes' },
  { to: '/influxdb', icon: Database, label: 'InfluxDB Targets' },
  { to: '/telegraf', icon: FileCode, label: 'Telegraf Config' },
]

const bottomNavItems = [
  { to: '/admin', icon: Settings, label: 'Administration' },
]

function NavItem({ to, icon: Icon, label, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
          isActive
            ? 'bg-blue-600/20 text-blue-400'
            : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
        }`
      }
    >
      <Icon size={16} />
      {label}
    </NavLink>
  )
}

export default function Layout({ children }) {
  const [title, setTitle] = useState('FluxForge')
  const navigate = useNavigate()

  useEffect(() => {
    getSystemConfig()
      .then(cfg => {
        if (!cfg.setup_complete) navigate('/setup')
        else setTitle(cfg.app_title || 'FluxForge')
      })
      .catch(() => {})
  }, [])

  return (
    <div className="flex h-screen bg-gray-950 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="flex items-center gap-2 px-4 py-4 border-b border-gray-800">
          <Link size={22} className="text-blue-400" />
          <span className="text-white font-semibold text-sm leading-tight">{title}</span>
        </div>
        <nav className="flex-1 py-4 space-y-0.5 px-2">
          {mainNavItems.map(item => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>
        <div className="px-2 pb-2 space-y-0.5">
          <div className="border-t border-gray-800 mb-2" />
          {bottomNavItems.map(item => (
            <NavItem key={item.to} {...item} />
          ))}
        </div>
        <div className="px-4 py-3 border-t border-gray-800 text-xs text-gray-600">
          OPC UA → Telegraf → InfluxDB
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
