from datetime import datetime
from decimal import Decimal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import require_auth
from app.db import get_db
from app.models import (
    Allocation, AllocationStatus, CustomerOrder, Inventory, Location, OrderLine, OrderStatus,
    ReceiptStatus, Shipment, ShipmentLine, InboundReceipt,
)
from app.services.audit import audit
from app.services.planning import rebuild_allocations

router = APIRouter(dependencies=[Depends(require_auth)])


class ExpediteRequest(BaseModel):
    expected_arrival: datetime
    reason: str = Field(min_length=1)


class ReassignRequest(BaseModel):
    location_id: int
    reason: str = Field(min_length=1)


class PromiseOverrideRequest(BaseModel):
    promised_ship_date: datetime
    reason: str = Field(min_length=1)


class ShipmentLineRequest(BaseModel):
    order_line_id: int
    quantity: Decimal = Field(gt=0)
    location_id: int


class ShipmentRequest(BaseModel):
    lines: list[ShipmentLineRequest] = Field(min_length=1)
    reason: str = Field(min_length=1)


@router.post("/planner/receipts/{receipt_id}/expedite")
def expedite_receipt(receipt_id: int, payload: ExpediteRequest, db: Session = Depends(get_db)):
    if not payload.reason.strip():
        raise HTTPException(422, "A reason is required")
    with db.begin():
        receipt = db.scalar(select(InboundReceipt).where(InboundReceipt.id == receipt_id).with_for_update())
        if not receipt:
            raise HTTPException(404, "Receipt not found")
        if receipt.status in (ReceiptStatus.RECEIVED, ReceiptStatus.CANCELED):
            raise HTTPException(409, f"Cannot expedite a {receipt.status.value.lower()} receipt")
        previous = receipt.expected_arrival
        if payload.expected_arrival >= previous:
            raise HTTPException(422, "Expedited arrival must be earlier than the current expected arrival")
        receipt.expected_arrival = payload.expected_arrival
        audit(db, "receipt", receipt.id, "EXPEDITE", payload.reason,
              f"from={previous.isoformat()}; to={payload.expected_arrival.isoformat()}")
        rebuild_allocations(db)
    return {"receipt_id": receipt_id, "expected_arrival": payload.expected_arrival}


@router.post("/planner/order-lines/{line_id}/reassign")
def reassign_line(line_id: int, payload: ReassignRequest, db: Session = Depends(get_db)):
    if not payload.reason.strip():
        raise HTTPException(422, "A reason is required")
    with db.begin():
        line = db.scalar(select(OrderLine).where(OrderLine.id == line_id).with_for_update())
        if not line:
            raise HTTPException(404, "Order line not found")
        if not db.get(Location, payload.location_id):
            raise HTTPException(404, "Location not found")
        order = db.scalar(select(CustomerOrder).where(CustomerOrder.id == line.order_id).with_for_update())
        if order.status not in (OrderStatus.CONFIRMED, OrderStatus.FULFILLING):
            raise HTTPException(409, "Only confirmed or fulfilling orders can be reassigned")
        previous = line.preferred_location_id
        line.preferred_location_id = payload.location_id
        audit(db, "order_line", line.id, "REASSIGN", payload.reason,
              f"from_location={previous}; to_location={payload.location_id}")
        rebuild_allocations(db)
    return {"line_id": line_id, "preferred_location_id": payload.location_id,
            "promise": line.promised_ship_date, "allocated_quantity": line.allocated_quantity}


@router.post("/planner/order-lines/{line_id}/promise-override")
def override_promise(line_id: int, payload: PromiseOverrideRequest, db: Session = Depends(get_db)):
    if not payload.reason.strip():
        raise HTTPException(422, "A reason is required")
    with db.begin():
        line = db.scalar(select(OrderLine).where(OrderLine.id == line_id).with_for_update())
        if not line:
            raise HTTPException(404, "Order line not found")
        order = db.scalar(select(CustomerOrder).where(CustomerOrder.id == line.order_id).with_for_update())
        if order.status not in (OrderStatus.CONFIRMED, OrderStatus.FULFILLING):
            raise HTTPException(409, "Only confirmed or fulfilling orders can have a promise override")
        line.promise_override = payload.promised_ship_date
        line.promised_ship_date = payload.promised_ship_date
        line.promise_explanation = f"Manually overridden: {payload.reason}"
        audit(db, "order_line", line.id, "PROMISE_OVERRIDE", payload.reason,
              payload.promised_ship_date.isoformat())
        rebuild_allocations(db)
    return {"line_id": line_id, "promised_ship_date": line.promised_ship_date,
            "promise_explanation": line.promise_explanation}


@router.post("/shipments", status_code=201)
def create_shipment(payload: ShipmentRequest, db: Session = Depends(get_db)):
    if not payload.reason.strip():
        raise HTTPException(422, "A reason is required")
    with db.begin():
        line_ids = [item.order_line_id for item in payload.lines]
        lines = db.scalars(select(OrderLine).where(OrderLine.id.in_(line_ids)).with_for_update()).all()
        line_map = {line.id: line for line in lines}
        if len(line_map) != len(set(line_ids)):
            raise HTTPException(404, "One or more order lines were not found")
        order_ids = {line_map[x.order_line_id].order_id for x in payload.lines}
        if len(order_ids) != 1:
            raise HTTPException(422, "A shipment may contain lines from only one order")
        order_id = order_ids.pop()
        order = db.scalar(select(CustomerOrder).where(CustomerOrder.id == order_id).with_for_update())
        if order.status not in (OrderStatus.CONFIRMED, OrderStatus.FULFILLING):
            raise HTTPException(409, "Only confirmed or fulfilling orders may ship")
        shipment = Shipment(shipment_code=f"SHP-{uuid4().hex[:12].upper()}", order_id=order_id)
        db.add(shipment)
        db.flush()
        for item in payload.lines:
            line = line_map[item.order_line_id]
            remaining_allowed = Decimal(item.quantity)
            if remaining_allowed > Decimal(line.requested_quantity) - Decimal(line.shipped_quantity):
                raise HTTPException(409, "Shipment exceeds outstanding order quantity")
            stock = db.scalar(select(Inventory).where(
                Inventory.product_id == line.product_id,
                Inventory.location_id == item.location_id,
            ).with_for_update())
            if not stock:
                raise HTTPException(409, "No on-hand inventory at requested location")
            available_on_hand = Decimal(0)
            active = db.scalars(select(Allocation).where(
                Allocation.order_line_id == line.id,
                Allocation.location_id == item.location_id,
                Allocation.source_type == "ON_HAND",
                Allocation.status == AllocationStatus.ACTIVE,
            ).with_for_update()).all()
            for allocation in active:
                available_on_hand += Decimal(allocation.quantity)
            amount = Decimal(item.quantity)
            if amount > min(available_on_hand, Decimal(stock.quantity)):
                raise HTTPException(409, "Shipment exceeds quantity allocated from physically available stock")
            stock.quantity = Decimal(stock.quantity) - amount
            audit(db, "inventory", stock.id, "SHIPMENT_DECREMENT", payload.reason,
                  f"shipment_id={shipment.id}; quantity={amount}")
            left = amount
            for allocation in active:
                consumed = min(left, Decimal(allocation.quantity))
                if consumed == Decimal(allocation.quantity):
                    allocation.status = AllocationStatus.CONSUMED
                else:
                    allocation.quantity = Decimal(allocation.quantity) - consumed
                    db.add(Allocation(order_line_id=line.id, location_id=item.location_id,
                                      source_type="ON_HAND", source_id=allocation.source_id,
                                      quantity=consumed, status=AllocationStatus.CONSUMED))
                left -= consumed
                if left == 0:
                    break
            line.shipped_quantity = Decimal(line.shipped_quantity) + amount
            shipment.lines.append(ShipmentLine(order_line_id=line.id, location_id=item.location_id, quantity=amount))
        db.flush()
        if all(Decimal(line.shipped_quantity) >= Decimal(line.requested_quantity) for line in order.lines):
            order.status = OrderStatus.SHIPPED
        else:
            order.status = OrderStatus.FULFILLING
        audit(db, "shipment", shipment.id, "CREATE", payload.reason, f"order_id={order_id}")
        rebuild_allocations(db)
    return {"shipment_id": shipment.id, "shipment_code": shipment.shipment_code,
            "order_id": order_id, "status": order.status.value}


@router.get("/orders/{order_id}/shipments")
def order_shipments(order_id: int, db: Session = Depends(get_db)):
    if not db.get(CustomerOrder, order_id):
        raise HTTPException(404, "Order not found")
    rows = db.scalars(select(Shipment).where(Shipment.order_id == order_id).order_by(Shipment.shipped_at)).all()
    return [{"shipment_code": row.shipment_code, "shipped_at": row.shipped_at,
             "lines": [{"order_line_id": line.order_line_id, "location_id": line.location_id,
                        "quantity": line.quantity} for line in row.lines]} for row in rows]
