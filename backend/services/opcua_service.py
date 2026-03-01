import asyncio
import logging
from typing import Optional, List, Dict

from services.opcua_certs import get_cert_path, get_key_path

logger = logging.getLogger(__name__)

# Security policies that require certificates and encryption.
_SECURE_POLICIES = {
    "Basic256Sha256",
    "Aes128_Sha256_RsaOaep",
    "Aes256_Sha256_RsaPss",
}


def _run_async(coro):
    """Run an async coroutine from sync context."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


async def _configure_client(client, security_policy: str, username: str, password: str) -> None:
    """Apply security policy and credentials to an asyncua Client before connecting."""
    if security_policy and security_policy in _SECURE_POLICIES:
        security_string = f"{security_policy},SignAndEncrypt,{get_cert_path()},{get_key_path()}"
        await client.set_security_string(security_string)
    if username and password:
        client.set_user(username)
        client.set_password(password)


async def _test_connection_async(
    endpoint_url: str,
    username: str = "",
    password: str = "",
    security_policy: str = "None",
) -> dict:
    try:
        from asyncua import Client
        client = Client(url=endpoint_url, timeout=10)
        await _configure_client(client, security_policy, username, password)
        async with client:
            name = await client.get_server_node().read_display_name()
            return {"success": True, "message": f"Connected: {name.Text}"}
    except ImportError:
        return {"success": False, "message": "asyncua library not installed"}
    except Exception as e:
        logger.exception("OPC UA connection test failed")
        return {"success": False, "message": str(e)}


async def _browse_node_async(
    endpoint_url: str,
    node_id: Optional[str],
    username: str = "",
    password: str = "",
    security_policy: str = "None",
) -> List[Dict]:
    try:
        from asyncua import Client
        from asyncua.ua import NodeClass

        client = Client(url=endpoint_url, timeout=15)
        await _configure_client(client, security_policy, username, password)

        async with client:
            if node_id:
                node = client.get_node(node_id)
            else:
                node = client.get_objects_node()

            children = await node.get_children()
            result = []

            for child in children:
                try:
                    node_class = await child.read_node_class()
                    browse_name = await child.read_browse_name()
                    display_name = await child.read_display_name()

                    child_nid = child.nodeid
                    namespace = child_nid.NamespaceIndex
                    identifier = child_nid.Identifier

                    if isinstance(identifier, int):
                        identifier_type = "i"
                        identifier_str = str(identifier)
                    elif isinstance(identifier, bytes):
                        identifier_type = "b"
                        identifier_str = identifier.hex()
                    else:
                        identifier_type = "s"
                        identifier_str = str(identifier)

                    is_variable = node_class == NodeClass.Variable
                    has_children = False

                    if not is_variable:
                        try:
                            gc = await child.get_children()
                            has_children = len(gc) > 0
                        except Exception:
                            pass

                    data_type = ""
                    if is_variable:
                        try:
                            dt_node_id = await child.read_data_type()
                            data_type = str(dt_node_id)
                        except Exception:
                            pass

                    result.append({
                        "node_id": child.nodeid.to_string(),
                        "namespace": namespace,
                        "identifier": identifier_str,
                        "identifier_type": identifier_type,
                        "browse_name": browse_name.Name or "",
                        "display_name": (display_name.Text or browse_name.Name or ""),
                        "node_class": node_class.name,
                        "is_variable": is_variable,
                        "has_children": has_children,
                        "data_type": data_type,
                        "path": "",
                    })
                except Exception:
                    continue

            return result
    except ImportError:
        raise RuntimeError("asyncua library not installed")
    except Exception as e:
        raise RuntimeError(f"Browse failed: {e}")


async def _scan_all_variables_async(
    endpoint_url: str,
    username: str = "",
    password: str = "",
    security_policy: str = "None",
    max_depth: int = 8,
) -> List[Dict]:
    try:
        from asyncua import Client
        from asyncua.ua import NodeClass

        client = Client(url=endpoint_url, timeout=60)
        await _configure_client(client, security_policy, username, password)

        variables = []

        async with client:
            async def browse_recursive(node, depth: int, path: str):
                if depth > max_depth:
                    return
                try:
                    children = await node.get_children()
                except Exception:
                    return

                for child in children:
                    try:
                        node_class = await child.read_node_class()
                        display_name = await child.read_display_name()
                        name = display_name.Text or ""
                        current_path = f"{path}/{name}" if path else name

                        child_nid = child.nodeid
                        namespace = child_nid.NamespaceIndex
                        identifier = child_nid.Identifier

                        if isinstance(identifier, int):
                            identifier_type = "i"
                            identifier_str = str(identifier)
                        elif isinstance(identifier, bytes):
                            identifier_type = "b"
                            identifier_str = identifier.hex()
                        else:
                            identifier_type = "s"
                            identifier_str = str(identifier)

                        if node_class == NodeClass.Variable:
                            data_type = ""
                            try:
                                dt_node_id = await child.read_data_type()
                                data_type = str(dt_node_id)
                            except Exception:
                                pass

                            variables.append({
                                "node_id": child.nodeid.to_string(),
                                "namespace": namespace,
                                "identifier": identifier_str,
                                "identifier_type": identifier_type,
                                "browse_name": name,
                                "display_name": name,
                                "node_class": "Variable",
                                "is_variable": True,
                                "has_children": False,
                                "data_type": data_type,
                                "path": current_path,
                            })
                        else:
                            await browse_recursive(child, depth + 1, current_path)
                    except Exception:
                        continue

            objects_node = client.get_objects_node()
            await browse_recursive(objects_node, 0, "")

        return variables
    except ImportError:
        raise RuntimeError("asyncua library not installed")
    except Exception as e:
        raise RuntimeError(f"Scan failed: {e}")


def test_connection(endpoint_url: str, username: str = "", password: str = "", security_policy: str = "None") -> dict:
    return _run_async(_test_connection_async(endpoint_url, username, password, security_policy))


def browse_node(endpoint_url: str, node_id: Optional[str] = None, username: str = "", password: str = "", security_policy: str = "None") -> List[Dict]:
    return _run_async(_browse_node_async(endpoint_url, node_id, username, password, security_policy))


def scan_all_variables(endpoint_url: str, username: str = "", password: str = "", security_policy: str = "None", max_depth: int = 8) -> List[Dict]:
    return _run_async(_scan_all_variables_async(endpoint_url, username, password, security_policy, max_depth))


async def _read_values_async(
    endpoint_url: str,
    node_ids: List[str],
    username: str = "",
    password: str = "",
    security_policy: str = "None",
) -> Dict[str, Dict]:
    try:
        from asyncua import Client, ua

        client = Client(url=endpoint_url, timeout=15)
        await _configure_client(client, security_policy, username, password)

        results = {}
        async with client:
            for nid_str in node_ids:
                try:
                    node = client.get_node(nid_str)
                    dv = await node.read_data_value()
                    val = dv.Value.Value
                    # Convert non-JSON-serializable types
                    if isinstance(val, (bytes, bytearray)):
                        val = val.hex()
                    elif hasattr(val, 'isoformat'):
                        val = val.isoformat()
                    elif isinstance(val, float):
                        if val != val:  # NaN
                            val = None
                    results[nid_str] = {
                        "value": val,
                        "status": dv.StatusCode.name if dv.StatusCode else "Good",
                        "timestamp": dv.SourceTimestamp.isoformat() if dv.SourceTimestamp else None,
                    }
                except Exception as e:
                    results[nid_str] = {"value": None, "status": f"Error: {e}", "timestamp": None}

        return results
    except ImportError:
        raise RuntimeError("asyncua library not installed")
    except Exception as e:
        raise RuntimeError(f"Read values failed: {e}")


def read_values(endpoint_url: str, node_ids: List[str], username: str = "", password: str = "", security_policy: str = "None") -> Dict[str, Dict]:
    return _run_async(_read_values_async(endpoint_url, node_ids, username, password, security_policy))
