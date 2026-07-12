import type { Component } from 'vue'

export type PluginCapability = 'file-import' | 'local-storage' | 'audio-playback'

export interface NotebookPluginManifest {
  id: string
  name: string
  version: string
  description: string
  capabilities: PluginCapability[]
  component: Component
}

export interface NotebookPluginInstallation {
  notebookId: string
  pluginId: string
  version: string
  enabled: boolean
  installedAt: number
  settings: Record<string, unknown>
}
