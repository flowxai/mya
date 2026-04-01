import type { Command } from '../../commands.js'

const buddy = {
  type: 'local',
  name: 'buddy',
  description: 'Hatch, pet, and manage your companion',
  argumentHint: '[status|mute|unmute|help]',
  supportsNonInteractive: true,
  load: () => import('./buddy.js'),
} satisfies Command

export default buddy
