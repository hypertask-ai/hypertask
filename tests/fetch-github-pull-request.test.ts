import assert from 'node:assert/strict'

const pullUrl = 'https://github.com/valentinyeo/multiprompt/pull/770'

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function pullBody(title: string) {
  return {
    id: 5162860208,
    html_url: pullUrl,
    title,
    updated_at: '2026-11-05T05:53:10Z',
    state: 'open',
    merged_at: null,
    base: { repo: { id: 42 } },
    head: { sha: 'abc123def' },
  }
}

function checksBody() {
  return {
    total_count: 1,
    check_runs: [{ status: 'completed', conclusion: 'success' }],
  }
}

async function main() {
  process.env.DATABASE_URL = 'postgresql://unused:unused@localhost:5432/unused'
  process.env.GITHUB_TOKEN = 'server-token\n'
  const [{ fetchGithubPullRequest }, { parseGithubPullRequestUrl }, { PullRequestLinkError }] =
    await Promise.all([
      import('@/lib/pullRequests/taskPullRequests'),
      import('@/lib/pullRequests/githubPullRequests'),
      import('@/lib/pullRequests/taskPullRequests'),
    ])
  const parsed = parseGithubPullRequestUrl(pullUrl)
  assert.ok(parsed)
  const originalFetch = globalThis.fetch

  const install = (
    handler: (url: string, authorization: string | null) => Response,
  ) => {
    const calls: Array<{ url: string; authorization: string | null }> = []
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      const headers = new Headers(init?.headers)
      const authorization = headers.get('authorization')
      calls.push({ url, authorization })
      return handler(url, authorization)
    }
    return calls
  }

  try {
    const publicCalls = install((url, authorization) => {
      if (authorization) return jsonResponse(403, { message: 'Resource not accessible by integration' })
      if (url.includes('/pulls/')) return jsonResponse(200, pullBody('Public pull request'))
      return jsonResponse(200, checksBody())
    })
    const linked = await fetchGithubPullRequest(parsed)
    assert.equal(linked.title, 'Public pull request')
    assert.equal(linked.repositoryId, '42')
    assert.equal(linked.pullRequestId, '5162860208')
    assert.equal(linked.headSha, 'abc123def')
    assert.equal(linked.lifecycle, 'open')
    assert.equal(linked.checkState, 'passing')
    assert.equal(publicCalls.filter((call) => call.authorization === 'Bearer server-token').length, 2)
    assert.ok(publicCalls.some((call) => call.url.includes('/pulls/770') && call.authorization === null))

    const missingCalls = install((url, authorization) => {
      if (authorization) return jsonResponse(403, { message: 'Resource not accessible by integration' })
      return jsonResponse(404, { message: 'Not Found' })
    })
    await assert.rejects(
      () => fetchGithubPullRequest(parsed),
      (error: unknown) => {
        assert.ok(error instanceof PullRequestLinkError)
        assert.equal(error.status, 404)
        assert.equal(error.code, 'pr_not_found')
        return true
      },
    )
    assert.equal(missingCalls.length, 2)

    const limitedCalls = install((_url, authorization) => {
      if (authorization) {
        return jsonResponse(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' })
      }
      return jsonResponse(404, { message: 'Not Found' })
    })
    await assert.rejects(
      () => fetchGithubPullRequest(parsed),
      (error: unknown) => {
        assert.ok(error instanceof PullRequestLinkError)
        assert.equal(error.status, 502)
        assert.equal(error.code, 'github_unavailable')
        return true
      },
    )
    assert.equal(limitedCalls.length, 2)

    install((url, authorization) => {
      assert.equal(authorization, 'Bearer server-token')
      if (url.includes('/pulls/')) return jsonResponse(200, pullBody('Visible to the server token'))
      return jsonResponse(200, checksBody())
    })
    const visible = await fetchGithubPullRequest(parsed)
    assert.equal(visible.title, 'Visible to the server token')
    assert.equal(visible.checkState, 'passing')
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.GITHUB_TOKEN
  }
}

void main().then(() => {
  console.log('fetch-github-pull-request.test.ts: all assertions passed')
})
