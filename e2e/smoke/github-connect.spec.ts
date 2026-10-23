import { expect, test } from '@playwright/test'

const FLAG = 'htpr-7515-connect-github-per-board'

for (const canConnect of [true, false]) {
  test(`GitHub repository settings ${canConnect ? 'installer adds private repositories' : 'another admin removes repositories'}`, async ({ page }) => {
    test.skip(!process.env.BROWSER_SMOKE_PR, 'mocked isolated PR fixtures only')
    const projectId = Number(new URL(process.env.SMOKE_BOARD_PATH!, 'http://localhost').searchParams.get('id'))
    const settings = {
      projectId, version: 'v1', canConnect,
      installations: [{ id: '123', accountLogin: 'acme', accountType: 'Organization', installedByMe: canConnect }],
      connected: [{ repositoryId: '456', fullName: 'acme/private', provenance: 'installed', installationId: '123', isPrivate: true }],
      available: canConnect ? [
        { repositoryId: '789', fullName: 'acme/web', installationId: '123', isPrivate: true, onOtherBoard: false },
        { repositoryId: '999', fullName: 'acme/other', installationId: '123', isPrivate: false, onOtherBoard: true },
      ] : [],
      githubUnavailable: false,
    }
    const saves: Array<{ repositoryIds: string[]; version: string }> = []
    await page.route('**/api/flags*', (route) => route.fulfill({ json: { flags: { [FLAG]: true } } }))
    await page.route('**/api/projects/*/github', (route) => {
      expect(new URL(route.request().url()).pathname).toBe(`/api/projects/${projectId}/github`)
      if (route.request().method() === 'PUT') {
        saves.push(route.request().postDataJSON())
        return route.fulfill({ status: 409, json: { error: 'stale' } })
      }
      return route.fulfill({ json: settings })
    })
    await page.goto(`/settings/github?projectId=${projectId}`, { waitUntil: 'load' })
    await expect(page.getByText('acme/private', { exact: true })).toBeVisible()
    await expect(page.getByText('Private', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Choose repos', exact: true }).click()
    const picker = page.locator('#option-picker')
    await expect(picker.getByPlaceholder('Search repositories…')).toBeVisible()
    if (canConnect) {
      await picker.getByPlaceholder('Search repositories…').fill('web')
      await picker.getByPlaceholder('Search repositories…').press('Enter')
    } else {
      await picker.locator('[id^="option-picker-"]', { hasText: 'acme/private' }).click()
    }
    await picker.getByPlaceholder('Search repositories…').press('Escape')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(saves).toHaveLength(0)
    await page.getByRole('button', { name: 'Choose repos', exact: true }).click()
    await picker.locator('[id^="option-picker-"]', { hasText: canConnect ? 'acme/web' : 'acme/private' }).click()
    await picker.getByPlaceholder('Search repositories…').press('Escape')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('repositories changed')
    expect(saves).toEqual([{ repositoryIds: canConnect ? ['456', '789'] : [], version: 'v1' }])
    await page.getByRole('button', { name: 'Reload repositories', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
  })
}

test('GitHub installation posts the explicit board and handles the approval return', async ({ page }) => {
  test.skip(!process.env.BROWSER_SMOKE_PR, 'mocked isolated PR fixtures only')
  const projectId = Number(new URL(process.env.SMOKE_BOARD_PATH!, 'http://localhost').searchParams.get('id'))
  await page.route('**/api/flags*', (route) => route.fulfill({ json: { flags: { [FLAG]: true } } }))
  await page.route('**/api/projects/*/github', (route) => route.fulfill({ json: {
    projectId, version: 'v1', canConnect: false, installations: [], connected: [], available: [], githubUnavailable: false,
  } }))
  await page.route('**/api/github/install', (route) => {
    expect(route.request().method()).toBe('POST')
    expect(new URLSearchParams(route.request().postData() ?? '').get('projectId')).toBe(String(projectId))
    return route.fulfill({ status: 303, headers: { Location: `/settings/github?projectId=${projectId}&github_status=pending` }, body: '' })
  })
  await page.goto(`/settings/github?projectId=${projectId}`, { waitUntil: 'load' })
  await page.getByRole('button', { name: 'Install GitHub App', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('awaiting approval')
  await expect(page).toHaveURL(new RegExp(`projectId=${projectId}`))
})

test('flag Off hides direct GitHub settings without querying a board', async ({ page }) => {
  test.skip(!process.env.BROWSER_SMOKE_PR, 'mocked isolated PR fixtures only')
  let requests = 0
  await page.route('**/api/flags*', (route) => route.fulfill({ json: { flags: { [FLAG]: false } } }))
  await page.route('**/api/projects/*/github', (route) => {
    requests++
    return route.fulfill({ status: 404, json: { error: 'not_found' } })
  })
  await page.goto('/settings/github?projectId=15', { waitUntil: 'load' })
  await expect(page).toHaveURL(/\/settings\/mcp$/)
  await expect(page.getByRole('button', { name: 'Choose repos', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Install GitHub App', exact: true })).toHaveCount(0)
  expect(requests).toBe(0)
})
