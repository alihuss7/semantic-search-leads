#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT_DIR / "backend"
TARGET_PATH = ROOT_DIR / "frontend" / "lib" / "types.ts"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

env_file = BACKEND_DIR / ".env"
if env_file.exists():
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://postgres:password@127.0.0.1:5433/leads_db")
os.environ.setdefault("GOOGLE_AI_API_KEY", "DUMMY_KEY_FOR_TYPE_GENERATION")

from main import app  # noqa: E402

COMPONENT_ORDER = [
    "IngestResponse",
    "ValidationErrorRow",
    "JobStatus",
    "ClusterRequest",
    "ClusterResponse",
    "TsnePoint",
    "TsneResponse",
    "SearchResult",
    "SearchResponse",
]


def _json_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def _identifier(name: str) -> str:
    if re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", name):
        return name
    return _json_string(name)


def _schema_to_ts(schema: dict[str, Any]) -> str:
    ref = schema.get("$ref")
    if isinstance(ref, str):
        return ref.rsplit("/", 1)[-1]

    enum_values = schema.get("enum")
    if isinstance(enum_values, list) and enum_values:
        return " | ".join(_json_string(str(v)) for v in enum_values)

    if "anyOf" in schema:
        parts = [_schema_to_ts(s) for s in schema["anyOf"]]
        return " | ".join(_dedupe(parts))

    if "oneOf" in schema:
        parts = [_schema_to_ts(s) for s in schema["oneOf"]]
        return " | ".join(_dedupe(parts))

    schema_type = schema.get("type")
    if schema_type == "string":
        return "string"
    if schema_type in {"integer", "number"}:
        return "number"
    if schema_type == "boolean":
        return "boolean"
    if schema_type == "null":
        return "null"
    if schema_type == "array":
        return f"Array<{_schema_to_ts(schema.get('items', {}))}>"
    if schema_type == "object":
        props = schema.get("properties")
        if isinstance(props, dict) and props:
            required = set(schema.get("required", []))
            lines = []
            for prop_name, prop_schema in props.items():
                optional = "?" if prop_name not in required else ""
                lines.append(f"  {_identifier(prop_name)}{optional}: {_schema_to_ts(prop_schema)};")
            return "{\n" + "\n".join(lines) + "\n}"

        additional = schema.get("additionalProperties")
        if additional is True or additional is None:
            return "Record<string, unknown>"
        if isinstance(additional, dict):
            return f"Record<string, {_schema_to_ts(additional)}>"
        return "Record<string, unknown>"

    return "unknown"


def _enum_alias(components: dict[str, dict[str, Any]], component: str, prop: str) -> str:
    enum_schema = components[component]["properties"][prop]
    enum_values = enum_schema.get("enum", [])
    return " | ".join(_json_string(str(v)) for v in enum_values)


def _render_component(name: str, schema: dict[str, Any]) -> str:
    schema_type = schema.get("type")
    properties = schema.get("properties")
    if schema_type == "object" and isinstance(properties, dict):
        required = set(schema.get("required", []))
        lines = [f"export interface {name} {{"]
        for prop_name, prop_schema in properties.items():
            optional = "?" if prop_name not in required else ""
            lines.append(f"  {_identifier(prop_name)}{optional}: {_schema_to_ts(prop_schema)};")
        lines.append("}")
        return "\n".join(lines)

    return f"export type {name} = {_schema_to_ts(schema)};"


def main() -> None:
    openapi = app.openapi()
    components = openapi.get("components", {}).get("schemas", {})
    missing = [name for name in COMPONENT_ORDER if name not in components]
    if missing:
        raise RuntimeError(f"Missing expected schema components: {', '.join(missing)}")

    cluster_algorithm = _enum_alias(components, "ClusterRequest", "algorithm")
    distance_metric = _enum_alias(components, "ClusterRequest", "distance_metric")
    linkage_type = _enum_alias(components, "ClusterRequest", "linkage")
    covariance_type = _enum_alias(components, "ClusterRequest", "covariance_type")
    outlier_policy = _enum_alias(components, "ClusterRequest", "outlier_policy")
    auto_tune_objective = _enum_alias(components, "ClusterRequest", "auto_tune_objective")
    ingest_status = _enum_alias(components, "JobStatus", "status")

    blocks = [
        "/*",
        " * AUTO-GENERATED FILE. DO NOT EDIT.",
        " * Source: backend FastAPI OpenAPI schema",
        " * Regenerate with: python3 backend/scripts/generate_frontend_types.py",
        " */",
        "",
        "// Frontend helper request shape",
        "export interface IngestRequest {",
        "  file?: File | null;",
        "  max_rows?: number;",
        "}",
        "",
        f"export type IngestStatus = {ingest_status};",
        f"export type ClusterAlgorithm = {cluster_algorithm};",
        f"export type DistanceMetric = {distance_metric};",
        f"export type LinkageType = {linkage_type};",
        f"export type CovarianceType = {covariance_type};",
        f"export type OutlierPolicy = {outlier_policy};",
        f"export type AutoTuneObjective = {auto_tune_objective};",
        "",
    ]

    for name in COMPONENT_ORDER:
        blocks.append(_render_component(name, components[name]))
        blocks.append("")

    TARGET_PATH.write_text("\n".join(blocks).rstrip() + "\n", encoding="utf-8")
    print(f"Wrote {TARGET_PATH}")


if __name__ == "__main__":
    main()
