import { invoke } from '@tauri-apps/api/core'

export interface SshRelaySetupResult {
  hostAlias: string
  backupPath?: string
}

export function setupSshRelay(hostAlias: string, password?: string) {
  return invoke<SshRelaySetupResult>('setup_ssh_relay', {
    hostAlias,
    password: password || null,
  })
}
