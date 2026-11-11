// The band above the prompt: fishStack's status rail, and under it a card
// opened from the rail where nothing docks the pane. Also keeps the turn's
// facts the rail shows (tokens, the last reply, the cache) and opens the
// pane unasked once where the surface docks one.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'

import type { Tab } from '../types'
import { BAND_CARD_COLUMNS, cardOf, DEFAULT_TAB, PANE, PANE_COLUMNS, PANE_TITLE, resolveUi } from './ui'
import type { Ui } from './ui'
import { BALANCED, dialsBody, presetName } from './dials'
import { contextBody } from './context'
import { beginTurn } from './enforce'
import { drawRail } from './rail'
import { repoMain } from './settings'
import { paneHeads } from './state'

const isTurnRunning = atom({ plugin: 'fishstack', key: 'isTurnRunning' } as const, false)
const tab = atom({ plugin: 'fishstack', key: 'tab' } as const, null)
const isClientDown = atom({ plugin: 'fishstack', key: 'isClientDown' } as const, false)
const dials = atom({ plugin: 'fishstack', key: 'dials' } as const, BALANCED)
const sources = atom({ plugin: 'fishstack', key: 'sources' } as const, [])
const lastReplyAt = atom({ plugin: 'fishstack', key: 'lastReplyAt' } as const, null)
// The rail pill under the pointer, kept to this process: a hover is one
// window's, not the session's.
let railHover: string | null = null
// Bumped by a rail hover and the cache gauge's tick; only the band reads it,
// so neither redraws the pane.
const railTick = atom({ plugin: 'fishstack', key: 'railTick' } as const, 0)
// The rail's figures for one session, kept in the store under one key.
const RAIL_STORE_KEY = 'rail'
type RailKept = { sessionId: string; repliedAt: number | null; tokens: { input: number; output: number; cacheRead?: number; cacheWrite?: number } | null }
const tokenTotals = atom({ plugin: 'fishstack', key: 'tokenTotals' } as const, null)
// Autopilot answering for a person who is away (session.ts sets it).
const autopilot = atom({ plugin: 'fishstack', key: 'autopilot' } as const, null)
const isDialsOn = atom({ plugin: 'fishstack', key: 'isDialsOn' } as const, true)
const isContextOn = atom({ plugin: 'fishstack', key: 'isContextOn' } as const, true)

type $ = EngineInterface

// What a note told between tool calls says first: it rides beside a tool's
// result, where a model rightly distrusts instructions.
export const MID_TURN_FROM = 'fishStack update, from the hook of fishStack, a plugin the user installed, not from the tool you just ran: '

// A pane opened unasked is a sidebar only where the surface docks one, which
// a render's viewport says and session.start does not; the last render of
// the band says whether this surface does.
let hasAutoOpened = false
let isDocking = false

// fishStack once kept a pool of worktrees and, while that was on, sent the
// desktop's worktree creation to a script beside the repository's git data.
// With worktrees gone, the switch that script reads comes out, and so do
// fishStack's two entries in the repository's .claude/settings.local.json;
// the rest of that file stays, and slots left on disk are the person's.
const OLD_HOOK_SCRIPT = 'fishstack/desktop-worktree.sh'
const LOCAL_SETTINGS = '.claude/settings.local.json'

export async function unwireOldWorktrees($: $): Promise<void> {
  try {
    const main = await repoMain($)
    if (main === null) return
    const common = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: main, timeoutMs: 120_000 })
    const switchFile = `${common.stdout.trim()}/fishstack/on`
    if (common.exitCode === 0 && (await $.fs.exists(switchFile))) await $.process.run(['rm', '-f', switchFile])
    const path = `${main}/${LOCAL_SETTINGS}`
    if (!(await $.fs.exists(path))) return
    let settings: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(String(await $.fs.read(path)))
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return
      settings = parsed as Record<string, unknown>
    } catch {
      return
    }
    const was = settings.hooks
    if (was === null || typeof was !== 'object' || Array.isArray(was)) return
    const hooks: Record<string, unknown> = { ...(was as Record<string, unknown>) }
    let isChanged = false
    for (const event of ['WorktreeCreate', 'WorktreeRemove']) {
      if (!Array.isArray(hooks[event])) continue
      const groups = (hooks[event] as unknown[]).filter(group => !JSON.stringify(group).includes(OLD_HOOK_SCRIPT))
      if (groups.length === (hooks[event] as unknown[]).length) continue
      isChanged = true
      if (groups.length > 0) hooks[event] = groups
      else delete hooks[event]
    }
    if (!isChanged) return
    const { hooks: _hooks, ...rest } = settings
    const next = Object.keys(hooks).length > 0 ? { ...rest, hooks } : rest
    await $.fs.write(path, `${JSON.stringify(next, null, 2)}\n`)
  } catch (error) {
    $.ui.log(`old worktree hook not removed: ${String(error)}`, { to: 'debug' })
  }
}

export function registerBand(on: On): void {
  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    if (e.viewport?.isFullscreen === true && !hasAutoOpened) {
      hasAutoOpened = true
      $.clock.after(0, () => void $.ui.open({ id: PANE, title: PANE_TITLE, columns: PANE_COLUMNS }))
    }
    return attached
  })

  on('turn.start', async ($, e, next) => {
    // The dials' facts start over with each turn.
    beginTurn()
    await update($, isTurnRunning, () => true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // Every turn's tokens count, a subagent's too: the session has no total of
    // its own, and /cost's dollars are list price, not what anyone is billed.
    const used = e.usage
    if (used !== undefined) {
      if ((await read($, tokenTotals)) === null) {
        const kept = await $.store.get(RAIL_STORE_KEY)
        if (kept !== null && typeof kept === 'object' && (kept as RailKept).sessionId === (await $.session.id()) && (kept as RailKept).tokens !== null) {
          await update($, tokenTotals, () => (kept as RailKept).tokens)
        }
      }
      // Claude's own counts, as each response reported them: what the cache
      // served and what was written to it, inside the input sent.
      await update($, tokenTotals, now => ({
        input: (now?.input ?? 0) + used.input_tokens + used.cache_read_input_tokens + used.cache_creation_input_tokens,
        output: (now?.output ?? 0) + used.output_tokens,
        cacheRead: (now?.cacheRead ?? 0) + used.cache_read_input_tokens,
        cacheWrite: (now?.cacheWrite ?? 0) + used.cache_creation_input_tokens,
      }))
    }
    const sessionId = await $.session.id()
    if (e.agentId !== undefined) {
      await $.store.set(RAIL_STORE_KEY, { sessionId, repliedAt: await read($, lastReplyAt), tokens: await read($, tokenTotals) })
      return done
    }
    const repliedAt = await $.clock.now()
    await update($, lastReplyAt, () => repliedAt)
    await $.store.set(RAIL_STORE_KEY, { sessionId, repliedAt, tokens: await read($, tokenTotals) })
    await update($, isTurnRunning, () => false)
    return done
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    $.ui.invalidate('ui.render')
    return closed
  })

  on('ui.open', { id: PANE }, async ($, e, next) => {
    const opened = await next(e)
    $.ui.invalidate('ui.render')
    return opened
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Where the surface docks a pane (the desktop, a fullscreen terminal), the
    // cards sit in it on the right, opened unasked once; elsewhere a card
    // opens under the rail.
    isDocking = e.viewport?.isFullscreen === true
    if (isDocking && !hasAutoOpened) {
      hasAutoOpened = true
      $.clock.after(0, () => void $.ui.open({ id: PANE, title: PANE_TITLE, columns: PANE_COLUMNS }))
    }
    if (e.props.hasSurvey) {
      railHover = null
      return next(e)
    }
    // Reading isTurnRunning redraws the rail as each turn starts and ends.
    const isWorking = await read($, isTurnRunning)
    await read($, railTick)
    // State starts over on a reload or a rename; the store keeps this
    // session's last reply and token totals across both.
    const kept = await $.store.get(RAIL_STORE_KEY)
    const keptHere = kept !== null && typeof kept === 'object' && (kept as RailKept).sessionId === (await $.session.id()) ? (kept as RailKept) : null
    const repliedAt = (await read($, lastReplyAt)) ?? keptHere?.repliedAt ?? null
    const now = await $.clock.now()
    const cacheSecondsLeft = repliedAt === null ? null : Math.max(0, Math.round((CACHE_TTL_MS - (now - repliedAt)) / 1000))
    tickWhileWarm($, cacheSecondsLeft !== null && cacheSecondsLeft > 0 && !isWorking)
    const usage = await $.session.usage({ breakdown: 'summary' })
    const breakdown = usage.context.breakdown
    const last = breakdown?.apiUsage ?? null
    const input = last === null ? 0 : last.input_tokens + last.cache_read_input_tokens + last.cache_creation_input_tokens
    const list = await read($, sources)
    const values = await read($, dials)
    // Only while the dial is on Autopilot: lowered, or the dials off,
    // nothing is answered.
    const isDials = await read($, isDialsOn)
    const auto = isDials && values.autonomy === 5 ? await read($, autopilot) : null
    const ui: Ui = resolveUi($.ui.resolve(e), e.surface, await read($, isClientDown))
    const heads = await paneHeads($)
    const rail = drawRail(
      ui,
      {
        isWorking,
        cacheSecondsLeft,
        cachePercent: last === null || input === 0 ? null : Math.round((last.cache_read_input_tokens / input) * 100),
        tokens: (await read($, tokenTotals)) ?? keptHere?.tokens ?? null,
        costUsd: usage.cost?.usd ?? null,
        preset: presetName(values),
        presetLevels: [values.foresight, values.crew, values.tenacity, values.autonomy, values.proof, values.voice],
        sourcesOn: list.filter(one => one.mode !== 'off').length,
        sourcesTotal: list.length,
        isDialsOn: isDials,
        isContextOn: await read($, isContextOn),
        heads,
        autopilot:
          auto === null
            ? null
            : auto.kind === 'waiting'
              ? { kind: 'waiting', secondsLeft: Math.max(0, Math.round((auto.deadline - now) / 1000)), totalSeconds: Math.round((auto.deadline - auto.since) / 1000), picked: auto.picked, count: auto.count }
              : { kind: 'answered', at: clockTime(auto.at), picked: auto.picked, waitedMinutes: Math.round(auto.waitedMs / 60_000) },
      },
      at => void toggleCard($, at),
      railHover,
      (id, isOn) => {
        // Leaving A may land after entering B: only A's own leave clears it.
        const hovered = isOn ? id : railHover === id ? null : railHover
        if (hovered === railHover) return
        railHover = hovered
        void update($, railTick, n => n + 1)
      },
      e.props.bodyColumns,
    )
    // Where nothing docks, a card opened from the rail draws under it,
    // above the prompt.
    const open = await read($, tab)
    if (open === null || isDocking) return rail
    const width = Math.min(e.props.bodyColumns, BAND_CARD_COLUMNS)
    const body = open === 'dials' ? await dialsBody($, ui, width) : await contextBody($, ui, width)
    const { Box } = ui
    return (
      <Box flexDirection="column" gap={ui.Svg !== undefined ? 1 : 0}>
        {rail}
        <Box key="band-card" width={width} flexDirection="column">
          {cardOf(ui, open, true, heads[open], () => void update($, tab, () => null), body)}
        </Box>
      </Box>
    )
  })
}

// A time of day as the person's clock shows it: 4:12 pm.
function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// The prompt cache lives 5 minutes past the last reply. While it is warm
// the rail redraws every few seconds so its bars run down.
const CACHE_TTL_MS = 5 * 60_000
let cacheTick: Timer | null = null

function tickWhileWarm($: $, isWarm: boolean): void {
  if (isWarm && cacheTick === null) cacheTick = $.clock.every(5_000, () => void update($, railTick, n => n + 1))
  if (!isWarm && cacheTick !== null) {
    cacheTick.cancel()
    cacheTick = null
  }
}

// The rail's items open their card, or close it when it is the one open;
// the mark opens the Dials card or closes any. Where the surface docks,
// the card shows in the pane on the right, which opens if it was closed.
async function toggleCard($: $, at: Tab | null): Promise<void> {
  const open = await read($, tab)
  const isShown = isDocking && (await $.ui.panes()).some(one => one.id === PANE && one.isShown)
  const next = isDocking && !isShown ? (at ?? open ?? DEFAULT_TAB) : at === null ? (open === null ? DEFAULT_TAB : null) : open === at ? null : at
  await update($, tab, () => next)
  if (isDocking && !isShown) await $.ui.open({ id: PANE, title: PANE_TITLE, columns: PANE_COLUMNS, focus: true })
}
