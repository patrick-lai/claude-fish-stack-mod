export type Tab = 'dials' | 'context'

// Autopilot's answer for a person who is away, as the rail shows it: a
// question waiting until its deadline, then what was picked for it.
export type AutopilotWait =
  | { kind: 'waiting'; since: number; deadline: number; picked: string; count: number }
  | { kind: 'answered'; at: number; picked: string; waitedMs: number }

export type DialKey = 'foresight' | 'crew' | 'tenacity' | 'autonomy' | 'proof' | 'voice'

export type DialValues = Record<DialKey, number>

export type SourceMode = 'off' | 'guidance' | 'strict'

export type SourceKind = 'note' | 'link' | 'file'

export type Source = {
  id: string
  kind: SourceKind
  title: string
  text: string
  url: string | null
  // A file's path, relative to the checkout's top.
  path: string | null
  mode: SourceMode
  folderId: string | null
}

export type Folder = { id: string; name: string }

// Where the Context tab is: which folders are open, which source shows its
// details, which file dialog or confirmation shows.
export type ContextView = {
  openFolders: string[]
  openId: string | null
  // Which file dialog is open, while one is.
  picking: 'file' | 'folder' | null
  deletingFolder: string | null
  isEditingText: boolean
}

export type ContextDraft = { input: string }

declare module 'claude-code' {
  interface PluginState {
    'fishstack': {
      // Which card of the pane is open; null with all of them closed.
      tab: Tab | null
      railTick: number
      // Why fishStack refused each recent tool call, by its tool_use_id.
      refusals: Record<string, string>
      autopilot: AutopilotWait | null
      isTurnRunning: boolean
      isDialsOn: boolean
      isEnforced: boolean
      isContextOn: boolean
      lastReplyAt: number | null
      tokenTotals: { input: number; output: number; cacheRead?: number; cacheWrite?: number } | null
      toldStyle: string | null
      dials: DialValues
      selectedDial: DialKey | null
      isBriefShown: boolean
      sources: Source[]
      folders: Folder[]
      contextView: ContextView
      contextDraft: ContextDraft
      contextStatus: string
      isWindowShown: boolean
      // A Client failed on a surface (ui.fault): drawn controls fall back to
      // Buttons until the next load.
      isClientDown: boolean
    }
  }
}
