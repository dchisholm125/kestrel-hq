# @kestrel/sdk

Lightweight helpers for bot clients: typed SubmitResult union and retry policy.

Example usage:

```ts
import { SubmitResult } from '@kestrel/sdk'
import { shouldRetry, retryDelay, logSubmitOutcome } from '@kestrel/sdk'

async function submitWithRetry(send: () => Promise<SubmitResult>) {
  let attempt = 0
  while (attempt < 4) {
    const res = await send()
    if (res.ok) {
      await logSubmitOutcome({ ok: true, attempt, intent_id: res.intent_id })
      return res
    }
    const code = res.error.reason.code
    const retry = shouldRetry(code)
    const delay = retry ? retryDelay(code, attempt) : 0
  await logSubmitOutcome({ ok: false, attempt, intent_id: undefined, code, nextRetryMs: delay })
    if (!retry) return res
    await new Promise(r => setTimeout(r, delay))
    attempt++
  }
}
```

How to run tests locally

Install and run tests:

```
pnpm -w i
pnpm --filter @kestrel/sdk test
```

Optional client audit

- logSubmitOutcome will write a JSONL line to ~/.kestrel/audit/client_submissions.jsonl if no auditWriter is provided and Node fs is available.
