from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
import models
import schemas

router = APIRouter(prefix="/system", tags=["system"])

SYSTEM_KEYS = [
    "setup_complete",
    "influxdb_url",
    "influxdb_token",
    "influxdb_org",
    "influxdb_default_bucket",
    "telegraf_config_path",
    "telegraf_reload_command",
    "app_title",
]

DEFAULTS = {
    "setup_complete": "false",
    "influxdb_url": "",
    "influxdb_token": "",
    "influxdb_org": "",
    "influxdb_default_bucket": "",
    "telegraf_config_path": "/etc/telegraf/telegraf.conf",
    "telegraf_reload_command": "systemctl reload telegraf",
    "app_title": "FluxForge",
    "agent_round_interval": "true",
    "agent_metric_batch_size": "1000",
    "agent_metric_buffer_limit": "10000",
    "agent_collection_jitter": "0s",
    "agent_flush_interval": "10s",
    "agent_flush_jitter": "0s",
    "agent_hostname": "",
    "agent_omit_hostname": "false",
}


def _get_config_dict(db: Session) -> dict:
    rows = db.query(models.SystemConfig).all()
    cfg = dict(DEFAULTS)
    for row in rows:
        cfg[row.key] = row.value
    return cfg


def _set_key(db: Session, key: str, value: str):
    row = db.query(models.SystemConfig).filter(models.SystemConfig.key == key).first()
    if row:
        row.value = value
    else:
        row = models.SystemConfig(key=key, value=value)
        db.add(row)


@router.get("/config", response_model=schemas.SystemConfigOut)
def get_config(db: Session = Depends(get_db)):
    cfg = _get_config_dict(db)
    return schemas.SystemConfigOut(
        setup_complete=cfg.get("setup_complete", "false").lower() == "true",
        influxdb_url=cfg.get("influxdb_url", ""),
        influxdb_token=cfg.get("influxdb_token", ""),
        influxdb_org=cfg.get("influxdb_org", ""),
        influxdb_default_bucket=cfg.get("influxdb_default_bucket", ""),
        telegraf_config_path=cfg.get("telegraf_config_path", "/etc/telegraf/telegraf.conf"),
        telegraf_reload_command=cfg.get("telegraf_reload_command", "systemctl reload telegraf"),
        app_title=cfg.get("app_title", "FluxForge"),
        agent_round_interval=cfg.get("agent_round_interval", "true").lower() == "true",
        agent_metric_batch_size=int(cfg.get("agent_metric_batch_size", "1000")),
        agent_metric_buffer_limit=int(cfg.get("agent_metric_buffer_limit", "10000")),
        agent_collection_jitter=cfg.get("agent_collection_jitter", "0s"),
        agent_flush_interval=cfg.get("agent_flush_interval", "10s"),
        agent_flush_jitter=cfg.get("agent_flush_jitter", "0s"),
        agent_hostname=cfg.get("agent_hostname", ""),
        agent_omit_hostname=cfg.get("agent_omit_hostname", "false").lower() == "true",
    )


@router.put("/config", response_model=schemas.SystemConfigOut)
def update_config(payload: schemas.SystemConfigUpdate, db: Session = Depends(get_db)):
    fields = {
        "influxdb_url": payload.influxdb_url or "",
        "influxdb_token": payload.influxdb_token or "",
        "influxdb_org": payload.influxdb_org or "",
        "influxdb_default_bucket": payload.influxdb_default_bucket or "",
        "telegraf_config_path": payload.telegraf_config_path or "/etc/telegraf/telegraf.conf",
        "telegraf_reload_command": payload.telegraf_reload_command or "systemctl reload telegraf",
        "app_title": payload.app_title or "FluxForge",
        "setup_complete": "true",
        "agent_round_interval": str(payload.agent_round_interval).lower(),
        "agent_metric_batch_size": str(payload.agent_metric_batch_size),
        "agent_metric_buffer_limit": str(payload.agent_metric_buffer_limit),
        "agent_collection_jitter": payload.agent_collection_jitter or "0s",
        "agent_flush_interval": payload.agent_flush_interval or "10s",
        "agent_flush_jitter": payload.agent_flush_jitter or "0s",
        "agent_hostname": payload.agent_hostname or "",
        "agent_omit_hostname": str(payload.agent_omit_hostname).lower(),
    }
    for key, value in fields.items():
        _set_key(db, key, value)
    db.commit()
    return get_config(db)


@router.post("/config/test-influxdb")
def test_influxdb(db: Session = Depends(get_db)):
    from services import influxdb_service
    cfg = _get_config_dict(db)
    result = influxdb_service.test_connection(
        cfg.get("influxdb_url", ""),
        cfg.get("influxdb_token", ""),
        cfg.get("influxdb_org", ""),
    )
    return result
