import { z } from 'zod'

export const Settings = z.object({
  anthropic: z
    .object({
      apiKey: z.string().default(''),
    })
    .default({ apiKey: '' }),
  markdownDefaultMode: z.enum(['edit', 'read']).default('edit'),
  checkUpdatesOnStartup: z.boolean().default(true),
  /** Plugin ids (`<name>@<marketplace>`) the user has flagged for an upcoming update. */
  markedPlugins: z.array(z.string()).default([]),
})
export type Settings = z.infer<typeof Settings>

export const defaultSettings = (): Settings => Settings.parse({})
