from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, Text
from sqlalchemy.orm import relationship
from database import Base
from datetime import datetime


class SystemConfig(Base):
    __tablename__ = "system_config"

    id = Column(Integer, primary_key=True)
    key = Column(String, unique=True, nullable=False)
    value = Column(Text, default="")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ScanClass(Base):
    __tablename__ = "scan_classes"

    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)
    interval_ms = Column(Integer, nullable=False)
    description = Column(Text, default="")
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    tags = relationship("Tag", back_populates="scan_class")


class InfluxDBConfig(Base):
    __tablename__ = "influxdb_configs"

    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)
    url = Column(String, nullable=False)
    token = Column(String, nullable=False)
    org = Column(String, default="")
    bucket = Column(String, nullable=False)
    version = Column(Integer, default=2)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    devices = relationship("Device", back_populates="influxdb_config")


class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)
    endpoint_url = Column(String, nullable=False)
    username = Column(String, default="")
    password = Column(String, default="")
    security_policy = Column(String, default="None")
    influxdb_config_id = Column(Integer, ForeignKey("influxdb_configs.id"), nullable=True)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    influxdb_config = relationship("InfluxDBConfig", back_populates="devices")
    tags = relationship("Tag", back_populates="device", cascade="all, delete-orphan")


class Tag(Base):
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False)
    node_id = Column(String, nullable=False)
    namespace = Column(Integer, nullable=False)
    identifier = Column(String, nullable=False)
    identifier_type = Column(String, default="s")
    display_name = Column(String, nullable=False)
    path = Column(String, default="")
    data_type = Column(String, default="")
    measurement_name = Column(String, default="")
    scan_class_id = Column(Integer, ForeignKey("scan_classes.id"), nullable=True)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    device = relationship("Device", back_populates="tags")
    scan_class = relationship("ScanClass", back_populates="tags")
