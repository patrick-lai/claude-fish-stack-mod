import type { Register } from 'claude-code'

import { registerBand } from './band'
import { registerContext } from './context'
import { registerDials } from './dials'
import { registerGuard } from './guard'
import { registerPane } from './pane'
import { registerSession } from './session'

export const register: Register = (on, options) => {
  registerGuard(on)
  registerSession(on, options)
  registerBand(on)
  registerDials(on)
  registerContext(on)
  registerPane(on)
}
