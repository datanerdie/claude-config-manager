import { z } from 'zod'

export const Settings = z.object({
  anthropic: z
    .object({
      apiKey: z.string().default(''),
    })
    .default({ apiKey: '' }),
  markdownDefaultMode: z.enum(['edit', 'read']).default('edit'),
})
export type Settings = z.infer<typeof Settings>

export const defaultSettings = (): Settings => Settings.parse({})
