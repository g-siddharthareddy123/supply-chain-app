from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import require_auth
from app.db import get_db
from app.models import (
    Allocation, AllocationStatus, InboundReceipt, Inventory, Location, OrderLine, Product, ReceiptStatus,
)
from app.schemas import InventoryAdjust, ReceiptCreate, ReceiptUpdate
from app.services.audit import audit
from app.services.planning import rebuild_allocations

router = APIRouter(dependencies=[Depends(require_auth)])


@router.get("/inventory")
def list_inventory(product_id: int | None = None, sku: str | None = None, location_id: int | None = None,
                   db: Session = Depends(get_db)):
    query = select(Inventory).join(Inventory.product).join(Inventory.location)
    if product_id is not None:
        query = query.where(Inventory.product_id == product_id)
    if sku is not None:
        query = query.where(Inventory.product.has(sku=sku))
    if location_id is not None:
        query = query.where(Inventory.location_id == location_id)
    return db.scalars(query.order_by(Inventory.product_id, Inventory.location_id)).all()


@router.post("/inventory/adjust")
def adjust_inventory(payload: InventoryAdjust, db: Session = Depends(get_db)):
    if payload.delta == 0:
        raise HTTPException(422, "Adjustment delta must not be zero")
    if not payload.reason.strip():
        raise HTTPException(422, "A reason is required")
    with db.begin():
        if not db.get(Product, payload.product_id) or not db.get(Location, payload.location_id):
            raise HTTPException(404, "Product or location not found")
        row = db.scalar(select(Inventory).where(
            Inventory.product_id == payload.product_id,
            Inventory.location_id == payload.location_id,
        ).with_for_update())
        if row is None:
            row = Inventory(product_id=payload.product_id, location_id=payload.location_id, quantity=0)
            db.add(row)
            db.flush()
        updated = Decimal(row.quantity) + payload.delta
        if updated < 0:
            raise HTTPException(409, "Adjustment would make on-hand inventory negative")
        row.quantity = updated
        audit(db, "inventory", row.id, "ADJUST", payload.reason,
              f"delta={payload.delta}; resulting_quantity={updated}")
        rebuild_allocations(db)
    return {"product_id": payload.product_id, "location_id": payload.location_id, "quantity": updated}


@router.get("/receipts")
def list_receipts(db: Session = Depends(get_db)):
    return db.scalars(select(InboundReceipt).order_by(InboundReceipt.expected_arrival)).all()


@router.post("/receipts", status_code=status.HTTP_201_CREATED)
def create_receipt(payload: ReceiptCreate, db: Session = Depends(get_db)):
    if not db.get(Product, payload.product_id) or not db.get(Location, payload.location_id):
        raise HTTPException(404, "Product or location not found")
    receipt = InboundReceipt(**payload.model_dump())
    db.add(receipt)
    try:
        with db.begin_nested():
            db.flush()
            audit(db, "receipt", receipt.id, "CREATE", "Receipt created")
            rebuild_allocations(db)
        db.commit()
        db.refresh(receipt)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Receipt code already exists or referenced product/location is invalid") from exc
    return receipt


@router.get("/receipts/{receipt_id}")
def get_receipt(receipt_id: int, db: Session = Depends(get_db)):
    receipt = db.get(InboundReceipt, receipt_id)
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    return receipt


@router.patch("/receipts/{receipt_id}")
def update_receipt(receipt_id: int, payload: ReceiptUpdate, reason: str,
                   db: Session = Depends(get_db)):
    if not reason.strip():
        raise HTTPException(422, "A reason is required")
    with db.begin():
        receipt = db.scalar(select(InboundReceipt).where(InboundReceipt.id == receipt_id).with_for_update())
        if not receipt:
            raise HTTPException(404, "Receipt not found")
        if receipt.status in (ReceiptStatus.RECEIVED, ReceiptStatus.CANCELED):
            raise HTTPException(409, f"Cannot update a {receipt.status.value.lower()} receipt")
        changes = payload.model_dump(exclude_unset=True)
        if changes.get("status") == ReceiptStatus.RECEIVED:
            raise HTTPException(422, "Use the receive endpoint to mark a receipt received")
        if changes.get("status") == ReceiptStatus.CANCELED:
            raise HTTPException(422, "Use the cancel endpoint to cancel a receipt")
        for key, value in changes.items():
            setattr(receipt, key, value)
        audit(db, "receipt", receipt.id, "UPDATE", reason, str(changes))
        rebuild_allocations(db)
    return receipt


@router.post("/receipts/{receipt_id}/receive")
def receive_receipt(receipt_id: int, reason: str = "Receipt received", db: Session = Depends(get_db)):
    if not reason.strip():
        raise HTTPException(422, "A reason is required")
    with db.begin():
        receipt = db.scalar(select(InboundReceipt).where(InboundReceipt.id == receipt_id).with_for_update())
        if not receipt:
            raise HTTPException(404, "Receipt not found")
        if receipt.status == ReceiptStatus.RECEIVED:
            return {"receipt_id": receipt.id, "status": receipt.status.value, "already_received": True}
        if receipt.status == ReceiptStatus.CANCELED:
            raise HTTPException(409, "Canceled receipt cannot be received")
        stock = db.scalar(select(Inventory).where(
            Inventory.product_id == receipt.product_id,
            Inventory.location_id == receipt.location_id,
        ).with_for_update())
        if stock is None:
            stock = Inventory(product_id=receipt.product_id, location_id=receipt.location_id, quantity=0)
            db.add(stock)
            db.flush()
        stock.quantity = Decimal(stock.quantity) + Decimal(receipt.quantity)
        receipt.status = ReceiptStatus.RECEIVED
        receipt.received_at = datetime.utcnow()
        audit(db, "receipt", receipt.id, "RECEIVE", reason,
              f"quantity={receipt.quantity}; inventory_id={stock.id}")
        rebuild_allocations(db)
    return {"receipt_id": receipt.id, "status": receipt.status.value, "already_received": False}


@router.post("/receipts/{receipt_id}/cancel")
def cancel_receipt(receipt_id: int, reason: str, db: Session = Depends(get_db)):
    if not reason.strip():
        raise HTTPException(422, "A reason is required")
    with db.begin():
        receipt = db.scalar(select(InboundReceipt).where(InboundReceipt.id == receipt_id).with_for_update())
        if not receipt:
            raise HTTPException(404, "Receipt not found")
        if receipt.status == ReceiptStatus.RECEIVED:
            raise HTTPException(409, "Received receipt cannot be canceled; create an audited inventory reversal")
        if receipt.status == ReceiptStatus.CANCELED:
            return {"receipt_id": receipt.id, "status": receipt.status.value, "already_canceled": True}
        receipt.status = ReceiptStatus.CANCELED
        audit(db, "receipt", receipt.id, "CANCEL", reason)
        rebuild_allocations(db)
    return {"receipt_id": receipt.id, "status": receipt.status.value}


@router.get("/atp/{product_id}/{location_id}")
def atp(product_id: int, location_id: int, db: Session = Depends(get_db)):
    stock = db.scalar(select(Inventory).where(
        Inventory.product_id == product_id, Inventory.location_id == location_id
    ))
    receipts = db.scalars(select(InboundReceipt).where(
        InboundReceipt.product_id == product_id, InboundReceipt.location_id == location_id,
        InboundReceipt.status.in_([ReceiptStatus.PLANNED, ReceiptStatus.IN_TRANSIT]),
    ).order_by(InboundReceipt.expected_arrival)).all()
    allocations = db.scalars(select(Allocation).join(OrderLine, Allocation.order_line_id == OrderLine.id).where(
        Allocation.location_id == location_id, Allocation.status == AllocationStatus.ACTIVE,
        OrderLine.product_id == product_id,
    )).all()
    receipt_dates = {receipt.id: receipt.expected_arrival for receipt in receipts}
    events = [{"date": datetime.min, "kind": "ON_HAND", "quantity": Decimal(stock.quantity) if stock else Decimal(0),
               "sort_order": 0}]
    events.extend({"date": r.expected_arrival, "kind": "INBOUND", "quantity": Decimal(r.quantity), "sort_order": 0}
                  for r in receipts)
    events.extend({"date": datetime.utcnow() if a.source_type == "ON_HAND" else receipt_dates.get(a.source_id, datetime.utcnow()),
                   "kind": "ALLOCATED_DEMAND", "quantity": -Decimal(a.quantity),
                   "source_type": a.source_type, "source_id": a.source_id, "sort_order": 1}
                  for a in allocations)
    projected = Decimal(0)
    result = []
    for event in sorted(events, key=lambda x: (x["date"], x["sort_order"], x["kind"])):
        projected += event["quantity"]
        result.append({"date": event["date"], "event": event["kind"], "quantity": event["quantity"],
                       "atp": max(Decimal(0), projected)})
    return {"product_id": product_id, "location_id": location_id, "events": result}


@router.get("/atp/{product_id}")
def atp_projection(product_id: int, start: datetime, end: datetime, db: Session = Depends(get_db)):
    if end < start:
        raise HTTPException(422, "end must not be before start")
    locations = db.scalars(select(Inventory.location_id).where(Inventory.product_id == product_id).distinct()).all()
    receipts = db.scalars(select(InboundReceipt).where(
        InboundReceipt.product_id == product_id,
        InboundReceipt.expected_arrival >= start, InboundReceipt.expected_arrival <= end,
        InboundReceipt.status.in_([ReceiptStatus.PLANNED, ReceiptStatus.IN_TRANSIT]),
    )).all()
    return {"product_id": product_id, "start": start, "end": end,
            "locations": [{"location_id": location_id, "projection": atp(product_id, location_id, db)}
                          for location_id in locations + [r.location_id for r in receipts if r.location_id not in locations]]}
