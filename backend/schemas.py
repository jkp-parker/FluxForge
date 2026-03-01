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


class SystemConfigUpdate(BaseModel):
    influxdb_url: Optional[str] = ""
    influxdb_token: Optional[str] = ""
    influxdb_org: Optional[str] = ""
    influxdb_default_bucket: Optional[str] = ""
    telegraf_config_path: Optional[str] = "/etc/telegraf/telegraf.conf"
    telegraf_reload_command: Optional[str] = "systemctl reload telegraf"
    app_title: Optional[str] = "FluxForge"


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
