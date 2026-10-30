from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.dependencies import require_auth
from app.db import get_db
from app.models import (
    Allocation, AllocationStatus, AuditLog, CustomerOrder, ExceptionRecord, InboundReceipt, Inventory,
    Location, OrderLine, OrderPriority, OrderStatus, Product, Shipment, ShipmentLine,
)
from app.schemas import OrderCreate, OrderLineCreate, OrderOut, OrderUpdate
from app.services.audit import audit
from app.services.planning import rebuild_allocations

router = APIRouter(dependencies=[Depends(require_auth)])


@router.post("/orders", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
def create_order(payload: OrderCreate, db: Session = Depends(get_db)):
    for line in payload.lines:
        if not db.get(Product, line.product_id):
            raise HTTPException(404, f"Product {line.product_id} not found")
        if line.preferred_location_id is not None and not db.get(Location, line.preferred_location_id):
            raise HTTPException(404, f"Location {line.preferred_location_id} not found")
    order = CustomerOrder(order_number=payload.order_number, customer_name=payload.customer_name,
                          priority=payload.priority, requested_ship_date=payload.requested_ship_date)
    order.lines = [OrderLine(**line.model_dump()) for line in payload.lines]
    db.add(order)
    try:
        db.flush()
        audit(db, "order", order.id, "CREATE", "Order created")
        db.commit()
        db.refresh(order)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Order number must be unique and all referenced records must exist") from exc
    return order


@router.get("/orders", response_model=dict)
def list_orders(
    search: str | None = None,
    order_status: OrderStatus | None = None,
    priority: OrderPriority | None = None,
    exception_type: str | None = None,
    requested_from: datetime | None = None,
    requested_to: datetime | None = None,
    sort: str = Query(default="oldest", pattern="^(oldest|earliest_promise|highest_risk)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    query = select(CustomerOrder).options(selectinload(CustomerOrder.lines))
    if search:
        query = query.where(
            CustomerOrder.order_number.ilike(f"%{search}%") |
            CustomerOrder.customer_name.ilike(f"%{search}%")
        )
    if order_status:
        query = query.where(CustomerOrder.status == order_status)
    if priority:
        query = query.where(CustomerOrder.priority == priority)
    if requested_from:
        query = query.where(CustomerOrder.requested_ship_date >= requested_from)
    if requested_to:
        query = query.where(CustomerOrder.requested_ship_date <= requested_to)
    orders = db.scalars(query).unique().all()
    if exception_type:
        ids = set(db.scalars(select(ExceptionRecord.order_id).where(
            ExceptionRecord.exception_type == exception_type, ExceptionRecord.status == "OPEN"
        )).all())
        orders = [order for order in orders if order.id in ids]
    if sort == "earliest_promise":
        orders.sort(key=lambda o: min((line.promised_ship_date or datetime.max for line in o.lines), default=datetime.max))
    elif sort == "highest_risk":
        orders.sort(key=lambda o: (
            0 if o.priority == OrderPriority.HIGH else 1,
            -sum((Decimal(line.backordered_quantity) for line in o.lines), Decimal(0)),
            o.created_at,
        ))
    else:
        orders.sort(key=lambda o: (o.created_at, o.order_number))
    count = len(orders)
    selected = orders[(page - 1) * page_size:page * page_size]
    return {"items": [OrderOut.model_validate(order) for order in selected], "page": page,
            "page_size": page_size, "total": count, "pages": (count + page_size - 1) // page_size}


@router.get("/orders/{order_id}", response_model=OrderOut)
def get_order(order_id: int, db: Session = Depends(get_db)):
    order = db.scalar(select(CustomerOrder).options(selectinload(CustomerOrder.lines))
                      .where(CustomerOrder.id == order_id))
    if not order:
        raise HTTPException(404, "Order not found")
    return order


@router.patch("/orders/{order_id}")
def update_order(order_id: int, payload: OrderUpdate, db: Session = Depends(get_db)):
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(422, "At least one order field must be provided")
    with db.begin():
        order = db.scalar(select(CustomerOrder).where(CustomerOrder.id == order_id).with_for_update())
        if not order:
            raise HTTPException(404, "Order not found")
        if order.status in (OrderStatus.SHIPPED, OrderStatus.CANCELED):
            raise HTTPException(409, "A shipped or canceled order cannot be edited")
        for key, value in changes.items():
            setattr(order, key, value)
        audit(db, "order", order.id, "UPDATE", "Order details updated")
        rebuild_allocations(db)
    return get_order(order_id, db)


@router.post("/orders/{order_id}/lines", status_code=201)
def add_order_line(order_id: int, payload: OrderLineCreate, db: Session = Depends(get_db)):
    with db.begin():
        if not db.get(Product, payload.product_id):
            raise HTTPException(404, "Product not found")
        if payload.preferred_location_id is not None and not db.get(Location, payload.preferred_location_id):
            raise HTTPException(404, "Location not found")
        order = db.scalar(select(CustomerOrder).where(CustomerOrder.id == order_id).with_for_update())
        if not order:
            raise HTTPException(404, "Order not found")
        if order.status in (OrderStatus.SHIPPED, OrderStatus.CANCELED):
            raise HTTPException(409, "Cannot edit a shipped or canceled order")
        line = OrderLine(order_id=order.id, **payload.model_dump())
        db.add(line)
        db.flush()
        audit(db, "order", order.id, "LINE_ADD", "Order line added", f"line_id={line.id}")
        rebuild_allocations(db)
    return {"id": line.id, "order_id": order_id}


@router.patch("/orders/{order_id}/lines/{line_id}")
def update_order_line(order_id: int, line_id: int, payload: OrderLineCreate, db: Session = Depends(get_db)):
    with db.begin():
        if not db.get(Product, payload.product_id):
            raise HTTPException(404, "Product not found")
        if payload.preferred_location_id is not None and not db.get(Location, payload.preferred_location_id):
            raise HTTPException(404, "Location not found")
        order = db.scalar(select(CustomerOrder).where(CustomerOrder.id == order_id).with_for_update())
        line = db.scalar(select(OrderLine).where(OrderLine.id == line_id, OrderLine.order_id == order_id)
                         .with_for_update())
        if not order or not line:
            raise HTTPException(404, "Order or order line not found")
        if order.status in (OrderStatus.SHIPPED, OrderStatus.CANCELED):
            raise HTTPException(409, "Cannot edit a shipped or canceled order")
        if payload.requested_quantity < line.shipped_quantity:
            raise HTTPException(409, "Requested quantity cannot be less than quantity already shipped")
        for key, value in payload.model_dump().items():
            setattr(line, key, value)
        audit(db, "order", order.id, "LINE_UPDATE", "Order line updated", f"line_id={line.id}")
        rebuild_allocations(db)
    return {"id": line.id, "requested_quantity": line.requested_quantity}


@router.delete("/orders/{order_id}/lines/{line_id}", status_code=204)
def delete_order_line(order_id: int, line_id: int, reason: str, db: Session = Depends(get_db)):
    if not reason.strip():
        raise HTTPException(422, "A reason is required")
    with db.begin():
        order = db.scalar(select(CustomerOrder).where(CustomerOrder.id == order_id).with_for_update())
        line = db.scalar(select(OrderLine).where(OrderLine.id == line_id, OrderLine.order_id == order_id)
                         .with_for_update())
        if not order or not line:
            raise HTTPException(404, "Order or order line not found")
        if order.status in (OrderStatus.SHIPPED, OrderStatus.CANCELED) or line.shipped_quantity > 0:
            raise HTTPException(409, "Cannot remove a shipped order line")
        for allocation in db.scalars(select(Allocation).where(
            Allocation.order_line_id == line.id, Allocation.status == AllocationStatus.ACTIVE
        )):
            allocation.status = AllocationStatus.RELEASED
        db.delete(line)
        db.flush()
        audit(db, "order", order.id, "LINE_DELETE", reason, f"line_id={line_id}")
        rebuild_allocations(db)
    return None


@router.post("/orders/{order_id}/confirm")
def confirm_order(order_id: int, db: Session = Depends(get_db)):
    with db.begin():
        order = db.scalar(select(CustomerOrder).where(CustomerOrder.id == order_id).with_for_update())
        if not order:
            raise HTTPException(404, "Order not found")
        if order.status != OrderStatus.DRAFT:
            raise HTTPException(409, "Only draft orders can be confirmed")
        order.status = OrderStatus.CONFIRMED
        audit(db, "order", order.id, "CONFIRM", "Order confirmed")
        rebuild_allocations(db)
    return get_order(order_id, db)


@router.post("/orders/{order_id}/cancel")
def cancel_order(order_id: int, reason: str, db: Session = Depends(get_db)):
    if not reason.strip():
        raise HTTPException(422, "A reason is required")
    with db.begin():
        order = db.scalar(select(CustomerOrder).where(CustomerOrder.id == order_id).with_for_update())
        if not order:
            raise HTTPException(404, "Order not found")
        if order.status in (OrderStatus.CANCELED, OrderStatus.SHIPPED):
            raise HTTPException(409, f"Cannot cancel an order in {order.status.value} status")
        order.status = OrderStatus.CANCELED
        audit(db, "order", order.id, "CANCEL", reason)
        rebuild_allocations(db)
    return get_order(order_id, db)


@router.get("/orders/{order_id}/allocations")
def order_allocations(order_id: int, db: Session = Depends(get_db)):
    if not db.get(CustomerOrder, order_id):
        raise HTTPException(404, "Order not found")
    rows = db.execute(select(Allocation, OrderLine).join(OrderLine)
                      .where(OrderLine.order_id == order_id).order_by(Allocation.created_at)).all()
    return [{"allocation_id": a.id, "line_id": line.id, "location_id": a.location_id,
             "source_type": a.source_type, "source_id": a.source_id, "quantity": a.quantity, "status": a.status}
            for a, line in rows]


@router.get("/orders/{order_id}/timeline")
def order_timeline(order_id: int, db: Session = Depends(get_db)):
    if not db.get(CustomerOrder, order_id):
        raise HTTPException(404, "Order not found")
    lines = db.scalars(select(OrderLine).where(OrderLine.order_id == order_id)).all()
    line_ids = [line.id for line in lines]
    allocations = db.scalars(select(Allocation).where(Allocation.order_line_id.in_(line_ids))).all() if line_ids else []
    events = [{"date": a.created_at, "type": "ALLOCATION", "line_id": a.order_line_id,
               "quantity": a.quantity, "status": a.status.value, "source": a.source_type}
              for a in allocations]
    product_ids = {line.product_id for line in lines}
    supply_audit_ids = set()
    if product_ids:
        stocks = db.scalars(select(Inventory).where(Inventory.product_id.in_(product_ids))).all()
        supply_audit_ids.update(str(stock.id) for stock in stocks)
        events.extend({"date": stock.updated_at, "type": "ON_HAND_SNAPSHOT", "product_id": stock.product_id,
                       "location_id": stock.location_id, "quantity": stock.quantity} for stock in stocks)
        receipts = db.scalars(select(InboundReceipt).where(
            InboundReceipt.product_id.in_(product_ids)
        )).all()
        supply_audit_ids.update(str(receipt.id) for receipt in receipts)
        events.extend({"date": receipt.expected_arrival, "type": "INBOUND_RECEIPT",
                       "receipt_code": receipt.receipt_code, "status": receipt.status.value,
                       "quantity": receipt.quantity, "location_id": receipt.location_id}
                      for receipt in receipts)
    shipment_rows = db.execute(select(Shipment, ShipmentLine).join(ShipmentLine)
                               .where(Shipment.order_id == order_id)).all()
    events.extend({"date": shipment.shipped_at, "type": "SHIPMENT", "shipment_code": shipment.shipment_code,
                   "line_id": line.order_line_id, "quantity": line.quantity, "location_id": line.location_id}
                  for shipment, line in shipment_rows)
    audit_rows = db.scalars(select(AuditLog).where(
        (AuditLog.entity_type == "order") & (AuditLog.entity_id == str(order_id)) |
        ((AuditLog.entity_type.in_(["inventory", "receipt"])) &
         (AuditLog.entity_id.in_(supply_audit_ids or {"-1"}))),
    )).all()
    events.extend({"date": row.created_at, "type": row.action, "reason": row.reason} for row in audit_rows)
    return sorted(events, key=lambda e: e["date"] or datetime.min)


@router.get("/exceptions")
def list_exceptions(exception_status: str = "OPEN", exception_type: str | None = None,
                    sort: str = "oldest", db: Session = Depends(get_db)):
    if sort not in ("oldest", "newest"):
        raise HTTPException(422, "sort must be oldest or newest")
    query = select(ExceptionRecord).where(ExceptionRecord.status == exception_status.upper())
    if exception_type:
        query = query.where(ExceptionRecord.exception_type == exception_type)
    rows = db.scalars(query).all()
    rows.sort(key=lambda row: row.created_at, reverse=sort == "newest")
    return rows
