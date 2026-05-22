#!/usr/bin/env python3
import argparse
import json
import os
import urllib.error
import urllib.parse
import urllib.request


def build_base_url() -> str:
    return os.environ.get(
        "HERMES_WORKSPACE_URL",
        "https://hermes-workspace.squadmilleo.com.br",
    ).rstrip("/")


def build_headers() -> dict[str, str]:
    token = os.environ.get("HERMES_WORKSPACE_SERVICE_TOKEN", "").strip()
    if not token:
        raise SystemExit("HERMES_WORKSPACE_SERVICE_TOKEN is not configured.")
    return {
        "Content-Type": "application/json",
        "X-Hermes-Service-Token": token,
    }


def request_json(method: str, path: str, payload: dict | None = None):
    url = f"{build_base_url()}{path}"
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, method=method)
    for key, value in build_headers().items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"{exc.code} {exc.reason}: {body}") from exc


def command_summary(args):
    payload = {
        "op": "summary",
        "include_done": args.include_done,
        "follow_up": args.follow_up,
    }
    if args.status:
        payload["status"] = args.status
    if args.assignee:
        payload["assignee"] = args.assignee
    print(json.dumps(request_json("POST", "/api/epr-pendings/bridge", payload), ensure_ascii=False, indent=2))


def command_briefing(args):
    payload = {
        "op": "briefing",
        "include_done": args.include_done,
        "follow_up": args.follow_up,
    }
    if args.status:
        payload["status"] = args.status
    if args.assignee:
        payload["assignee"] = args.assignee
    print(json.dumps(request_json("POST", "/api/epr-pendings/bridge", payload), ensure_ascii=False, indent=2))


def command_find(args):
    query = urllib.parse.urlencode(
        {
            "query": args.query,
            "limit": args.limit,
            "include_done": "true" if args.include_done else "false",
        }
    )
    print(json.dumps(request_json("GET", f"/api/epr-pendings/bridge?{query}"), ensure_ascii=False, indent=2))


def command_show(args):
    query = urllib.parse.urlencode({"pending_number": args.pending_number})
    print(json.dumps(request_json("GET", f"/api/epr-pendings/bridge?{query}"), ensure_ascii=False, indent=2))


def command_capture(args):
    payload = {
        "op": "capture",
        "actor": args.actor,
        "origin": args.origin,
    }
    for key in (
        "pending_id",
        "title",
        "description",
        "note",
        "status",
        "priority",
        "assignee",
        "next_action",
        "follow_up_at",
        "live_summary",
        "last_note",
        "query",
    ):
        value = getattr(args, key, None)
        if value:
            payload[key] = value
    if args.pending_number:
        payload["pending_number"] = args.pending_number
    if args.tags:
        payload["tags"] = args.tags
    gorpo = {}
    if args.demand_type:
        gorpo["demand_type"] = args.demand_type
    if args.dependencies:
        gorpo["dependencies"] = args.dependencies
    if args.deadline:
        gorpo["deadline"] = args.deadline
    if args.risk:
        gorpo["risk"] = args.risk
    if args.actionable_now:
        gorpo["actionable_now"] = args.actionable_now == "yes"
    if args.specialist_needed:
        gorpo["specialist_needed"] = args.specialist_needed
    if args.definition_of_done:
        gorpo["definition_of_done"] = args.definition_of_done
    if gorpo:
        payload["gorpo_triage"] = gorpo
    print(json.dumps(request_json("POST", "/api/epr-pendings/bridge", payload), ensure_ascii=False, indent=2))


def command_delegate(args):
    payload = {
        "op": "delegate",
        "actor": args.actor,
        "pending_id": args.pending_id,
        "agent_id": args.agent_id,
        "objective": args.objective,
        "auto_task": not args.no_auto_task,
        "launch_session": args.launch_session,
    }
    if args.pending_number:
        payload["pending_number"] = args.pending_number
    if args.target_workspace:
        payload["target_workspace"] = args.target_workspace
    print(json.dumps(request_json("POST", "/api/epr-pendings/bridge", payload), ensure_ascii=False, indent=2))


def command_report(args):
    payload = {
        "op": "report",
        "actor": args.actor,
        "promote_memory": args.promote_memory,
    }
    if args.pending_id:
        payload["pending_id"] = args.pending_id
    if args.pending_number:
        payload["pending_number"] = args.pending_number
    for key in (
        "execution_id",
        "agent_id",
        "status",
        "note",
        "output_summary",
        "next_action",
        "follow_up_at",
        "live_summary",
    ):
        value = getattr(args, key, None)
        if value:
            payload[key] = value
    print(json.dumps(request_json("POST", "/api/epr-pendings/bridge", payload), ensure_ascii=False, indent=2))


def build_parser():
    parser = argparse.ArgumentParser(description="Hermes bridge for EPR pendings")
    subparsers = parser.add_subparsers(dest="command", required=True)

    summary = subparsers.add_parser("summary")
    summary.add_argument("--include-done", action="store_true")
    summary.add_argument("--follow-up", action="store_true")
    summary.add_argument("--status")
    summary.add_argument("--assignee")
    summary.set_defaults(func=command_summary)

    briefing = subparsers.add_parser("briefing")
    briefing.add_argument("--include-done", action="store_true")
    briefing.add_argument("--follow-up", action="store_true")
    briefing.add_argument("--status")
    briefing.add_argument("--assignee")
    briefing.set_defaults(func=command_briefing)

    find = subparsers.add_parser("find")
    find.add_argument("query")
    find.add_argument("--limit", type=int, default=10)
    find.add_argument("--include-done", action="store_true")
    find.set_defaults(func=command_find)

    show = subparsers.add_parser("show")
    show.add_argument("pending_number", type=int)
    show.set_defaults(func=command_show)

    capture = subparsers.add_parser("capture")
    capture.add_argument("--actor", default="hermes")
    capture.add_argument("--origin", default="agent")
    capture.add_argument("--pending-id")
    capture.add_argument("--pending-number", type=int)
    capture.add_argument("--query")
    capture.add_argument("--title")
    capture.add_argument("--description")
    capture.add_argument("--note")
    capture.add_argument("--status")
    capture.add_argument("--priority")
    capture.add_argument("--assignee")
    capture.add_argument("--tag", dest="tags", action="append")
    capture.add_argument("--next-action")
    capture.add_argument("--follow-up-at")
    capture.add_argument("--live-summary")
    capture.add_argument("--last-note")
    capture.add_argument("--demand-type")
    capture.add_argument("--dependency", dest="dependencies", action="append")
    capture.add_argument("--deadline")
    capture.add_argument("--risk")
    capture.add_argument("--actionable-now", choices=["yes", "no"])
    capture.add_argument("--specialist-needed")
    capture.add_argument("--definition-of-done")
    capture.set_defaults(func=command_capture)

    delegate = subparsers.add_parser("delegate")
    delegate.add_argument("--actor", default="hermes")
    delegate.add_argument("--pending-id")
    delegate.add_argument("--pending-number", type=int)
    delegate.add_argument("--agent-id", required=True)
    delegate.add_argument("--objective", required=True)
    delegate.add_argument("--target-workspace")
    delegate.add_argument("--launch-session", action="store_true")
    delegate.add_argument("--no-auto-task", action="store_true")
    delegate.set_defaults(func=command_delegate)

    report = subparsers.add_parser("report")
    report.add_argument("--actor", default="hermes")
    report.add_argument("--pending-id")
    report.add_argument("--pending-number", type=int)
    report.add_argument("--execution-id")
    report.add_argument("--agent-id")
    report.add_argument("--status")
    report.add_argument("--note")
    report.add_argument("--output-summary")
    report.add_argument("--next-action")
    report.add_argument("--follow-up-at")
    report.add_argument("--live-summary")
    report.add_argument("--promote-memory", action="store_true")
    report.set_defaults(func=command_report)

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
