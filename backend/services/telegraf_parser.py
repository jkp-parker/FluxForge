"""Parse an existing telegraf.conf and extract InfluxDB targets, OPC-UA devices/tags,
and passthrough sections (everything else)."""

import tomlkit
from tomlkit.items import AoT, Table, Array


def parse_telegraf_config(toml_string: str) -> dict:
    """Parse a Telegraf TOML config string.

    Returns dict with keys:
        influxdb_configs  - list of {name, url, token, org, bucket, version}
        devices           - list of {name, endpoint_url, username, password,
                            security_policy, influxdb_name, tags: [...]}
        passthrough_sections - raw TOML string for non-OPC-UA / non-InfluxDB sections
        warnings          - list of warning strings
    """
    warnings = []
    try:
        doc = tomlkit.parse(toml_string)
    except Exception as e:
        return {
            "influxdb_configs": [],
            "devices": [],
            "passthrough_sections": "",
            "warnings": [f"TOML parse error: {e}"],
        }

    influxdb_configs = []
    devices = []
    passthrough_parts = []

    # --- Extract outputs.influxdb_v2 ---
    outputs = doc.get("outputs", {})
    influx_v2_list = outputs.get("influxdb_v2", [])
    if isinstance(influx_v2_list, (list, AoT)):
        for idx, section in enumerate(influx_v2_list):
            urls = section.get("urls", [])
            url = urls[0] if urls else ""
            token = section.get("token", "")
            org = section.get("organization", section.get("org", ""))
            bucket = section.get("bucket", "")
            name = bucket if bucket else f"influxdb_{idx + 1}"
            influxdb_configs.append({
                "name": name,
                "url": url,
                "token": token,
                "org": org,
                "bucket": bucket,
                "version": 2,
            })
    elif isinstance(influx_v2_list, (dict, Table)):
        urls = influx_v2_list.get("urls", [])
        url = urls[0] if urls else ""
        influxdb_configs.append({
            "name": influx_v2_list.get("bucket", "influxdb_1"),
            "url": url,
            "token": influx_v2_list.get("token", ""),
            "org": influx_v2_list.get("organization", influx_v2_list.get("org", "")),
            "bucket": influx_v2_list.get("bucket", ""),
            "version": 2,
        })

    # Also check for influxdb v1
    influx_v1_list = outputs.get("influxdb", [])
    if influx_v1_list:
        warnings.append("InfluxDB v1 outputs detected — imported as v2 placeholders, review settings")
        if isinstance(influx_v1_list, (list, AoT)):
            for idx, section in enumerate(influx_v1_list):
                urls = section.get("urls", [])
                url = urls[0] if urls else ""
                influxdb_configs.append({
                    "name": section.get("database", f"influxdb_v1_{idx + 1}"),
                    "url": url,
                    "token": "",
                    "org": "",
                    "bucket": section.get("database", ""),
                    "version": 1,
                })

    # --- Extract inputs.opcua ---
    inputs = doc.get("inputs", {})
    opcua_list = inputs.get("opcua", [])
    if isinstance(opcua_list, (dict, Table)):
        opcua_list = [opcua_list]

    if isinstance(opcua_list, (list, AoT)):
        for section in opcua_list:
            endpoint = section.get("endpoint", "")
            name = section.get("name", "")
            username = section.get("username", "")
            password = section.get("password", "")
            security_policy = section.get("security_policy", "None")

            # Try to link to an InfluxDB config — match by looking at name prefix
            influxdb_name = ""
            if influxdb_configs:
                influxdb_name = influxdb_configs[0]["name"]

            tags = []
            nodes = section.get("nodes", [])
            if isinstance(nodes, (list, AoT)):
                for node in nodes:
                    tag_name = node.get("name", "")
                    ns = node.get("namespace", "")
                    identifier = node.get("identifier", "")
                    id_type = node.get("identifier_type", "s")

                    # Parse namespace as int
                    try:
                        ns_int = int(ns) if ns != "" else 0
                    except (ValueError, TypeError):
                        ns_int = 0

                    # Build node_id from namespace + identifier
                    node_id = f"ns={ns_int};{id_type}={identifier}"

                    # Extract measurement from tags table if present
                    measurement = ""
                    node_tags = node.get("tags", {})
                    if isinstance(node_tags, (dict, Table)):
                        measurement = node_tags.get("measurement", "")

                    tags.append({
                        "node_id": node_id,
                        "namespace": ns_int,
                        "identifier": str(identifier),
                        "identifier_type": str(id_type),
                        "display_name": tag_name.replace("_", " ") if tag_name else str(identifier),
                        "measurement_name": measurement,
                    })

            # Also parse [[inputs.opcua.group]] blocks
            groups = section.get("group", [])
            if isinstance(groups, (dict, Table)):
                groups = [groups]
            if isinstance(groups, (list, AoT)):
                for group in groups:
                    group_name = group.get("name", "")
                    group_ns = group.get("namespace", "")
                    group_id_type = group.get("identifier_type", "s")

                    group_nodes = group.get("nodes", [])
                    if isinstance(group_nodes, (list, AoT)):
                        for node in group_nodes:
                            tag_name = node.get("name", "")
                            ns = node.get("namespace", group_ns)
                            id_type = node.get("identifier_type", group_id_type)
                            identifier = node.get("identifier", "")

                            try:
                                ns_int = int(ns) if ns != "" else 0
                            except (ValueError, TypeError):
                                ns_int = 0

                            node_id = f"ns={ns_int};{id_type}={identifier}"

                            measurement = group_name
                            node_tags = node.get("tags", {})
                            if isinstance(node_tags, (dict, Table)):
                                measurement = node_tags.get("measurement", measurement)

                            tags.append({
                                "node_id": node_id,
                                "namespace": ns_int,
                                "identifier": str(identifier),
                                "identifier_type": str(id_type),
                                "display_name": tag_name.replace("_", " ") if tag_name else str(identifier),
                                "measurement_name": measurement,
                            })

            # Derive device name from the name field or endpoint
            device_name = name or _name_from_endpoint(endpoint)

            devices.append({
                "name": device_name,
                "endpoint_url": endpoint,
                "username": username or "",
                "password": password or "",
                "security_policy": security_policy or "None",
                "influxdb_name": influxdb_name,
                "tags": tags,
            })

    # --- Collect passthrough sections (everything not agent, outputs.influxdb*, inputs.opcua) ---
    passthrough_parts = _extract_passthrough(doc)

    if not influxdb_configs and not devices:
        warnings.append("No InfluxDB outputs or OPC-UA inputs found in the config")

    return {
        "influxdb_configs": influxdb_configs,
        "devices": devices,
        "passthrough_sections": "\n".join(passthrough_parts),
        "warnings": warnings,
    }


def _name_from_endpoint(endpoint: str) -> str:
    """Derive a device name from an OPC-UA endpoint URL."""
    if not endpoint:
        return "unknown_device"
    # opc.tcp://hostname:port/path → hostname
    try:
        from urllib.parse import urlparse
        parsed = urlparse(endpoint)
        host = parsed.hostname or "unknown"
        return host.replace(".", "_").replace("-", "_")
    except Exception:
        return "unknown_device"


def _extract_passthrough(doc) -> list:
    """Extract non-agent, non-influxdb-v2, non-opcua sections as raw TOML strings."""
    parts = []

    # Known keys to skip
    skip_top = {"agent"}
    skip_outputs = {"influxdb_v2", "influxdb"}
    skip_inputs = {"opcua"}

    for key in doc:
        if key in skip_top:
            continue

        if key == "outputs":
            outputs = doc[key]
            for out_key in outputs:
                if out_key in skip_outputs:
                    continue
                # Passthrough output
                parts.append(_serialize_section(f"outputs.{out_key}", outputs[out_key]))
            continue

        if key == "inputs":
            inputs = doc[key]
            for in_key in inputs:
                if in_key in skip_inputs:
                    continue
                # Passthrough input
                parts.append(_serialize_section(f"inputs.{in_key}", inputs[in_key]))
            continue

        # Any other top-level section (global_tags, processors, aggregators, etc.)
        parts.append(_serialize_section(key, doc[key]))

    return [p for p in parts if p.strip()]


def _serialize_section(key: str, value) -> str:
    """Serialize a TOML section back to string."""
    try:
        # Create a minimal tomlkit doc with just this section
        if isinstance(value, (list, AoT)):
            # Array of tables
            lines = []
            for item in value:
                tmp = tomlkit.document()
                # Use nested key structure
                parts = key.split(".")
                if len(parts) == 2:
                    outer = tomlkit.table(is_super_table=True)
                    inner_aot = tomlkit.aot()
                    inner_item = tomlkit.table()
                    for k, v in item.items():
                        inner_item.add(k, v)
                    inner_aot.append(inner_item)
                    outer.add(parts[1], inner_aot)
                    tmp.add(parts[0], outer)
                else:
                    aot = tomlkit.aot()
                    tbl = tomlkit.table()
                    for k, v in item.items():
                        tbl.add(k, v)
                    aot.append(tbl)
                    tmp.add(key, aot)
                lines.append(tomlkit.dumps(tmp))
            return "\n".join(lines)
        else:
            tmp = tomlkit.document()
            parts = key.split(".")
            if len(parts) == 2:
                outer = tomlkit.table(is_super_table=True)
                inner = tomlkit.table()
                for k, v in value.items():
                    inner.add(k, v)
                outer.add(parts[1], inner)
                tmp.add(parts[0], outer)
            else:
                tmp.add(key, value)
            return tomlkit.dumps(tmp)
    except Exception:
        # Fallback: just format as comment
        return f"# Could not serialize section [{key}]\n"
