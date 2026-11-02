from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.ai import router as ai_router
from app.api.catalog import router as catalog_router
from app.api.orders import router as orders_router
from app.api.planner import router as planner_router
from app.api.supply import router as supply_router
from app.config import settings

app = FastAPI(title=settings.app_name, version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-API-Key"],
)
app.include_router(auth_router, prefix=f"{settings.api_prefix}/auth", tags=["authentication"])
app.include_router(catalog_router, prefix=settings.api_prefix, tags=["catalog"])
app.include_router(supply_router, prefix=settings.api_prefix, tags=["inventory and receipts"])
app.include_router(orders_router, prefix=settings.api_prefix, tags=["orders and exceptions"])
app.include_router(planner_router, prefix=settings.api_prefix, tags=["planner and shipments"])
app.include_router(ai_router, prefix=settings.api_prefix, tags=["AI-assisted features"])


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok"}
