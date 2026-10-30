import json
import re
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import require_auth
from app.db import get_db
from app.models import (
    AIInteraction, Allocation, AllocationStatus, CustomerMessage, CustomerOrder, InboundReceipt, Location,
    Inventory, OrderLine, OrderStatus, Product, ReceiptStatus, Shipment, ShipmentLine,
)
from app.schemas import MessageUpdate, PlannerNote
from app.services.audit import audit
from app.services.planning import rebuild_allocations

router = APIRouter(dependencies=[Depends(require_auth)])


def parse_note(db: Session, text: str) -> list[dict]:
    actions = []
    receipts = db.scalars(select(InboundReceipt)).all()
    for receipt in receipts:
        if receipt.receipt_code.lower() in text.lower():
            verb = re.search(r"\b(delay|expedite)\b", text, re.IGNORECASE)
            date_match = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", text)
            if verb and date_match:
                try:
                    datetime.strptime(date_match.group(1), "%Y-%m-%d")
                except ValueError:
                    continue
                actions.append({"action": verb.group(1).lower(), "receipt_code": receipt.receipt_code,
                                "expected_arrival": date_match.group(1), "confidence": 0.9,
                                "explanation": "Receipt code and ISO date were found in the note."})
    if re.search(r"\b(reassign|move)\b", text, re.IGNORECASE):
        locations = db.scalars(select(Location)).all()
        orders = db.scalars(select(CustomerOrder)).all()
        for order in orders:
            if order.order_number.lower() not in text.lower():
                continue
            matched_locations = [location for location in locations if
                                 re.search(rf"\b{re.escape(location.code)}\b", text, re.IGNORECASE)]
            if len(matched_locations) != 1:
                continue
            lines = db.scalars(select(OrderLine).where(OrderLine.order_id == order.id)).all()
            line_matches = []
            for line in lines:
                product = db.get(Product, line.product_id)
                if product and re.search(rf"\b{re.escape(product.sku)}\b", text, re.IGNORECASE):
                    line_matches.append(line)
            if len(lines) == 1:
                selected_line = lines[0]
            elif len(line_matches) == 1:
                selected_line = line_matches[0]
            else:
                continue
            actions.append({
                "action": "reassign_line", "order_number": order.order_number,
                "line_id": selected_line.id, "location_code": matched_locations[0].code,
                "confidence": 0.9, "explanation": "Order, line, and destination location matched persisted records.",
            })
    return actions


@router.post("/ai/planner-notes")
def propose_actions(payload: PlannerNote, db: Session = Depends(get_db)):
    actions = parse_note(db, payload.text)
    matched_orders = [order.order_number for order in db.scalars(select(CustomerOrder)).all()
                      if order.order_number.lower() in payload.text.lower()]
    preview = "No supported, fully identified action was found; no records were changed."
    if actions:
        impacts = []
        for action in actions:
            if action["action"] in ("delay", "expedite"):
                receipt = db.scalar(select(InboundReceipt).where(
                    InboundReceipt.receipt_code == action["receipt_code"]
                ))
                allocations = db.execute(select(Allocation, OrderLine).join(
                    OrderLine, Allocation.order_line_id == OrderLine.id
                ).where(
                    Allocation.source_type == "RECEIPT", Allocation.source_id == receipt.id,
                    Allocation.status == AllocationStatus.ACTIVE,
                )).all()
                lines = [f"line {line.id}: {allocation.quantity} reserved, current promise "
                         f"{line.promised_ship_date.isoformat() if line.promised_ship_date else 'unknown'}"
                         for allocation, line in allocations]
                impacts.append(f"{receipt.receipt_code} date change may affect " +
                               (", ".join(lines) if lines else "no current receipt-backed allocations"))
            else:
                line = db.get(OrderLine, action["line_id"])
                location = db.scalar(select(Location).where(Location.code == action["location_code"]))
                stock = db.scalar(select(Inventory.quantity).where(
                    Inventory.product_id == line.product_id, Inventory.location_id == location.id
                )) or Decimal(0)
                impacts.append(
                    f"line {line.id} would be restricted to {location.code}; destination on-hand is {stock}, "
                    f"current promise is {line.promised_ship_date.isoformat() if line.promised_ship_date else 'unknown'}"
                )
        preview = "Proposal only; no records changed. " + "; ".join(impacts)
    elif matched_orders:
        preview = ("Order number(s) identified, but a complete supported receipt or line reassignment "
                   "could not be established. No records were changed.")
    interaction = AIInteraction(interaction_type="PLANNER_NOTE", input_text=payload.text,
                                proposed_actions=json.dumps(actions), confidence=Decimal("0.9000") if actions else Decimal("0"),
                                preview=preview, application_status="PROPOSED")
    db.add(interaction)
    db.commit()
    db.refresh(interaction)
    return {"interaction_id": interaction.id, "identified_orders": matched_orders, "proposed_actions": actions,
            "confidence": interaction.confidence, "preview": preview, "application_status": interaction.application_status}


@router.post("/ai/planner-notes/{interaction_id}/apply")
def apply_proposal(interaction_id: int, reason: str, db: Session = Depends(get_db)):
    if not reason.strip():
        raise HTTPException(422, "A reason is required to apply a proposal")
    with db.begin():
        interaction = db.scalar(select(AIInteraction).where(AIInteraction.id == interaction_id).with_for_update())
        if not interaction:
            raise HTTPException(404, "AI interaction not found")
        if interaction.interaction_type != "PLANNER_NOTE" or interaction.application_status != "PROPOSED":
            raise HTTPException(409, "Only unapplied planner proposals can be applied")
        actions = json.loads(interaction.proposed_actions or "[]")
        if not actions or any(action.get("action") not in ("delay", "expedite", "reassign_line") for action in actions):
            raise HTTPException(422, "Proposal contains no supported, complete action")
        for action in actions:
            if action["action"] == "reassign_line":
                line = db.scalar(select(OrderLine).where(OrderLine.id == action.get("line_id")).with_for_update())
                location = db.scalar(select(Location).where(Location.code == action.get("location_code")))
                if not line or not location:
                    raise HTTPException(409, "A proposed order line or destination is no longer valid")
                order = db.scalar(select(CustomerOrder).where(CustomerOrder.id == line.order_id).with_for_update())
                if not order or order.status not in (
                    OrderStatus.CONFIRMED, OrderStatus.FULFILLING
                ):
                    raise HTTPException(409, "A proposed order line or destination is no longer valid")
                continue
            if not action.get("expected_arrival"):
                raise HTTPException(422, "Receipt proposal is incomplete")
        for action in actions:
            if action["action"] == "reassign_line":
                line = db.get(OrderLine, action["line_id"])
                location = db.scalar(select(Location).where(Location.code == action["location_code"]))
                previous = line.preferred_location_id
                line.preferred_location_id = location.id
                audit(db, "order_line", line.id, "AI_REASSIGN", reason,
                      f"from_location={previous}; to_location={location.id}; interaction={interaction.id}")
                continue
            receipt = db.scalar(select(InboundReceipt).where(
                InboundReceipt.receipt_code == action["receipt_code"]
            ).with_for_update())
            if not receipt or receipt.status in (ReceiptStatus.RECEIVED, ReceiptStatus.CANCELED):
                raise HTTPException(409, "A proposed receipt no longer exists or cannot be changed")
            previous = receipt.expected_arrival
            arrival = datetime.fromisoformat(action["expected_arrival"])
            if action["action"] == "expedite" and arrival >= previous:
                raise HTTPException(422, "Expedite proposal must move the receipt earlier")
            if action["action"] == "delay" and arrival <= previous:
                raise HTTPException(422, "Delay proposal must move the receipt later")
            receipt.expected_arrival = arrival
            audit(db, "receipt", receipt.id, "AI_APPLY", reason,
                  f"from={previous.isoformat()}; to={receipt.expected_arrival.isoformat()}; interaction={interaction.id}")
        interaction.application_status = "APPLIED"
        audit(db, "ai_interaction", interaction.id, "APPLY", reason, json.dumps(actions))
        rebuild_allocations(db)
    return {"interaction_id": interaction_id, "application_status": "APPLIED", "actions_applied": len(actions)}


@router.post("/ai/orders/{order_id}/customer-message")
def draft_customer_message(order_id: int, db: Session = Depends(get_db)):
    order = db.get(CustomerOrder, order_id)
    if not order:
        raise HTTPException(404, "Order not found")
    lines = db.scalars(select(OrderLine).where(OrderLine.order_id == order_id)).all()
    parts = [f"Order {order.order_number} update:"]
    for line in lines:
        promise = line.promised_ship_date.strftime("%Y-%m-%d") if line.promised_ship_date else "not yet determined"
        allocations = db.scalars(select(Allocation).where(
            Allocation.order_line_id == line.id, Allocation.status == AllocationStatus.ACTIVE
        )).all()
        shipment_rows = db.scalars(select(ShipmentLine).join(Shipment, ShipmentLine.shipment_id == Shipment.id)
                                   .where(ShipmentLine.order_line_id == line.id)).all()
        location_ids = sorted(
            {allocation.location_id for allocation in allocations} |
            {shipment_line.location_id for shipment_line in shipment_rows}
        )
        location_names = db.scalars(select(Location.name).where(Location.id.in_(location_ids))).all() if location_ids else []
        from_locations = ", ".join(location_names) or "not yet assigned"
        parts.append(f"SKU {line.product.sku}: {line.shipped_quantity} shipped; "
                     f"{line.allocated_quantity} allocated; {line.backordered_quantity} backordered; "
                     f"current promise {promise}; fulfillment location(s): {from_locations}.")
    if any(line.backordered_quantity > 0 for line in lines):
        parts.append("We can discuss shipment of available quantities or a revised delivery schedule.")
    message = " ".join(parts)
    record = CustomerMessage(order_id=order_id, message=message, status="DRAFT")
    interaction = AIInteraction(interaction_type="CUSTOMER_MESSAGE", input_text=f"order_id={order_id}",
                                proposed_actions=None, confidence=Decimal("1.0"), preview=message,
                                application_status="DRAFT")
    db.add_all([record, interaction])
    db.flush()
    audit(db, "customer_message", record.id, "CREATE_DRAFT", "Customer message draft generated")
    db.commit()
    db.refresh(record)
    return record


@router.patch("/ai/customer-messages/{message_id}")
def update_customer_message(message_id: int, payload: MessageUpdate, db: Session = Depends(get_db)):
    record = db.get(CustomerMessage, message_id)
    if not record:
        raise HTTPException(404, "Customer message not found")
    if record.status == "SENT":
        raise HTTPException(409, "Sent message cannot be edited")
    record.message = payload.message
    audit(db, "customer_message", record.id, "EDIT_DRAFT", "Customer message draft edited")
    db.commit()
    db.refresh(record)
    return record


@router.post("/ai/customer-messages/{message_id}/mark-sent")
def mark_message_sent(message_id: int, db: Session = Depends(get_db)):
    record = db.get(CustomerMessage, message_id)
    if not record:
        raise HTTPException(404, "Customer message not found")
    if record.status == "SENT":
        return {"message_id": message_id, "status": "SENT"}
    record.status = "SENT"
    record.sent_at = datetime.utcnow()
    db.add(AIInteraction(interaction_type="CUSTOMER_MESSAGE_SENT", input_text=f"message_id={message_id}",
                         application_status="SENT"))
    audit(db, "customer_message", record.id, "MARK_SENT", "Message marked sent; no email was sent")
    db.commit()
    return {"message_id": message_id, "status": "SENT", "email_sent": False}


@router.get("/ai/orders/{order_id}/exception-summary")
def exception_summary(order_id: int, db: Session = Depends(get_db)):
    order = db.get(CustomerOrder, order_id)
    if not order:
        raise HTTPException(404, "Order not found")
    lines = db.scalars(select(OrderLine).where(OrderLine.order_id == order_id)).all()
    risks = [f"Line {line.id} has {line.backordered_quantity} backordered."
             for line in lines if line.backordered_quantity > 0]
    summary = {
        "order_number": order.order_number,
        "status": order.status.value,
        "fulfillment_plan": [{"line_id": line.id, "shipped": line.shipped_quantity,
                              "allocated": line.allocated_quantity, "backordered": line.backordered_quantity,
                              "promised_ship_date": line.promised_ship_date} for line in lines],
        "risks": risks,
        "recommendations": ["Review available receipt dates and consider a planner-approved expedite."
                            ] if risks else ["No current backorder risk is recorded."],
    }
    db.add(AIInteraction(interaction_type="EXCEPTION_SUMMARY", input_text=f"order_id={order_id}",
                         preview=json.dumps(summary, default=str), application_status="ADVISORY"))
    db.commit()
    return summary
