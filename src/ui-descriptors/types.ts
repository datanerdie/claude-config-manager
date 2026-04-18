import type { ReactNode } from 'react'
import type { Entity, Kind, Project, Scope } from '@/ontology'
import type { ContextMenuItem } from '@/ui-primitives'

export interface EditorContext {
  knownAgents: string[]
  knownCommands: string[]
}

export interface ActionContext {
  scope: Scope
  projects: Project[]
  home: string
  createIn: (kind: Kind, value: any, scope: Scope) => Promise<void>
  remove: (entity: Entity<any>) => Promise<void>
}

export interface UiDescriptor<T> {
  kind: Kind
  newDefault: (name: string) => T
  newLabel: string
  newPromptLabel: string
  listLabel: (v: T) => ReactNode
  listSublabel?: (v: T) => ReactNode
  /** Overrides the default subtitle (entity.path) shown in the inspector header. */
  headerSubtitle?: (v: T) => ReactNode
  Editor: React.ComponentType<{
    value: T
    onChange: (next: T) => void
    ctx: EditorContext
  }>
  customActions?: (entity: Entity<T>, ctx: ActionContext) => ContextMenuItem[]
}
