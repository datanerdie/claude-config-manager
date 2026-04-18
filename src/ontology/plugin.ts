import { z } from 'zod'

export const PluginScope = z.enum(['user', 'project', 'project-local'])
export type PluginScope = z.infer<typeof PluginScope>

export const PluginAuthor = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  url: z.string().optional(),
})
export type PluginAuthor = z.infer<typeof PluginAuthor>

/**
 * A Claude Code plugin install entry.
 *
 * Persisted state comes from two files:
 *   - ~/.claude/plugins/installed_plugins.json (registry: scope, installPath, version, timestamps)
 *   - ~/.claude/settings.json `enabledPlugins` map (enabled flag, keyed by `<name>@<marketplace>`)
 *
 * Manifest-derived fields (description, author, etc.) are read from
 *   `<installPath>/.claude-plugin/plugin.json`
 * at load time and are display-only — edits to them are discarded on write.
 */
export const Plugin = z.object({
  // Identity (persisted in installed_plugins.json key/entry)
  name: z.string().min(1),
  marketplace: z.string().min(1),
  version: z.string().min(1),

  // Install registry fields (persisted)
  scope: PluginScope.default('user'),
  installPath: z.string().default(''),
  installedAt: z.string().optional(),
  lastUpdated: z.string().optional(),

  // Cross-referenced from settings.json `enabledPlugins`
  enabled: z.boolean().default(false),

  // Manifest-derived (display-only, repopulated on every read)
  description: z.string().optional(),
  author: PluginAuthor.optional(),
  repository: z.string().optional(),
  homepage: z.string().optional(),
  keywords: z.array(z.string()).default([]),
  license: z.string().optional(),
  manifestFound: z.boolean().default(false),
})
export type Plugin = z.infer<typeof Plugin>

export const pluginKey = (p: Pick<Plugin, 'name' | 'marketplace'>): string =>
  `${p.name}@${p.marketplace}`

export const emptyPlugin = (name: string): Plugin => ({
  name,
  marketplace: '',
  version: '',
  scope: 'user',
  installPath: '',
  enabled: false,
  keywords: [],
  manifestFound: false,
})
