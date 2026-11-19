# Netcatty Mate v3.1.7

- Implement real Android AI privacy using the same detector and session lifecycle as desktop. Mask credentials, public IPs and structured hostnames locally; restore aliases in replies/tool arguments through existing streaming middleware. New Android installs default to protection on; saved explicit policy remains honored.
- Fail closed on invalid policies and stale sessions. Catch CattyAgent initialization failures in chat rather than an unhandled promise overlay. Remove unavailable optional desktop MCP session publisher.
- Preserve v3.1.6 encrypted protective backup, WebDAV JSON compatibility, strict pull-only cloud sync and bidirectional SFTP fixes. Existing signing secrets unchanged.

## Verification scope
Source/runtime tests use fake credentials and an isolated loopback OpenAI-compatible SSE provider, real Android bridge, SDK and shared privacy middleware: outbound secrets masked, split tokens restored, invalid policy sends no unprotected request. Existing privacy tool-call/stream tests retained.
No real AI provider or production API key was used. Full production UI provider-selection/send smoke is SKIPPED/unverified by user direction; previous failed evidence is retained in Actions runs 44484998921 and 44486289886. Native transport/Keystore behavior on a physical Android device remains unverified. Existing startup/settings/cloud/native/SFTP and signing build gates remain enabled.
