// The world beneath the plugin in every test: a main checkout at /repo with
// an origin, git answered from a script, and the engine's own nouns.
import type { On, PromptComposeInput, RenderPropsOf } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

export const REPO = '/repo'

export type World = {
  clock: MockClock
  toolCalls: string[]
  fetched: string[]
  dialogs: number
  closeDialog: () => void
  panes: string[]
  // Every command fishStack ran, as `cwd$ argv`.
  commands: string[]
  // How each of them was run (its timeout and environment), by `cwd$ argv`.
  inits: Record<string, { timeoutMs?: number; env?: Record<string, string> } | undefined>
  // Answers the question the agent is waiting on, as the person would.
  answer: (answers: Record<string, string>) => void
  // Every question asked through AskUserQuestion, by text.
  asked: string[]
  // The same questions whole: their headers and options.
  askedWith: unknown[]
  // Notifications sent, by text.
  notified: string[]
  // Lines shown under an open dialog, by text (undefined removes one).
  notices: (string | undefined)[]
  // What the plugin last saved under each store key.
  saved: Record<string, unknown>
  // Files the plugin wrote, by path, in order.
  written: string[]
  // What the store holds now: a test writes here as another session would.
  kept: Record<string, unknown>
  // Every prompt submitted, fishStack's own among them, by text.
  prompts: string[]
}

function ran(stdout = '', exitCode = 0, stderr = '') {
  return { value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } }
}

// `store` is what the plugin's store holds at the start; `files`, text files
// on disk by path, which fs.exists, fs.list and fs.read answer from.
export function world(
  on: On,
  {
    isRepo = true,
    isDialogSlow = false,
    store = {},
    files,
    folders = [],
    surfaces = ['terminal'],
  }: {
    isRepo?: boolean
    isDialogSlow?: boolean
    store?: Record<string, unknown>
    files?: Record<string, string>
    // Folders already on disk, by path.
    folders?: string[]
    // The surfaces the session reports; none while it is headless.
    surfaces?: string[]
  } = {},
): World {
  const clock = mock.clock(on, { now: 1_000_000 })
  // The store, as mock.store keeps one, with what is saved readable here.
  const kept: Record<string, unknown> = { ...store }
  on('store.get', ($, e) => ({ value: kept[e.key] }))
  on('store.set', ($, e) => {
    kept[e.key] = e.value
    state.saved[e.key] = e.value
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    delete kept[e.key]
    delete state.saved[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(kept) }))
  mock.env(on, { HOME: '/home/me' })
  const toolCalls: string[] = []
  const fetched: string[] = []
  const panes: string[] = []
  const commands: string[] = []
  const state: World = { clock, toolCalls, fetched, dialogs: 0, closeDialog: () => undefined, panes, commands, inits: {}, answer: () => undefined, asked: [], askedWith: [], notified: [], notices: [], saved: {}, written: [], kept, prompts: [] }

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('prompt.submit', ($, e) => {
    state.prompts.push(e.text)
    return { text: e.text, context: e.context }
  })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }] }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__fishstack__${e.name}` } }))
  on('session.repo', () => ({
    value: isRepo ? { root: REPO, remote: 'git@example.com:me/repo.git', internal: false, name: null } : null,
  }))
  on('session.root', () => ({ value: REPO }))
  on('session.cwd', () => ({ value: REPO }))
  on('session.id', () => ({ value: 'abcdef123456' }))
  // A session a few turns in: the fields fishStack reads, the rest left out.
  const breakdown = {
    totalTokens: 68_000,
    rawMaxTokens: 200_000,
    percentage: 34,
    categories: [{ name: 'Messages', tokens: 41_000, kind: 'used' }],
    apiUsage: { input_tokens: 1_200, output_tokens: 800, cache_read_input_tokens: 52_000, cache_creation_input_tokens: 3_000 },
  }
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, tokens: 68_000, percent: 34, breakdown: breakdown as never }, rateLimits: [], cost: { usd: 0.42 } as never },
  }))
  on('ui.open', ($, e) => {
    if (!panes.includes(e.id)) panes.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: panes.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/'))
  on('fs.exists', ($, e) => ({ value: files !== undefined && Object.keys(files).some(path => path === e.path || path.startsWith(`${e.path}/`)) }))
  if (files !== undefined) {
    on('fs.list', ($, e) => ({
      value: Object.keys(files)
        .filter(path => dirOf(path) === e.path)
        .map(path => ({ name: path.slice(e.path.length + 1), kind: 'file' as const, size: files[path]!.length, mtimeMs: 0, isLink: false })),
    }))
    on('fs.read', ($, e) => ({ value: files[e.path] ?? '' }))
  }
  on('fs.write', ($, e) => {
    state.written.push(e.path)
    if (files !== undefined) files[e.path] = e.text
    return { value: undefined }
  })
  on('fs.stat', ($, e) => ({ value: { kind: /\.\w+$/.test(e.path) ? 'file' : 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('http.fetch', ($, e) => {
    fetched.push(e.url)
    return { value: { status: 200, ok: true, headers: { 'content-type': 'application/json' }, text: '[{"id":1}]' } }
  })
  // The folders on disk, as far as fishStack touches them.
  const dirs = new Set<string>([REPO])
  const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/'))
  const makeDir = (path: string) => {
    for (let at = path; at.length > 1; at = parentOf(at)) dirs.add(at)
  }
  for (const path of folders) makeDir(path)
  on('process.run', ($, e) => {
    const argv = e.argv
    const command = argv.join(' ')
    const cwd = e.init?.cwd ?? REPO
    commands.push(`${cwd}$ ${command}`)
    state.inits[`${cwd}$ ${command}`] = e.init
    // The macOS file dialog: what picked files come back as.
    if (argv[0] === 'osascript') {
      const picked = ran(command.includes('choose folder') ? `${REPO}/docs/\n` : `${REPO}/docs/api.md\n/Users/me/notes/style.md\n`)
      state.dialogs += 1
      // A slow dialog stays open until the test closes it.
      return isDialogSlow ? new Promise<typeof picked>(resolve => (state.closeDialog = () => resolve(picked))) : picked
    }
    if (argv[0] === 'mkdir') {
      const path = argv[argv.length - 1]!
      if (argv[1] !== '-p' && dirs.has(path)) return ran('', 1)
      makeDir(path)
      return ran()
    }
    if (argv[0] === 'rm') {
      const path = argv[argv.length - 1]!
      for (const one of [...dirs]) if (one === path || one.startsWith(`${path}/`)) dirs.delete(one)
      return ran()
    }
    if (argv[0] !== 'git') return ran('', 1)
    // Git, its -c settings set aside.
    const args = argv.slice(1).filter((one, index, all) => one !== '-c' && all[index - 1] !== '-c')
    const sub = args.join(' ')
    // The main checkout's git data, which settings.repoMain asks for.
    if (sub === 'rev-parse --path-format=absolute --git-common-dir') return ran(`${REPO}/.git\n`)
    return ran('', 1)
  })
  on('tool.call', ($, e) => {
    toolCalls.push(String(e.tool))
    // A question waits for the person, as the dialog does, until the test
    // answers it with state.answer.
    if (String(e.tool) === 'AskUserQuestion') {
      const asked = (e as unknown as { questions: { question: string }[] }).questions
      state.asked.push(...asked.map(one => one.question))
      state.askedWith.push(...asked)
      return new Promise(resolve => (state.answer = answers => resolve({ result: { questions: asked, answers } as never })))
    }
    return { result: 'ok' }
  })
  on('session.surfaces', () => ({ value: surfaces }))
  on('ui.notice', ($, e) => {
    state.notices.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', ($, e) => {
    state.notified.push(String(e.text))
    return { value: { isSent: true } as never }
  })
  return state
}

export async function startSession($: Engine): Promise<void> {
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
}

export const PANE_PROPS: RenderPropsOf['Pane'] = {
  title: 'fishStack',
  isFocused: true,
  bodyColumns: 90,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
}


// The band above the prompt: fishStack's rail.
export async function mountBand($: Engine, surface: 'terminal' | 'desktop') {
  return $.ui.mount({
    plugin: 'fishstack',
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
}

export async function mountPane($: Engine, surface: 'terminal' | 'desktop') {
  return $.ui.mount({ plugin: 'fishstack', surface, component: 'Pane', requestId: 'fishstack', props: PANE_PROPS })
}

export const COMPOSE: PromptComposeInput = {
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces: ['terminal'],
  tools: [],
  outputStyle: null,
  traits: [],
}

type Drawing = Awaited<ReturnType<typeof mountPane>>

// Presses a control by key as a person would on its surface: its Button, or
// on the desktop the Client laid over its picture.
// What activate needs of a drawing, on whichever surface it was mounted.
type Pressable = Pick<Drawing, 'find' | 'press' | 'resize' | 'pointer'>

export async function activate(ui: Pressable, key: string): Promise<void> {
  if ((await ui.find({ type: 'Button', key })) !== undefined) {
    await ui.press({ key })
    return
  }
  await ui.resize({ columns: 4, rows: 1, in: key })
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: key })
}

// Opens the pane's card `id` as a person would, pressing its head, unless it
// is open already: a second press on an open card's head closes it.
export async function openCard(ui: Pressable & Pick<Drawing, 'find'>, id: 'dials' | 'context'): Promise<void> {
  if ((await ui.find({ key: `body-${id}` })) !== undefined) return
  await activate(ui, `tab-${id}`)
}

// The keys of the controls, Buttons or drawn, whose key matches.
export async function keysOf(ui: Pick<Drawing, 'findAll'>, pattern: RegExp): Promise<string[]> {
  const found = [...(await ui.findAll({ type: 'Button' })), ...(await ui.findAll({ type: 'Client' }))]
  return found.map(one => one.key).filter((key): key is string => key !== undefined && pattern.test(key))
}
