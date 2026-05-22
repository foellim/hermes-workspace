---
name: epr-pending-manager
description: Orquestra pendencias do EPR pelo workspace, mantendo historico operacional, resumo vivo, follow-up e execucoes multiagente vinculadas.
version: 1.0.0
author: Codex
when_to_use: |
  - Sempre que houver nova pendencia, cobranca, bloqueio, follow-up ou acompanhamento do EPR
  - Quando uma mensagem de Telegram precisar virar item rastreavel no workspace EPR
  - Quando uma pendencia do EPR precisar delegar para um ou mais agentes
  - Quando for necessario consolidar resumo vivo e proxima acao sem perder historico
---

# EPR Pending Manager

Use this skill when operating the `EPR Pendings` workflow in Hermes Workspace.

## Goals

- Keep the EPR pending board as the operational source of truth.
- Capture updates from Telegram, chat, or workspace without losing context.
- Delegate work to one or more agents while preserving a single parent pending.
- Promote only durable context into memory.
- Keep Duncan and Gorpo aligned through numbered pendings and a shared board briefing.

## Workspace Surface

- Main page: `/epr-pendings`
- API list/create: `/api/epr-pendings`
- API detail/actions: `/api/epr-pendings/:pendingId`
- Bridge API for Hermes orchestration: `/api/epr-pendings/bridge`
- Helper CLI: `epr-pending-bridge`

## Pending Model

Each pending should preserve:

- `sequence_number`
- `title`
- `description`
- `status`
- `priority`
- `assignee`
- `tags`
- `next_action`
- `follow_up_at`
- `last_note`
- `live_summary`
- `gorpo_triage`
- `executions[]`
- `history[]`

## Operating Rules

1. Use the pending history as the full operational log.
2. Keep `live_summary` concise and current.
3. Use `last_note` for the newest relevant update.
4. Create linked executions when multiple agents are needed.
5. Keep the parent pending in EPR even if execution happens elsewhere.
6. Promote to memory only when the context is durable or reusable.
7. Always refer to the pending by number when talking in Telegram if a number exists.
8. Keep Gorpo triage current when the demand is medium or complex.
9. Before triaging or distributing medium/complex work, pull a fresh board briefing.
10. When Duncan needs context, give him the numbered pending plus the latest board briefing.
11. Before Gorpo or an orchestrator chooses specialists, refresh the real agent roster for the current session.

## Gorpo Triage

Use these fields to structure the first-pass triage:

- `demand_type`
- `dependencies`
- `deadline`
- `risk`
- `actionable_now`
- `specialist_needed`
- `definition_of_done`

Gorpo should answer:

1. What kind of demand is this?
2. What does it depend on?
3. What is the real deadline?
4. What is the risk?
5. Can we act now?
6. Do we need a specialist, skill, or external agent?
7. What counts as done?

Gorpo must also validate the real roster before distribution:

1. run `hermes profile list`
2. treat that output as the authoritative roster for the session
3. use file-based rosters only as references
4. if the ideal specialist is unavailable, record the gap in `specialist_needed`
5. never invent an agent name

## Common API Actions

### Create pending

`POST /api/epr-pendings`

Use for a new obligation, follow-up, blocker, or tracked subject.

### Update pending

`PATCH /api/epr-pendings/:pendingId`

Use for status, priority, assignee, summary, next action, or follow-up changes.

### Add note

`POST /api/epr-pendings/:pendingId?action=note`

Body:

```json
{
  "content": "Latest operational update",
  "actor": "hermes"
}
```

### Delegate execution

`POST /api/epr-pendings/:pendingId?action=delegate`

Body:

```json
{
  "agent_id": "builder",
  "objective": "Investigate the blocker and return next action",
  "auto_task": true,
  "launch_session": true,
  "actor": "hermes"
}
```

### Update execution

`POST /api/epr-pendings/:pendingId?action=execution`

Use when an agent reports progress, blockage, or completion.

### Promote to memory

`POST /api/epr-pendings/:pendingId?action=promote-memory`

Use only when the pending produced durable context worth reusing later.

## Bridge API

Use the bridge when the Hermes agent is operating from Telegram or another
non-browser surface and needs a single operational entrypoint with service-token
auth.

### Search or quick list

`GET /api/epr-pendings/bridge?query=termo&limit=5`

### Capture or update

`POST /api/epr-pendings/bridge`

```json
{
  "op": "capture",
  "pending_number": 15,
  "title": "Pendencia X",
  "note": "Atualizacao recebida no Telegram",
  "next_action": "Cobrar retorno na sexta",
  "follow_up_at": "2026-05-23",
  "actor": "hermes",
  "origin": "telegram",
  "gorpo_triage": {
    "demand_type": "follow-up comercial",
    "dependencies": ["retorno do cliente", "documento assinado"],
    "deadline": "2026-05-23",
    "risk": "perder a janela comercial",
    "actionable_now": true,
    "specialist_needed": "Gorpo para triagem, Duncan se houver bloqueio tecnico",
    "definition_of_done": "cliente respondeu e proxima acao ficou definida"
  }
}
```

### Delegate

```json
{
  "op": "delegate",
  "pending_id": "pending-id",
  "agent_id": "duncan",
  "objective": "Investigar causa raiz e devolver proposta objetiva",
  "target_workspace": "duncan",
  "actor": "hermes"
}
```

### Report back

```json
{
  "op": "report",
  "pending_id": "pending-id",
  "agent_id": "duncan",
  "status": "done",
  "output_summary": "Diagnostico concluido com proposta de proxima acao",
  "note": "Resumo consolidado do retorno",
  "next_action": "Validar com Fernando",
  "actor": "hermes"
}
```

### Summary

```json
{
  "op": "summary",
  "follow_up": true
}
```

### Board briefing

Use this when Gorpo or Duncan needs situational awareness of the EPR queue.

```json
{
  "op": "briefing",
  "follow_up": true
}
```

### Resolve one pending by number

`GET /api/epr-pendings/bridge?pending_number=15`

## Helper CLI

Use `epr-pending-bridge` when shell access is easier than crafting raw HTTP.
If the command is not on `PATH`, call the mounted helper directly:
`/opt/data/.local/bin/epr-pending-bridge`.

Examples:

- `epr-pending-bridge summary --follow-up`
- `epr-pending-bridge briefing --follow-up`
- `epr-pending-bridge show 15`
- `epr-pending-bridge find "cliente xp documentacao"`
- `epr-pending-bridge capture --title "Cobrar documento" --note "Cliente pediu mais prazo" --follow-up-at 2026-05-23 --demand-type "follow-up" --risk "atraso de entrega"`
- `/opt/data/.local/bin/epr-pending-bridge delegate --pending-number 15 --agent-id duncan --objective "Levantar causa raiz"`
- `/opt/data/.local/bin/epr-pending-bridge report --pending-number 15 --agent-id duncan --status done --output-summary "Entregou a analise"`

## Suggested Operating Loop

1. Pull `briefing` to understand the active queue.
2. If the subject already exists, use `show <numero>` or `find "<termo>"`.
3. If it is a new demand, create or update it with Gorpo triage fields.
4. If it needs distribution, delegate with the pending number as the primary reference.
5. When an executor returns, report back to the same pending number and refresh `live_summary` and `next_action`.

Required env vars for the helper:

- `HERMES_WORKSPACE_URL`
- `HERMES_WORKSPACE_SERVICE_TOKEN`

## Tagging

- Do not force a fixed taxonomy.
- Suggest tags from the current context.
- Keep tags short and reusable.

## Memory

Promote to memory when one of these is true:

- a durable decision was made
- a recurring blocker was identified
- a preference or rule was clarified
- a reusable procedure emerged
- the pending connects to other long-term subjects

Do not promote every status change or routine follow-up.
