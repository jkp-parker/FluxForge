from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
import models

router = APIRouter(prefix="/metrics", tags=["metrics"])


@router.get("")
def get_metrics(db: Session = Depends(get_db)):
    total_devices = db.query(models.Device).count()
    enabled_devices = db.query(models.Device).filter(models.Device.enabled == True).count()
    total_tags = db.query(models.Tag).count()
    enabled_tags = db.query(models.Tag).filter(models.Tag.enabled == True).count()
    scan_class_count = db.query(models.ScanClass).count()
    influxdb_count = db.query(models.InfluxDBConfig).count()
    instance_count = db.query(models.TelegrafInstance).count()

    # Tags per scan class
    scan_classes = db.query(models.ScanClass).order_by(models.ScanClass.interval_ms).all()
    tags_by_scan_class = []
    for sc in scan_classes:
        count = db.query(models.Tag).filter(
            models.Tag.scan_class_id == sc.id, models.Tag.enabled == True
        ).count()
        tags_by_scan_class.append({
            "name": sc.name,
            "interval_ms": sc.interval_ms,
            "tag_count": count,
        })

    unassigned_tags = db.query(models.Tag).filter(
        models.Tag.scan_class_id == None, models.Tag.enabled == True
    ).count()
    if unassigned_tags > 0:
        tags_by_scan_class.append({
            "name": "Unassigned",
            "interval_ms": 0,
            "tag_count": unassigned_tags,
        })

    # Tags grouped by instance AND scan class (for sankey diagram)
    instances = db.query(models.TelegrafInstance).order_by(models.TelegrafInstance.name).all()
    instance_map = {inst.id: inst.name for inst in instances}

    tags_by_instance_scan_class = []
    for inst in instances:
        for sc in scan_classes:
            count = db.query(models.Tag).filter(
                models.Tag.telegraf_instance_id == inst.id,
                models.Tag.scan_class_id == sc.id,
                models.Tag.enabled == True,
            ).count()
            if count > 0:
                tags_by_instance_scan_class.append({
                    "instance_name": inst.name,
                    "scan_class_name": sc.name,
                    "tag_count": count,
                })
        # Unassigned scan class for this instance
        count = db.query(models.Tag).filter(
            models.Tag.telegraf_instance_id == inst.id,
            models.Tag.scan_class_id == None,
            models.Tag.enabled == True,
        ).count()
        if count > 0:
            tags_by_instance_scan_class.append({
                "instance_name": inst.name,
                "scan_class_name": "Unassigned",
                "tag_count": count,
            })

    # Tags with no instance assigned
    for sc in scan_classes:
        count = db.query(models.Tag).filter(
            models.Tag.telegraf_instance_id == None,
            models.Tag.scan_class_id == sc.id,
            models.Tag.enabled == True,
        ).count()
        if count > 0:
            tags_by_instance_scan_class.append({
                "instance_name": "Unassigned",
                "scan_class_name": sc.name,
                "tag_count": count,
            })
    count = db.query(models.Tag).filter(
        models.Tag.telegraf_instance_id == None,
        models.Tag.scan_class_id == None,
        models.Tag.enabled == True,
    ).count()
    if count > 0:
        tags_by_instance_scan_class.append({
            "instance_name": "Unassigned",
            "scan_class_name": "Unassigned",
            "tag_count": count,
        })

    # Devices with their tag counts, influxdb targets, and instance names
    devices = db.query(models.Device).order_by(models.Device.name).all()
    device_summary = []
    for d in devices:
        tag_count = db.query(models.Tag).filter(
            models.Tag.device_id == d.id, models.Tag.enabled == True
        ).count()
        influx_name = None
        if d.influxdb_config_id:
            cfg = db.query(models.InfluxDBConfig).filter(
                models.InfluxDBConfig.id == d.influxdb_config_id
            ).first()
            if cfg:
                influx_name = cfg.name
        instance_name = None
        if d.telegraf_instance_id:
            inst = db.query(models.TelegrafInstance).filter(
                models.TelegrafInstance.id == d.telegraf_instance_id
            ).first()
            if inst:
                instance_name = inst.name
        device_summary.append({
            "id": d.id,
            "name": d.name,
            "endpoint_url": d.endpoint_url,
            "enabled": d.enabled,
            "enabled_tag_count": tag_count,
            "influxdb_name": influx_name,
            "instance_name": instance_name,
        })

    # InfluxDB config summaries
    influx_configs = db.query(models.InfluxDBConfig).all()
    influx_summary = []
    for cfg in influx_configs:
        device_count = db.query(models.Device).filter(
            models.Device.influxdb_config_id == cfg.id
        ).count()
        tag_count = db.query(models.Tag).join(models.Device).filter(
            models.Device.influxdb_config_id == cfg.id,
            models.Tag.enabled == True,
        ).count()
        influx_summary.append({
            "id": cfg.id,
            "name": cfg.name,
            "url": cfg.url,
            "org": cfg.org,
            "bucket": cfg.bucket,
            "is_default": cfg.is_default,
            "device_count": device_count,
            "tag_count": tag_count,
        })

    # Instance summaries
    instance_summary = []
    for inst in instances:
        device_count = db.query(models.Device).filter(
            models.Device.telegraf_instance_id == inst.id
        ).count()
        tag_count = db.query(models.Tag).filter(
            models.Tag.telegraf_instance_id == inst.id,
            models.Tag.enabled == True,
        ).count()
        instance_summary.append({
            "id": inst.id,
            "name": inst.name,
            "enabled": inst.enabled,
            "device_count": device_count,
            "tag_count": tag_count,
        })

    # Flow diagram data: devices -> instances -> influx targets
    flow_links = []
    for d in devices:
        if not d.enabled:
            continue
        tag_count_for_device = db.query(models.Tag).filter(
            models.Tag.device_id == d.id, models.Tag.enabled == True
        ).count()
        inst_name = None
        if d.telegraf_instance_id:
            inst_name = instance_map.get(d.telegraf_instance_id)
        if inst_name and tag_count_for_device > 0:
            flow_links.append({
                "source_type": "device",
                "source": d.name,
                "target_type": "instance",
                "target": inst_name,
                "tag_count": tag_count_for_device,
            })

    for inst in instances:
        if not inst.enabled:
            continue
        # Find unique influx targets for devices in this instance
        inst_devices = db.query(models.Device).filter(
            models.Device.telegraf_instance_id == inst.id,
            models.Device.enabled == True,
        ).all()
        influx_tag_counts = {}
        for d in inst_devices:
            if d.influxdb_config_id:
                cfg = db.query(models.InfluxDBConfig).filter(
                    models.InfluxDBConfig.id == d.influxdb_config_id
                ).first()
                if cfg:
                    tc = db.query(models.Tag).filter(
                        models.Tag.device_id == d.id,
                        models.Tag.enabled == True,
                    ).count()
                    influx_tag_counts[cfg.name] = influx_tag_counts.get(cfg.name, 0) + tc
        for influx_name, tc in influx_tag_counts.items():
            if tc > 0:
                flow_links.append({
                    "source_type": "instance",
                    "source": inst.name,
                    "target_type": "influx",
                    "target": influx_name,
                    "tag_count": tc,
                })

    return {
        "total_devices": total_devices,
        "enabled_devices": enabled_devices,
        "total_tags": total_tags,
        "enabled_tags": enabled_tags,
        "scan_class_count": scan_class_count,
        "influxdb_count": influxdb_count,
        "instance_count": instance_count,
        "tags_by_scan_class": tags_by_scan_class,
        "tags_by_instance_scan_class": tags_by_instance_scan_class,
        "device_summary": device_summary,
        "influx_summary": influx_summary,
        "instance_summary": instance_summary,
        "flow_links": flow_links,
    }
