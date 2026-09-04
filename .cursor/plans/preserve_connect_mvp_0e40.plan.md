# Forever — MVP Plan

## Goal

**Forever:** private family chat + shared memory library + heritage AI entity (immutable identity + mutable life context), starting with one family (gift for mother).

## Source

Discussion doc: “Thảo luận về SP quan trọng (Bảo tồn & Kết nối)” — product thesis and design principles.

## Important constraint

Current repo ships **Read** (book product). Forever is a **separate greenfield repo** (`hiepsikien/Forever`), not mixed into Read’s library/reader flows.

## Phased delivery

1. **Phase 0 — Data**: voice samples, stories, core-values worksheet (Identity Lock).
2. **Phase 1 — Family chat**: spaces, invites, realtime text/media chat for living members.
3. **Phase 2 — Shared library**: memories from uploads + “save from chat”.
4. **Phase 3 — Heritage AI (text)**: IdentityProfile + RAG + labeled replies; no fabrication.
5. **Phase 4 — Voice DNA**: optional TTS after text quality passes family eval.
6. **Phase 5 — Longevity**: stewardship transfer, export archive, encryption roadmap.

## First build slice (when coding starts)

Auth → FamilySpace/Membership/Invite → Thread/Message API → Mobile chat screen → internal build for mother + 1–2 relatives.

## Canonical doc

See [docs/PRESERVE_CONNECT.md](../../docs/PRESERVE_CONNECT.md) for full product rules, schema sketch, risks, and success criteria.
