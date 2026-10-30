from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Allocation, AllocationStatus, CustomerOrder, ExceptionRecord, InboundReceipt, Inventory, Location,
    OrderLine, OrderPriority, OrderStatus, ReceiptStatus,
)

PRIORITY_ORDER = {OrderPriority.HIGH: 0, OrderPriority.MED: 1, OrderPriority.LOW: 2}


def refresh_exceptions(db: Session) -> None:
    orders = db.scalars(select(CustomerOrder).where(
        CustomerOrder.status.in_([OrderStatus.CONFIRMED, OrderStatus.FULFILLING])
    )).all()
    existing = db.scalars(select(ExceptionRecord).order_by(ExceptionRecord.created_at.desc())).all()
    by_key = {}
    for item in existing:
        by_key.setdefault((item.order_id, item.exception_type), item)
    desired: dict[tuple[int, str], str] = {}
    receipts_by_id = {receipt.id: receipt for receipt in db.scalars(select(InboundReceipt)).all()}
    for order in orders:
        for line in order.lines:
            if line.backordered_quantity > 0:
                desired[(order.id, "BACKORDER")] = f"Line {line.id} has {line.backordered_quantity} backordered."
            if line.promised_ship_date and line.promised_ship_date.date() > order.requested_ship_date.date():
                desired[(order.id, "LATE_PROMISE")] = (
                    f"Line {line.id} is promised for {line.promised_ship_date.isoformat()}."
                )
            active_allocations = db.scalars(select(Allocation).where(
                Allocation.order_line_id == line.id, Allocation.status == AllocationStatus.ACTIVE
            )).all()
            on_hand_allocated = sum(
                (Decimal(a.quantity) for a in active_allocations if a.source_type == "ON_HAND"), Decimal(0)
            )
            if order.priority == OrderPriority.HIGH and on_hand_allocated < line.requested_quantity - line.shipped_quantity:
                desired[(order.id, "HIGH_PRIORITY_SHORTAGE")] = f"High-priority line {line.id} lacks on-hand allocation."
            if any(
                receipts_by_id.get(a.source_id)
                and receipts_by_id[a.source_id].expected_arrival.date() > order.requested_ship_date.date()
                for a in active_allocations if a.source_type == "RECEIPT"
            ):
                desired[(order.id, "DELAYED_INBOUND")] = "Allocated inbound supply arrives after the requested ship date."
            canceled_receipt = db.scalar(select(InboundReceipt).where(
                InboundReceipt.product_id == line.product_id,
                InboundReceipt.status == ReceiptStatus.CANCELED,
            ).limit(1))
            if canceled_receipt and line.backordered_quantity > 0:
                desired[(order.id, "CANCELED_INBOUND")] = (
                    f"Canceled receipt {canceled_receipt.receipt_code} may contribute to this outstanding product demand."
                )
    for key, record in by_key.items():
        if key not in desired and record.status == "OPEN":
            record.status = "RESOLVED"
    for (order_id, exception_type), details in desired.items():
        record = by_key.get((order_id, exception_type))
        if record:
            record.details = details
            record.status = "OPEN"
        else:
            db.add(ExceptionRecord(order_id=order_id, exception_type=exception_type, details=details, status="OPEN"))


def _location_capacity(db: Session, product_id: int, location_id: int, now: datetime):
    stock = db.scalar(select(Inventory).where(
        Inventory.product_id == product_id, Inventory.location_id == location_id
    ).with_for_update())
    lots: list[tuple[datetime, str, int, Decimal]] = []
    if stock and stock.quantity > 0:
        lots.append((now, "ON_HAND", stock.id, Decimal(stock.quantity)))
    receipts = db.scalars(select(InboundReceipt).where(
        InboundReceipt.product_id == product_id,
        InboundReceipt.location_id == location_id,
        InboundReceipt.status.in_([ReceiptStatus.PLANNED, ReceiptStatus.IN_TRANSIT]),
    ).order_by(InboundReceipt.expected_arrival, InboundReceipt.id).with_for_update()).all()
    lots.extend((max(r.expected_arrival, now), "RECEIPT", r.id, Decimal(r.quantity)) for r in receipts)
    return lots


def _completion_for(lots: list[tuple[datetime, str, int, Decimal]], needed: Decimal):
    cumulative = Decimal(0)
    for arrival, _, _, quantity in sorted(lots, key=lambda x: (x[0], x[1], x[2])):
        cumulative += quantity
        if cumulative >= needed:
            return arrival
    return None


def rebuild_allocations(db: Session, now: datetime | None = None) -> None:
    """Rebuild only outstanding reservations; shipment records remain immutable."""
    now = now or datetime.utcnow()
    db.flush()
    active = db.scalars(select(Allocation).where(Allocation.status == AllocationStatus.ACTIVE)
                        .with_for_update()).all()
    for allocation in active:
        allocation.status = AllocationStatus.RELEASED

    orders = db.scalars(select(CustomerOrder).where(
        CustomerOrder.status.in_([OrderStatus.CONFIRMED, OrderStatus.FULFILLING])
    ).order_by(CustomerOrder.created_at, CustomerOrder.id).with_for_update()).all()
    orders.sort(key=lambda o: (PRIORITY_ORDER[o.priority], o.created_at, o.order_number))
    reserved: dict[tuple[str, int], Decimal] = {}

    for order in orders:
        for line in sorted(order.lines, key=lambda x: x.id):
            remaining = max(Decimal(0), Decimal(line.requested_quantity) - Decimal(line.shipped_quantity))
            line.allocated_quantity = Decimal(0)
            line.backordered_quantity = remaining
            line.promised_ship_date = None
            line.promise_explanation = "No eligible supply is currently available."
            if remaining == 0:
                line.backordered_quantity = Decimal(0)
                line.promise_explanation = "The requested quantity has shipped."
                continue
            locations = db.scalars(select(Inventory.location_id).where(
                Inventory.product_id == line.product_id
            ).distinct()).all()
            receipt_locs = db.scalars(select(InboundReceipt.location_id).where(
                InboundReceipt.product_id == line.product_id,
                InboundReceipt.status.in_([ReceiptStatus.PLANNED, ReceiptStatus.IN_TRANSIT]),
            ).distinct()).all()
            candidate_ids = {int(x) for x in locations + receipt_locs}
            if line.preferred_location_id is not None:
                candidate_ids = {line.preferred_location_id} if line.preferred_location_id in candidate_ids else set()
            candidates = []
            for location_id in candidate_ids:
                lots = _location_capacity(db, line.product_id, location_id, now)
                adjusted = []
                available_total = Decimal(0)
                for arrival, source_type, source_id, qty in lots:
                    prior = reserved.get((source_type, source_id), Decimal(0))
                    qty = max(Decimal(0), qty - prior)
                    if qty:
                        adjusted.append((arrival, source_type, source_id, qty))
                        available_total += qty
                completion = _completion_for(adjusted, remaining)
                earliest = _completion_for(adjusted, min(remaining, available_total)) if available_total else None
                location_code = db.scalar(select(Location.code).where(Location.id == location_id)) or str(location_id)
                candidates.append((completion is None, -available_total, earliest or datetime.max,
                                  location_code, location_id, adjusted, completion))
            if not candidates:
                continue
            # Prefer a location that can complete the line; otherwise maximize available quantity.
            chosen = min(candidates, key=lambda x: (x[0], x[1], x[2], x[3]))
            _, negative_available, earliest_completion, _, location_id, lots, completion = chosen
            amount_to_allocate = min(remaining, -negative_available)
            left = amount_to_allocate
            for arrival, source_type, source_id, qty in sorted(
                lots, key=lambda x: (0 if x[1] == "ON_HAND" else 1, x[0], x[2])
            ):
                take = min(left, qty)
                if take <= 0:
                    continue
                db.add(Allocation(order_line_id=line.id, location_id=location_id, source_type=source_type,
                                  source_id=source_id, quantity=take, status=AllocationStatus.ACTIVE))
                reserved[(source_type, source_id)] = reserved.get((source_type, source_id), Decimal(0)) + take
                line.allocated_quantity += take
                left -= take
                if left == 0:
                    break
            line.backordered_quantity = max(Decimal(0), remaining - line.allocated_quantity)
            line.promised_ship_date = completion
            if completion:
                line.promise_explanation = f"Supply at location {location_id} covers the outstanding quantity by {completion.isoformat()}."
            elif line.allocated_quantity:
                line.promise_explanation = (
                    f"Partially allocated {line.allocated_quantity}; {line.backordered_quantity} remains backordered."
                )
            if line.backordered_quantity > 0 and not line.promised_ship_date:
                latest_receipt = db.scalar(select(InboundReceipt.expected_arrival).where(
                    InboundReceipt.product_id == line.product_id,
                    InboundReceipt.status.in_([ReceiptStatus.PLANNED, ReceiptStatus.IN_TRANSIT]),
                ).order_by(InboundReceipt.expected_arrival.desc()).limit(1))
                line.promised_ship_date = latest_receipt
            if line.promise_override:
                line.promised_ship_date = line.promise_override
                line.promise_explanation = (line.promise_explanation or "") + " Promised date manually overridden."
    refresh_exceptions(db)
