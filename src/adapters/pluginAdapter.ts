import { Plugin, pluginKey, type Entity, type PluginScope } from '@/ontology'
import { installedPluginsPath, settingsPath, type Location } from './paths'
import { fs, join, readJsonOrNull } from './fs'

interface InstalledPluginEntry {
  scope?: PluginScope
  installPath?: string | null
  version?: string
  installedAt?: string
  lastUpdated?: string
  [k: string]: unknown
}

interface InstalledPluginsFile {
  version?: number
  plugins?: Record<string, InstalledPluginEntry[]>
}

interface SettingsShape {
  enabledPlugins?: Record<string, boolean>
  [k: string]: unknown
}

interface ManifestShape {
  description?: string
  author?: { name?: string; email?: string; url?: string } | string
  repository?: string
  homepage?: string
  keywords?: string[]
  license?: string
}

const scopeKey = (loc: Location) =>
  loc.scope.type === 'user' ? 'user' : loc.scope.projectId

const readManifest = async (installPath: string | null | undefined): Promise<ManifestShape | null> => {
  if (!installPath) return null
  const manifestPath = join(installPath, '.claude-plugin', 'plugin.json')
  return readJsonOrNull<ManifestShape>(manifestPath)
}

const normalizeAuthor = (raw: ManifestShape['author']): Plugin['author'] => {
  if (!raw) return undefined
  if (typeof raw === 'string') return { name: raw }
  return { name: raw.name, email: raw.email, url: raw.url }
}

export const readPlugins = async (loc: Location, home: string): Promise<Entity<Plugin>[]> => {
  if (loc.scope.type !== 'user') return []

  const registryPath = installedPluginsPath(home)
  const [registry, settings] = await Promise.all([
    readJsonOrNull<InstalledPluginsFile>(registryPath),
    readJsonOrNull<SettingsShape>(settingsPath(loc)),
  ])

  if (!registry?.plugins) return []
  const enabledMap = settings?.enabledPlugins ?? {}

  const entities: Entity<Plugin>[] = []

  for (const [pluginId, installs] of Object.entries(registry.plugins)) {
    if (!Array.isArray(installs)) continue
    const at = pluginId.lastIndexOf('@')
    if (at <= 0 || at === pluginId.length - 1) continue
    const name = pluginId.slice(0, at)
    const marketplace = pluginId.slice(at + 1)

    for (const install of installs) {
      const manifest = await readManifest(install.installPath)
      const value = Plugin.parse({
        name,
        marketplace,
        version: install.version ?? '',
        scope: install.scope ?? 'user',
        installPath: install.installPath ?? '',
        installedAt: install.installedAt,
        lastUpdated: install.lastUpdated,
        enabled: enabledMap[pluginId] === true,
        description: manifest?.description,
        author: normalizeAuthor(manifest?.author),
        repository: manifest?.repository,
        homepage: manifest?.homepage,
        keywords: manifest?.keywords ?? [],
        license: manifest?.license,
        manifestFound: manifest !== null,
      })
      entities.push({
        id: `plugin:${scopeKey(loc)}:${pluginId}:${value.version}`,
        kind: 'plugin',
        scope: loc.scope,
        path: registryPath,
        value,
        origin: value,
        raw: JSON.stringify(install),
      })
    }
  }

  return entities
}

const toRegistryEntry = (p: Plugin): InstalledPluginEntry => {
  const now = new Date().toISOString()
  return {
    scope: p.scope,
    installPath: p.installPath || null,
    version: p.version,
    installedAt: p.installedAt ?? now,
    lastUpdated: now,
  }
}

const removeInstall = (
  registry: InstalledPluginsFile,
  pluginId: string,
  version: string,
  scope: PluginScope,
): void => {
  const list = registry.plugins?.[pluginId]
  if (!list) return
  const next = list.filter(
    (e) => !(e.version === version && (e.scope ?? 'user') === scope),
  )
  if (next.length === 0) delete registry.plugins![pluginId]
  else registry.plugins![pluginId] = next
}

export const writePlugin = async (
  loc: Location,
  home: string,
  original: Entity<Plugin> | null,
  next: Plugin,
): Promise<void> => {
  if (loc.scope.type !== 'user') {
    throw new Error('Plugins are currently managed only at user scope')
  }

  const registryPath = installedPluginsPath(home)
  const settings: SettingsShape = (await readJsonOrNull<SettingsShape>(settingsPath(loc))) ?? {}
  const registry: InstalledPluginsFile = (await readJsonOrNull<InstalledPluginsFile>(registryPath)) ?? {
    version: 2,
    plugins: {},
  }
  registry.plugins ??= {}

  const nextId = pluginKey(next)

  // Remove the original entry (handles rename, version change, scope change).
  if (original) {
    const originId = pluginKey(original.origin)
    removeInstall(registry, originId, original.origin.version, original.origin.scope)
    // If the plugin was renamed, also drop its enabled flag under the old key
    // unless another install of the old key still exists.
    if (originId !== nextId && !registry.plugins[originId]?.length) {
      if (settings.enabledPlugins && originId in settings.enabledPlugins) {
        delete settings.enabledPlugins[originId]
      }
    }
  }

  registry.plugins[nextId] ??= []
  // Replace any existing entry for the same (version, scope) tuple, then append.
  registry.plugins[nextId] = registry.plugins[nextId].filter(
    (e) => !(e.version === next.version && (e.scope ?? 'user') === next.scope),
  )
  registry.plugins[nextId].push(toRegistryEntry(next))

  settings.enabledPlugins ??= {}
  settings.enabledPlugins[nextId] = next.enabled

  await fs.writeJson(registryPath, registry)
  await fs.writeJson(settingsPath(loc), settings)
}

export const deletePlugin = async (
  loc: Location,
  home: string,
  entity: Entity<Plugin>,
): Promise<void> => {
  if (loc.scope.type !== 'user') return

  const registryPath = installedPluginsPath(home)
  const registry = (await readJsonOrNull<InstalledPluginsFile>(registryPath)) ?? {
    version: 2,
    plugins: {},
  }
  const settings = ((await readJsonOrNull<SettingsShape>(settingsPath(loc))) ?? {}) as SettingsShape

  const id = pluginKey(entity.origin)
  removeInstall(registry, id, entity.origin.version, entity.origin.scope)

  if (!registry.plugins?.[id]?.length && settings.enabledPlugins) {
    delete settings.enabledPlugins[id]
  }

  await fs.writeJson(registryPath, registry)
  await fs.writeJson(settingsPath(loc), settings)
}
