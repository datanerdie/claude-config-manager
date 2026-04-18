import { open } from '@tauri-apps/plugin-dialog'

export const pickDirectory = async (): Promise<string | null> => {
  const result = await open({ directory: true, multiple: false })
  if (!result) return null
  return Array.isArray(result) ? (result[0] ?? null) : result
}
