from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class SystemConfigItem(BaseModel):
    key: str
    value: str


class SystemConfigOut(BaseModel):
    setup_complete: bool
    influxdb_url: str
    influxdb_token: str
    influxdb_org: str
    influxdb_default_bucket: str
    telegraf_config_path: str
    telegraf_reload_command: str
    app_title: str
    # Telegraf agent settings
    agent_round_interval: bool
    agent_metric_batch_size: int
    agent_metric_buffer_limit: int
    agent_collection_jitter: str
    agent_flush_interval: str
    agent_flush_jitter: str
    agent_hostname: str
    agent_omit_hostname: bool


class SystemConfigUpdate(BaseModel):
    influxdb_url: Optional[str] = ""
    influxdb_token: Optional[str] = ""
    influxdb_org: Optional[str] = ""
    influxdb_default_bucket: Optional[str] = ""
    telegraf_config_path: Optional[str] = "/etc/telegraf/telegraf.conf"
    telegraf_reload_command: Optional[str] = "systemctl reload telegraf"
    app_title: Optional[str] = "FluxForge"
    # Telegraf agent settings
    agent_round_interval: Optional[bool] = True
    agent_metric_batch_size: Optional[int] = 1000
    agent_metric_buffer_limit: Optional[int] = 10000
    agent_collection_jitter: Optional[str] = "0s"
    agent_flush_interval: Optional[str] = "10s"
    agent_flush_jitter: Optional[str] = "0s"
    agent_hostname: Optional[str] = ""
    agent_omit_hostname: Optional[bool] = False


# ScanClass schemas
class ScanClassBase(BaseModel):
    name: str
    interval_ms: int
    description: Optional[str] = ""


class ScanClassCreate(ScanClassBase):
    pass


class ScanClassUpdate(ScanClassBase):
    pass


class ScanClassOut(ScanClassBase):
    id: int
    is_default: bool = False
    created_at: datetime
    tag_count: Optional[int] = 0

    class Config:
        from_attributes = True


# InfluxDB schemas
class InfluxDBConfigBase(BaseModel):
    name: str
    url: str
    token: str
    org: Optional[str] = ""
    bucket: str
    version: Optional[int] = 2
    is_default: Optional[bool] = False


class InfluxDBConfigCreate(InfluxDBConfigBase):
    pass


class InfluxDBConfigUpdate(InfluxDBConfigBase):
    pass


class InfluxDBConfigOut(InfluxDBConfigBase):
    id: int
    created_at: datetime
    device_count: Optional[int] = 0

    class Config:
        from_attributes = True


# Device schemas
class DeviceBase(BaseModel):
    name: str
    endpoint_url: str
    username: Optional[str] = ""
    password: Optional[str] = ""
    security_policy: Optional[str] = "None"
    influxdb_config_id: Optional[int] = None
    enabled: Optional[bool] = True


class DeviceCreate(DeviceBase):
    pass


class DeviceUpdate(DeviceBase):
    pass


class DeviceOut(DeviceBase):
    id: int
    created_at: datetime
    updated_at: datetime
    tag_count: Optional[int] = 0
    enabled_tag_count: Optional[int] = 0
    influxdb_name: Optional[str] = None

    class Config:
        from_attributes = True


# Tag schemas
class TagBase(BaseModel):
    node_id: str
    namespace: int
    identifier: str
    identifier_type: Optional[str] = "s"
    display_name: str
    path: Optional[str] = ""
    data_type: Optional[str] = ""
    measurement_name: Optional[str] = ""
    scan_class_id: Optional[int] = None
    enabled: Optional[bool] = True


class TagCreate(TagBase):
    device_id: int


class TagUpdate(BaseModel):
    measurement_name: Optional[str] = None
    scan_class_id: Optional[int] = None
    enabled: Optional[bool] = None


class TagOut(TagBase):
    id: int
    device_id: int
    created_at: datetime
    scan_class_name: Optional[str] = None

    class Config:
        from_attributes = True


class BulkTagSave(BaseModel):
    tags: List[TagCreate]


# NodeInclude schemas
class NodeIncludeBase(BaseModel):
    parent_node_id: str
    parent_path: Optional[str] = ""
    namespace: Optional[int] = 0
    identifier: Optional[str] = ""
    identifier_type: Optional[str] = "s"
    display_name: str
    measurement_name: Optional[str] = ""
    scan_class_id: Optional[int] = None
    enabled: Optional[bool] = True


class NodeIncludeCreate(NodeIncludeBase):
    device_id: int


class NodeIncludeUpdate(BaseModel):
    measurement_name: Optional[str] = None
    scan_class_id: Optional[int] = None
    enabled: Optional[bool] = None


class NodeIncludeOut(NodeIncludeBase):
    id: int
    device_id: int
    created_at: datetime
    scan_class_name: Optional[str] = None

    class Config:
        from_attributes = True


# Telegraf Import schemas
class ImportPreviewTag(BaseModel):
    node_id: str
    namespace: int
    identifier: str
    identifier_type: str = "s"
    display_name: str
    measurement_name: str = ""


class ImportPreviewDevice(BaseModel):
    name: str
    endpoint_url: str
    username: str = ""
    password: str = ""
    security_policy: str = "None"
    influxdb_name: str = ""
    tags: List[ImportPreviewTag] = []


class ImportPreviewInflux(BaseModel):
    name: str
    url: str
    token: str
    org: str = ""
    bucket: str
    version: int = 2


class ImportPreviewResponse(BaseModel):
    influxdb_configs: List[ImportPreviewInflux] = []
    devices: List[ImportPreviewDevice] = []
    passthrough_sections: str = ""
    warnings: List[str] = []


class ImportConfirmRequest(BaseModel):
    influxdb_configs: List[ImportPreviewInflux] = []
    devices: List[ImportPreviewDevice] = []
    passthrough_sections: str = ""
    skip_existing: bool = True


class ImportConfirmResponse(BaseModel):
    influxdb_created: int = 0
    influxdb_skipped: int = 0
    devices_created: int = 0
    devices_skipped: int = 0
    tags_created: int = 0
    passthrough_saved: bool = False
    warnings: List[str] = []


class ConfigSaveRequest(BaseModel):
    content: str


class OpcuaTestRequest(BaseModel):
    endpoint_url: str
    username: Optional[str] = ""
    password: Optional[str] = ""
    security_policy: Optional[str] = "None"


class InfluxTestRequest(BaseModel):
    url: str
    token: str
    org: Optional[str] = ""


class OpcuaNodeOut(BaseModel):
    node_id: str
    namespace: int
    identifier: str
    identifier_type: str
    display_name: str
    browse_name: str
    path: Optional[str] = ""
    node_class: str
    is_variable: bool
    has_children: bool
    data_type: Optional[str] = ""
