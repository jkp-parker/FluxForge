from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os
import threading
import logging

from sqlalchemy import inspect, text
from database import engine, Base, SessionLocal
import models  # noqa: F401 — ensures all models are registered
from routers import system, devices, scan_classes, influxdb_config, metrics, telegraf
from services.opcua_certs import ensure_certs_exist

logger = logging.getLogger(__name__)

# Create all tables
Base.metadata.create_all(bind=engine)

# Lightweight migrations for new columns on existing tables (SQLite)
def _migrate():
    insp = inspect(engine)
    if "scan_classes" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("scan_classes")]
        if "is_default" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE scan_classes ADD COLUMN is_default BOOLEAN DEFAULT 0"))

    if "influxdb_configs" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("influxdb_configs")]
        if "version" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE influxdb_configs ADD COLUMN version INTEGER DEFAULT 2"))

_migrate()

# Generate OPC UA client certificate if it doesn't exist
ensure_certs_exist()

app = FastAPI(
    title="FluxForge",
    version="1.0.0",
    description="Web administration portal for managing OPC UA → Telegraf → InfluxDB pipelines",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(system.router, prefix="/api")
app.include_router(devices.router, prefix="/api")
app.include_router(scan_classes.router, prefix="/api")
app.include_router(influxdb_config.router, prefix="/api")
app.include_router(metrics.router, prefix="/api")
app.include_router(telegraf.router, prefix="/api")

# Auto-scan devices with NodeIncludes on startup so tags are populated
def _startup_scan():
    """Background thread: scan devices that have branch subscriptions."""
    db = SessionLocal()
    try:
        device_ids = [
            r[0] for r in db.query(models.NodeInclude.device_id).distinct().all()
        ]
        if not device_ids:
            return

        for device_id in device_ids:
            device = db.query(models.Device).filter(
                models.Device.id == device_id, models.Device.enabled == True
            ).first()
            if not device:
                continue
            logger.info(f"Startup scan: {device.name} (id={device.id})")
            try:
                devices._do_scan(
                    device.id, device.endpoint_url, device.username, device.password,
                    security_policy=device.security_policy or "None",
                )
            except Exception as e:
                logger.warning(f"Startup scan failed for {device.name}: {e}")
    finally:
        db.close()


@app.on_event("startup")
def on_startup():
    thread = threading.Thread(target=_startup_scan, daemon=True)
    thread.start()


# Serve built React frontend from /app/static
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        index = os.path.join(STATIC_DIR, "index.html")
        return FileResponse(index)
