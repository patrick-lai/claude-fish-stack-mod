// fishStack no longer keeps worktrees: a repository that had Use worktrees on
// loses the old desktop hook's switch and its entries in the local settings
// at the next session start, and keeps everything else.
import { expect, test } from 'claude-code/testing'

import { REPO, startSession, world } from './world'

const SWITCH = `${REPO}/.git/fishstack/on`
const LOCAL = `${REPO}/.claude/settings.local.json`
const OURS = (mode: string) => ({ hooks: [{ type: 'command', command: `bash "$(git -C "$CLAUDE_PROJECT_DIR" rev-parse --path-format=absolute --git-common-dir)/fishstack/desktop-worktree.sh" ${mode}` }] })
const THEIRS = { hooks: [{ type: 'command', command: 'echo mine' }] }

test("the old desktop hook's switch and settings entries come out; the person's own stay", async ($, on) => {
  const files: Record<string, string> = {
    [SWITCH]: 'Use worktrees is on\n',
    [LOCAL]: JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { WorktreeCreate: [OURS('create')], WorktreeRemove: [THEIRS, OURS('remove')], Stop: [THEIRS] } }),
  }
  const { commands } = world(on, { files })
  await startSession($)
  expect(commands).toContain(`${REPO}$ rm -f ${SWITCH}`)
  expect(JSON.parse(files[LOCAL]!)).toEqual({ permissions: { allow: ['Bash(ls)'] }, hooks: { WorktreeRemove: [THEIRS], Stop: [THEIRS] } })
})

test('with only fishStack hooks there, the hooks key goes too', async ($, on) => {
  const files: Record<string, string> = { [LOCAL]: JSON.stringify({ hooks: { WorktreeCreate: [OURS('create')], WorktreeRemove: [OURS('remove')] } }) }
  world(on, { files })
  await startSession($)
  expect(JSON.parse(files[LOCAL]!)).toEqual({})
})

test('a repository that never had them is left as it is, and a broken file is skipped', async ($, on) => {
  const files: Record<string, string> = { [LOCAL]: '{ not json', [`${REPO}/README.md`]: '# repo' }
  const { commands, written } = world(on, { files })
  await startSession($)
  expect(commands.some(one => one.includes(' rm '))).toBe(false)
  expect(written).not.toContain(LOCAL)
  expect(files[LOCAL]).toBe('{ not json')
})

test('settings with hooks of their own only are not rewritten', async ($, on) => {
  const local = JSON.stringify({ hooks: { WorktreeCreate: [THEIRS] } })
  const files: Record<string, string> = { [LOCAL]: local }
  const { written } = world(on, { files })
  await startSession($)
  expect(written).not.toContain(LOCAL)
  expect(files[LOCAL]).toBe(local)
})

test('outside git nothing is looked for', async ($, on) => {
  const { commands } = world(on, { isRepo: false })
  await startSession($)
  expect(commands.some(one => one.includes('rev-parse'))).toBe(false)
})
