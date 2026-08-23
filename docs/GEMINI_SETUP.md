# Gemini Setup — 2 minutes

This entire project runs on Google's free Gemini API. No credit card, no trial expiry, no monthly bills.

## 1. Get an API key (1 min)

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Click **"Get API key"** in the top left
3. Click **"Create API key in new project"**
4. Copy the key
5. Paste it into `.env` as `GOOGLE_GENERATIVE_AI_API_KEY=<key>`

That's it. You have:
- **1,500 requests per day**
- **10 million tokens per minute**
- **No expiry, no upgrades needed**

## 2. What you get

| | Quota | Enough for |
|---|---|---|
| Summaries | Included | ~50 documents/day ingested |
| Embeddings | Included | ~1k chunks indexed |
| Chat | Included | ~100 turns/day |
| **All three** | 1 shared pool | 4-day sprint + demo + review |

You won't hit these limits during the take-home.

## 3. Usage in the code

The Vercel AI SDK handles everything. Just swap the provider string:

```ts
// app/api/documents/[id]/chat/route.ts
import { google } from '@ai-sdk/google';

const result = streamText({
  model: google('models/gemini-2.5-flash'),
  // ... rest is the same
});
```

## 4. Monitor usage

In Google AI Studio (top left corner) you'll see:
- Request count for today
- Remaining quota

If you ever see 429 (quota limit), just wait a few seconds — you won't hit this during a sprint.

## 5. If you need more

You'll probably never need this. But if you do:

- **Pay as you go:** Turn on billing in Google Cloud Console. Gemini 2.5 Flash is ~$0.075 per million input tokens, well below Claude or GPT-4.
- **Batch API:** 50% cheaper if you're okay with 24-hour latency on summaries.

For now: hit the free tier button, build the project, ship it. Worry about scale later.
