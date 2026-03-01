from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse, Response
from sqlalchemy.orm import Session, joinedload
from database import get_db
import models
import schemas
from services import telegraf_generator
from services.telegraf_parser import parse_telegraf_config
from routers.system import _get_config_dict, _set_key
from routers.devices import _scan_cache

router = APIRouter(prefix="/telegraf", tags=["telegraf"])


def _load_devices(db: Session):
    return db.query(models.Device).options(
        joinedload(models.Device.tags).joinedload(models.Tag.scan_class),
        joinedload(models.Device.node_includes).joinedload(models.NodeInclude.scan_class),
        joinedload(models.Device.influxdb_config),
    ).filter(models.Device.enabled == True).order_by(models.Device.name).all()


def _get_default_influxdb(db: Session):
    return db.query(models.InfluxDBConfig).filter(
        models.InfluxDBConfig.is_default == True
    ).first()


def _get_default_scan_class(db: Session):
    return db.query(models.ScanClass).filter(
        models.ScanClass.is_default == True
    ).first()


@router.get("/config", response_class=PlainTextResponse)
def get_config(db: Session = Depends(get_db)):
    # Check for manual override
    override = db.query(models.SystemConfig).filter(
        models.SystemConfig.key == "telegraf_config_override"
    ).first()
    if override and override.value:
        return PlainTextResponse(
            content=override.value,
            headers={"X-Config-Mode": "override"},
        )

    devices = _load_devices(db)
    system_cfg = _get_config_dict(db)
    default_influx = _get_default_influxdb(db)
    default_sc = _get_default_scan_class(db)
    content = telegraf_generator.generate_config(devices, system_cfg, default_influx, scan_cache=_scan_cache, default_scan_class=default_sc)
    return PlainTextResponse(
        content=content,
        headers={"X-Config-Mode": "generated"},
    )


@router.get("/config/download")
def download_config(db: Session = Depends(get_db)):
    # Check for manual override
    override = db.query(models.SystemConfig).filter(
        models.SystemConfig.key == "telegraf_config_override"
    ).first()
    if override and override.value:
        content = override.value
    else:
        devices = _load_devices(db)
        system_cfg = _get_config_dict(db)
        default_influx = _get_default_influxdb(db)
        default_sc = _get_default_scan_class(db)
        content = telegraf_generator.generate_config(devices, system_cfg, default_influx, scan_cache=_scan_cache, default_scan_class=default_sc)
    return Response(
        content=content,
        media_type="text/plain",
        headers={"Content-Disposition": "attachment; filename=telegraf.conf"},
    )


# --- Manual Override ---

@router.put("/config/override")
def save_override(payload: schemas.ConfigSaveRequest, db: Session = Depends(get_db)):
    _set_key(db, "telegraf_config_override", payload.content)
    db.commit()
    return {"status": "saved"}


@router.delete("/config/override")
def revert_override(db: Session = Depends(get_db)):
    row = db.query(models.SystemConfig).filter(
        models.SystemConfig.key == "telegraf_config_override"
    ).first()
    if row:
        db.delete(row)
        db.commit()
    return {"status": "reverted"}


# --- Import ---

@router.post("/import/preview", response_model=schemas.ImportPreviewResponse)
def import_preview(payload: schemas.ConfigSaveRequest):
    result = parse_telegraf_config(payload.content)
    return schemas.ImportPreviewResponse(
        influxdb_configs=[schemas.ImportPreviewInflux(**c) for c in result["influxdb_configs"]],
        devices=[schemas.ImportPreviewDevice(
            **{k: v for k, v in d.items() if k != "tags"},
            tags=[schemas.ImportPreviewTag(**t) for t in d["tags"]],
        ) for d in result["devices"]],
        passthrough_sections=result["passthrough_sections"],
        warnings=result["warnings"],
    )


@router.post("/import/confirm", response_model=schemas.ImportConfirmResponse)
def import_confirm(payload: schemas.ImportConfirmRequest, db: Session = Depends(get_db)):
    warnings = []
    influxdb_created = 0
    influxdb_skipped = 0
    devices_created = 0
    devices_skipped = 0
    tags_created = 0

    # Map influxdb name → db id for device linking
    influx_name_to_id = {}

    # Create InfluxDB configs
    for cfg in payload.influxdb_configs:
        existing = db.query(models.InfluxDBConfig).filter(
            models.InfluxDBConfig.name == cfg.name
        ).first()
        if existing:
            if payload.skip_existing:
                influxdb_skipped += 1
                influx_name_to_id[cfg.name] = existing.id
                continue
            else:
                # Update existing
                existing.url = cfg.url
                existing.token = cfg.token
                existing.org = cfg.org
                existing.bucket = cfg.bucket
                existing.version = cfg.version
                influx_name_to_id[cfg.name] = existing.id
                influxdb_created += 1
                continue

        new_cfg = models.InfluxDBConfig(
            name=cfg.name,
            url=cfg.url,
            token=cfg.token,
            org=cfg.org,
            bucket=cfg.bucket,
            version=cfg.version,
        )
        db.add(new_cfg)
        db.flush()
        influx_name_to_id[cfg.name] = new_cfg.id
        influxdb_created += 1

    # Get default scan class
    default_sc = db.query(models.ScanClass).filter(
        models.ScanClass.is_default == True
    ).first()
    default_sc_id = default_sc.id if default_sc else None

    # Create devices + tags
    for dev in payload.devices:
        existing = db.query(models.Device).filter(
            models.Device.name == dev.name
        ).first()
        if existing:
            if payload.skip_existing:
                devices_skipped += 1
                continue
            else:
                device = existing
                devices_created += 1
        else:
            influx_id = influx_name_to_id.get(dev.influxdb_name)
            device = models.Device(
                name=dev.name,
                endpoint_url=dev.endpoint_url,
                username=dev.username,
                password=dev.password,
                security_policy=dev.security_policy,
                influxdb_config_id=influx_id,
            )
            db.add(device)
            db.flush()
            devices_created += 1

        # Add tags
        for tag in dev.tags:
            existing_tag = db.query(models.Tag).filter(
                models.Tag.device_id == device.id,
                models.Tag.node_id == tag.node_id,
            ).first()
            if existing_tag:
                continue

            new_tag = models.Tag(
                device_id=device.id,
                node_id=tag.node_id,
                namespace=tag.namespace,
                identifier=tag.identifier,
                identifier_type=tag.identifier_type,
                display_name=tag.display_name,
                measurement_name=tag.measurement_name,
                scan_class_id=default_sc_id,
                enabled=True,
            )
            db.add(new_tag)
            tags_created += 1

    # Save passthrough sections
    passthrough_saved = False
    if payload.passthrough_sections.strip():
        _set_key(db, "telegraf_passthrough", payload.passthrough_sections)
        passthrough_saved = True

    db.commit()

    return schemas.ImportConfirmResponse(
        influxdb_created=influxdb_created,
        influxdb_skipped=influxdb_skipped,
        devices_created=devices_created,
        devices_skipped=devices_skipped,
        tags_created=tags_created,
        passthrough_saved=passthrough_saved,
        warnings=warnings,
    )
