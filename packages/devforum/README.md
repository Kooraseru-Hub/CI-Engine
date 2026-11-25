# DevForum

Reusable Roblox DevForum native PNG uploads, SHA-256 cache checks, and existing public topic first-post publication with anonymous verification. The project owns Markdown, SVG rendering, benchmark logic, destination IDs and cache storage.

Node.js 24. `node post.cjs rehearse <config.json> <post.md>` validates the configured destination and authored native image inventory offline. `prepare <config.json>` reads the existing post and returns its digest and verified upload inventory. `publish <config.json> <post.md> <digest>` rejects concurrent changes and verifies saved public images. Use the `post` composite action with the corresponding mode. The config must contain `{"destination":{"topicId":42,"postId":7}}` (example IDs only).

`node upload.cjs <file.png>` computes a fingerprint without remote writes. Add `--publish` or use the `upload` action with `confirm: 'true'` to upload. The exported `cachedUpload` checks identical bytes and verified public availability before reuse.

Authenticated commands require `DEVFORUM_UPLOAD_KEY` and `DEVFORUM_UPLOAD_CLIENT` in a protected job. Credentials are only sent to the exact Roblox DevForum origin, never anonymous image storage. This package does not create topics or store cache data in CI-Packages. No external mutations in tests.
