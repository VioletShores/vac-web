"""Cross-repo fixture: the EXACT bytes Athena hands VAC for a native Flux service operation.

Run (offline, isolated), from a vac-web checkout:

    python3 -I tests/cross_repo/athena_service_operation_probe.py <athena-checkout> <athena-commit> <out.json>

Real Athena code executed, unmodified, from <athena-checkout>/backend:
  canonical (canonical_json_bytes / canonical_json_hash), flux_agent_contract,
  flux_native_artifact_acceptance (READ_TOOL_PINS, PROJECT), flux_async_credit_risk,
  flux_native_observation (with_observation_scope, validate_observation_scope),
  flux_observation_context (build, bound, expected_state), policy.pdp.TenantPolicy,
  and the exact bodies of permits._service_operation / permits.service_operation_digest
  and flux_service_runtime._observation_context_preview (AST-extracted, as Athena's own
  tests/fixtures/flux_v3_renewal_probe.py does).
Stubbed seams only (no database, network, provider, VAC or permit): flux_project_content
(project content), control_plane.policy_rail (returns the sealed tenant policy given here),
flux_oauth (its PROVIDER constant, read from the real file), and, for the personal-owner
case only, the identity directory (vac_ceremony._owner_emails,
flux_personal_connection.owner_tenant), as Athena's own verifier tests monkeypatch it.

Writes one JSON fixture; exits non-zero if any Athena self-check fails.
"""
from __future__ import annotations

import ast
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import types

if __name__ != "__main__":
    raise RuntimeError("run as a script")

ATHENA, COMMIT, OUT = Path(sys.argv[1]).resolve(), sys.argv[2], Path(sys.argv[3])
CODE = ATHENA / "backend"
sys.path.insert(0, str(CODE))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def stub(name, **values):
    module = types.ModuleType(name)
    module.__dict__.update(values)
    sys.modules[name] = module
    return module


def extract(module, path, *names):
    tree = ast.parse(path.read_text())
    nodes = [x for x in tree.body if isinstance(x, ast.FunctionDef) and x.name in names]
    if {n.name for n in nodes} != set(names):
        raise SystemExit("athena function missing: " + ",".join(names))
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), "exec"), module.__dict__)


canonical = load("canonical", CODE / "canonical.py")
stub("backend", __path__=[], canonical=canonical)
sys.modules["backend.canonical"] = canonical
stub("policy", __path__=[])
pdp = load("policy.pdp", CODE / "policy" / "pdp.py")
native = load("flux_native_artifact_acceptance", CODE / "flux_native_artifact_acceptance.py")
stub("flux_project_content", PEBBLE_PROJECT=native.PROJECT,
     PreparedProjectContent=type("PreparedProjectContent", (), {}), prepare_project_content=None)
contract = load("flux_agent_contract", CODE / "flux_agent_contract.py")
risk = load("flux_async_credit_risk", CODE / "flux_async_credit_risk.py")
observation = load("flux_native_observation", CODE / "flux_native_observation.py")

permits = stub("permits", json=json, re=re, datetime=datetime,
               SERVICE_OPERATION_SCOPE="service-operation",
               ServicePermitError=type("ServicePermitError", (ValueError,), {}), _service_enabled=lambda: True)
extract(permits, CODE / "permits.py", "_service_operation", "service_operation_digest")
context = load("flux_observation_context", CODE / "flux_observation_context.py")
runtime = stub("flux_service_runtime_extract")
extract(runtime, CODE / "flux_service_runtime.py", "_observation_context_preview")

OAUTH_PROVIDER = re.search(r'^PROVIDER = "([^"]+)"', (CODE / "flux_oauth.py").read_text(), re.M).group(1)
ACTOR, PRINCIPAL, PERSONAL_TENANT = "owner@example.invalid", "synthetic-person", "synthetic-personal-tenant"
# Identity directory seam for the personal-owner case (Athena's verifier tests patch the same).
stub("flux_oauth", PROVIDER=OAUTH_PROVIDER)
stub("vac_ceremony", _owner_emails=lambda: frozenset({ACTOR}))
stub("flux_personal_connection",
     owner_tenant=lambda principal: PERSONAL_TENANT if principal == PRINCIPAL else None)

NOW = datetime.now(timezone.utc)


def operation_v2(tenant):
    """Athena's v2 source shape (flux_v3_renewal_probe.operation_v2), with a chosen tenant."""
    at = (NOW - timedelta(minutes=10)).isoformat()
    expiry = (NOW + timedelta(hours=2)).isoformat()
    r = {"mode": risk.RISK_MODE, "provider": "flux_ai", "account": native.OWNER,
         "project_url": native.PROJECT, "billing_mode": "on_demand",
         "observed_monthly_spend_limit_usd": "500.00", "observed_available_acus": 500,
         "provider_task_spend_cap_enforced": False, "provider_agent_stop_available": False,
         "automatic_retries": False, "evidence_kind": "owner_account_settings_ui_observation",
         "observed_at": at, "owner_acceptance": "fresh_exact_operation_vac_required",
         "payer_binding": {"type": "provider_project_owner_billing_rule", "status": risk.PAYER_STATUS,
                           "project_owner": native.OWNER, "billing_account": native.OWNER,
                           "source_url": risk.PAYER_RULE_URL, "observed_at": at, "oauth_subject_verified": False,
                           "fresh_provider_owner_recheck_required": True}}
    op = {"version": 2, "purpose": "service-operation", "execution_id": "flux-b1-v2source",
          "packet_id": "PKT-FLUX-B1-v2source", "actor": ACTOR, "principal": PRINCIPAL,
          "tenant_id": tenant, "service_id": "flux_ai", "endpoint": "https://app.flux.ai/mcp",
          "capability": "submit_agent_task", "project_url": native.PROJECT, "action": "create_thread",
          "executor": "flux_native", "expiry": expiry, "revocation_ref": "execution:flux-b1-v2source",
          "risk": 0.9, "content_sha256": contract.SOURCE_SHA256, "source_manifest_sha256": "1" * 64,
          "arguments_sha256": canonical.canonical_json_hash({"synthetic": "exact reviewed arguments"}),
          "tool_schema_sha256": contract.CREATE_INPUT_SHA256,
          "cost_contract_sha256": canonical.canonical_json_hash(r),
          "service_manifest_sha256": "2" * 64, "allowed_tools": list(observation.BASE_TOOLS),
          "constraints": {"network_allowlist": ["app.flux.ai"], "write_scope": [native.PROJECT],
                          "financial_transaction": False, "connection_budget": 3},
          "resource_envelope": {"max_turns": 1, "max_minutes": 15, "spend_ceiling": deepcopy(risk.UNKNOWN_ACU),
                                "cost_upper_bound": deepcopy(risk.UNKNOWN_ACU)},
          "evidence_requirements": {"independent_readback": True, "content_sha256": contract.SOURCE_SHA256,
                                    "source_manifest_sha256": "1" * 64},
          "object_ref": "submitted-source:" + contract.SOURCE_SHA256,
          "readback": {"action": "get_messages", "capability": "read_agent_messages", "tool_schema_sha256": "3" * 64,
                       "arguments_sha256": canonical.canonical_json_hash(contract.task_read_binding()),
                       "cost_contract_sha256": canonical.canonical_json_hash(r), "project_url": native.PROJECT,
                       "object_ref": "submitted-source:" + contract.SOURCE_SHA256,
                       "cost_upper_bound": deepcopy(risk.UNKNOWN_ACU), "max_calls": 2},
          "result_contract": {"kind": contract.TASK_KIND, "version": 1, "source_url": contract.SOURCE_URL,
                              "retrieved_at": at, "provider_project_id": native.OWNER + "/" + native.SLUG,
                              "read_argument_binding": contract.task_read_binding()},
          "async_credit_risk": r}
    return permits._service_operation(op)


def connection(tenant, account):
    return {"tenant_id": tenant, "provider_id": "flux_ai", "account_id": account,
            "scope": "execute", "project_url": native.PROJECT, "client_generation": 1,
            "client_id_sha256": hashlib.sha256(b"synthetic-public-client").hexdigest()}


def policy(op, mode, max_age):
    rail = {"mode": risk.RISK_MODE, "provider": "flux_ai", "account": native.OWNER,
            "monthly_spend_limit_usd": "500.00", "require_fresh_owner_vac": True,
            "require_verified_same_payer": True, "allow_one_effect": True, "automatic_retries": False,
            "observation_policy": {"version": 1, "mode": mode, "max_age_seconds": max_age}}
    return pdp.TenantPolicy(tenant_id=op["tenant_id"], rails={"flux_async_credit_risk": rail})


class Rail:
    """control_plane.policy_rail.PolicyRail seam: returns the sealed tenant policy."""
    def __init__(self, value):
        self.value = value

    def load_capability_policy(self, conn, tenant_id):
        if tenant_id != self.value.tenant_id:
            raise RuntimeError("tenant mismatch")
        return self.value


def preview(op, tenant_policy):
    """flux_service_runtime.preview's VAC-bound fields, from the real helpers."""
    stub("control_plane", __path__=[])
    stub("control_plane.policy_rail", PolicyRail=Rail(tenant_policy))
    intent = canonical.canonical_json_bytes(op)
    obs = runtime._observation_context_preview(None, op)
    if obs.get("hold"):
        raise SystemExit("athena held: " + obs["hold"])
    checks = {
        "service_operation_valid": permits._service_operation(op) == op,
        "intent_is_canonical_bytes": intent == canonical.canonical_json_bytes(json.loads(intent)),
        "state_is_expected_state": obs["state"] == context.expected_state(op, tenant_policy),
        "state_is_domain_bound": obs["state"] == hashlib.sha256((context.NONCE_DOMAIN + "\n" +
            hashlib.sha256(intent).hexdigest() + "\n" +
            hashlib.sha256(obs["json"].encode("ascii")).hexdigest()).encode("ascii")).hexdigest(),
    }
    if op["version"] == 3:
        checks["validate_observation_scope"] = observation.validate_observation_scope(op) == op["artifact_observation"]
        checks["cost_digest_is_cost_contract"] = (op["cost_contract_sha256"] == op["readback"]["cost_contract_sha256"]
            == canonical.canonical_json_hash(observation.cost_contract(op)))
    if not all(checks.values()):
        raise SystemExit("athena self-check failed: " + json.dumps(checks))
    return {"intent_json": intent.decode("ascii"), "intent_hash": hashlib.sha256(intent).hexdigest(),
            "observation_context_json": obs["json"], "state": obs["state"],
            "server_now": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "athena_checks": checks}


fleet_v2 = operation_v2(observation.FLEET_TENANT)
personal_v2 = operation_v2(PERSONAL_TENANT)
cases = {
    "v2_fleet_max_age": preview(fleet_v2, policy(fleet_v2, "max_age", 900)),
    "v3_fleet_max_age": None,
    "v3_personal_historical": None,
}
v3_fleet = observation.with_observation_scope(fleet_v2, connection_binding=connection(
    observation.FLEET_TENANT, observation.FLEET_ACCOUNT))
cases["v3_fleet_max_age"] = preview(v3_fleet, policy(v3_fleet, "max_age", 900))
v3_personal = observation.with_observation_scope(personal_v2, connection_binding=connection(
    PERSONAL_TENANT, "person:" + PRINCIPAL))
cases["v3_personal_historical"] = preview(v3_personal, policy(v3_personal, "owner_accepted_historical", None))

OUT.write_text(json.dumps({
    "athena_commit": COMMIT, "generated_by": "tests/cross_repo/athena_service_operation_probe.py",
    "athena_sources": sorted(p.name for p in (CODE / "canonical.py", CODE / "permits.py",
        CODE / "flux_native_observation.py", CODE / "flux_observation_context.py",
        CODE / "flux_service_runtime.py", CODE / "flux_async_credit_risk.py",
        CODE / "flux_agent_contract.py", CODE / "flux_native_artifact_acceptance.py", CODE / "policy" / "pdp.py")),
    "athena_source_sha256": {p: hashlib.sha256((CODE / p).read_bytes()).hexdigest() for p in (
        "canonical.py", "permits.py", "flux_native_observation.py", "flux_observation_context.py",
        "flux_service_runtime.py", "flux_async_credit_risk.py", "flux_agent_contract.py",
        "flux_native_artifact_acceptance.py", "policy/pdp.py")},
    "cases": cases}, indent=1, sort_keys=True) + "\n")
print(json.dumps({k: v["athena_checks"] for k, v in cases.items()}))
