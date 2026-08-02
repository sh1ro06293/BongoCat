<script setup lang="ts">
import { Button, Flex, Input, InputPassword, message } from 'antdv-next'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ProListItem from '@/components/pro-list-item/index.vue'
import ProList from '@/components/pro-list/index.vue'
import { setupSshRelay } from '@/plugins/sshRelay'
import { useGeneralStore } from '@/stores/general'

const generalStore = useGeneralStore()
const loading = ref(false)
const password = ref('')
const { t } = useI18n()

async function handleSetup() {
  const hostAlias = generalStore.integration.sshHostAlias.trim()

  if (!hostAlias) {
    message.warning(t('pages.preference.general.hints.sshRelayRequired'))
    return
  }

  loading.value = true

  try {
    await setupSshRelay(hostAlias, password.value)
    message.success(t('pages.preference.general.hints.sshRelaySuccess'), 8)
  } catch (error) {
    message.error(String(error), 10)
  } finally {
    password.value = ''
    loading.value = false
  }
}
</script>

<template>
  <ProList :title="$t('pages.preference.general.labels.integrationsSettings')">
    <ProListItem
      :description="$t('pages.preference.general.hints.sshRelay')"
      :title="$t('pages.preference.general.labels.sshRelay')"
      vertical
    >
      <Flex
        class="w-full"
        gap="small"
        vertical
      >
        <Input
          v-model:value="generalStore.integration.sshHostAlias"
          :placeholder="$t('pages.preference.general.placeholders.sshHostAlias')"
          @press-enter="handleSetup"
        />
        <InputPassword
          v-model:value="password"
          autocomplete="new-password"
          :placeholder="$t('pages.preference.general.placeholders.sshPassword')"
          @press-enter="handleSetup"
        />
        <Button
          block
          :loading="loading"
          type="primary"
          @click="handleSetup"
        >
          {{ $t('pages.preference.general.buttons.setupRelay') }}
        </Button>
      </Flex>

      <template #description>
        <div>{{ $t('pages.preference.general.hints.sshRelay') }}</div>
        <div class="mt-1">
          {{ $t('pages.preference.general.hints.sshRelayHost') }}
        </div>
      </template>
    </ProListItem>
  </ProList>
</template>
