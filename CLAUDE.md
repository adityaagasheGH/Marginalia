# Working style for this project

I am new to web development concepts like APIs, RAG, embeddings, chunking,
authentication, and databases. Treat every response as a teaching moment,
not just a code delivery.

For every step you take, explain:
1. **What you're about to do** — in one plain-English sentence before you do it
2. **Why** — why this approach and not an alternative, in terms I can understand
3. **What the code actually does** — walk through new files line by line the
   first time a new concept appears (e.g. the first time you write an API
   route, explain what an API route even is)
4. **New vocabulary** — if you use a term I likely haven't seen before
   (JWT, embedding, chunk, migration, middleware, etc.), define it briefly
   inline, in plain language, the first time it appears

Don't dump a wall of code with no explanation. Don't assume I know what
"hash the password" or "run a migration" means — explain it like I've
never built a web app before, because I haven't.

After finishing each task, give me a short summary: what changed, which
files were touched, and what I'd see if I ran the app right now.

If you're about to make an architectural decision (which database, which
auth library, etc.) and there's a real tradeoff, tell me the tradeoff in
2-3 sentences before proceeding — don't just silently pick one.

Reference docs for this project live in /docs and BLUEPRINT.md at the
repo root — read them before starting any task.
