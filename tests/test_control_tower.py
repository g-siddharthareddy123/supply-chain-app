from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import select

from app.db import get_db
from app.models import (
    Allocation, CustomerOrder, InboundReceipt, Inventory, Location, OrderLine,
    OrderPriority, OrderStatus, Product, ReceiptStatus,
)
from app.services.planning import rebuild_allocations


def setup_supply(db):
    product = Product(sku="TEST-1", name="Test product")
    location = Location(code="TEST", name="Test location")
    db.add_all([product, location])
    db.flush()
    inventory = Inventory(product_id=product.id, location_id=location.id, quantity=Decimal("10"))
    db.add(inventory)
    return product, location, inventory


def test_priority_partial_allocation_and_deterministic_rebuild(client):
    db = next(client.app.dependency_overrides[get_db]())
    try:
        product, location, _ = setup_supply(db)
        now = datetime.utcnow()
        low = CustomerOrder(order_number="LOW-1", customer_name="Low", priority=OrderPriority.LOW,
                            requested_ship_date=now, status=OrderStatus.CONFIRMED)
        high = CustomerOrder(order_number="HIGH-1", customer_name="High", priority=OrderPriority.HIGH,
                             requested_ship_date=now, status=OrderStatus.CONFIRMED)
        low.lines = [OrderLine(product_id=product.id, requested_quantity=Decimal("8"))]
        high.lines = [OrderLine(product_id=product.id, requested_quantity=Decimal("8"))]
        db.add_all([low, high])
        db.commit()
        rebuild_allocations(db)
        db.commit()
        assert high.lines[0].allocated_quantity == Decimal("8")
        assert low.lines[0].allocated_quantity == Decimal("2")
        before = db.scalar(select(Allocation).where(Allocation.status == "ACTIVE")).quantity
        rebuild_allocations(db)
        db.commit()
        allocations = db.scalars(select(Allocation).where(Allocation.status == "ACTIVE")).all()
        assert sum((Decimal(row.quantity) for row in allocations), Decimal(0)) == Decimal("10")
        assert before == Decimal("8")
    finally:
        db.close()


def test_receive_is_idempotent_and_updates_stock_once(client):
    db = next(client.app.dependency_overrides[get_db]())
    try:
        product, location, inventory = setup_supply(db)
        receipt = InboundReceipt(receipt_code="R-1", product_id=product.id, location_id=location.id,
                                 quantity=Decimal("5"), expected_arrival=datetime.utcnow() + timedelta(days=1),
                                 status=ReceiptStatus.PLANNED)
        db.add(receipt)
        db.commit()
        first = client.post(f"/api/v1/receipts/{receipt.id}/receive")
        second = client.post(f"/api/v1/receipts/{receipt.id}/receive")
        assert first.status_code == 200
        assert second.status_code == 200
        assert second.json()["already_received"] is True
        db.refresh(inventory)
        assert inventory.quantity == Decimal("15.000")
    finally:
        db.close()


def test_draft_order_is_not_allocated_until_confirmed(client):
    product, location = None, None
    response = client.post("/api/v1/products", json={"sku": "P-1", "name": "Product"})
    assert response.status_code == 201
    product_id = response.json()["id"]
    response = client.post("/api/v1/locations", json={"code": "L-1", "name": "Warehouse"})
    assert response.status_code == 201
    location_id = response.json()["id"]
    client.post("/api/v1/inventory/adjust", json={
        "product_id": product_id, "location_id": location_id, "delta": 4, "reason": "opening stock"
    })
    order = client.post("/api/v1/orders", json={
        "order_number": "O-1", "customer_name": "Acme", "requested_ship_date": "2026-11-01T00:00:00",
        "lines": [{"product_id": product_id, "requested_quantity": 3}]
    })
    assert order.status_code == 201
    line = order.json()["lines"][0]
    assert Decimal(line["allocated_quantity"]) == 0
    confirmed = client.post(f"/api/v1/orders/{order.json()['id']}/confirm")
    assert confirmed.status_code == 200
    assert Decimal(confirmed.json()["lines"][0]["allocated_quantity"]) == 3


def test_partial_shipment_only_consumes_on_hand_allocations(client):
    product = client.post("/api/v1/products", json={"sku": "SHIP-1", "name": "Ship product"}).json()
    location = client.post("/api/v1/locations", json={"code": "SHIP-L", "name": "Ship warehouse"}).json()
    client.post("/api/v1/inventory/adjust", json={
        "product_id": product["id"], "location_id": location["id"], "delta": 5, "reason": "opening stock"
    })
    order = client.post("/api/v1/orders", json={
        "order_number": "SHIP-O", "customer_name": "Acme", "requested_ship_date": "2026-11-02T00:00:00",
        "lines": [{"product_id": product["id"], "requested_quantity": 8}]
    }).json()
    client.post(f"/api/v1/orders/{order['id']}/confirm")
    line = order["lines"][0]
    shipment = client.post("/api/v1/shipments", json={
        "reason": "Ship currently available units",
        "lines": [{"order_line_id": line["id"], "quantity": 3, "location_id": location["id"]}],
    })
    assert shipment.status_code == 201
    updated = client.get(f"/api/v1/orders/{order['id']}").json()
    assert Decimal(updated["lines"][0]["shipped_quantity"]) == 3
    assert Decimal(updated["lines"][0]["backordered_quantity"]) == 3
    assert updated["status"] == "FULFILLING"


def test_ai_proposal_requires_explicit_apply_and_is_audited(client):
    product = client.post("/api/v1/products", json={"sku": "AI-1", "name": "AI product"}).json()
    location = client.post("/api/v1/locations", json={"code": "AI-L", "name": "AI warehouse"}).json()
    receipt = client.post("/api/v1/receipts", json={
        "receipt_code": "AI-R-1", "product_id": product["id"], "location_id": location["id"],
        "quantity": 9, "expected_arrival": "2026-11-10T00:00:00"
    }).json()
    proposal = client.post("/api/v1/ai/planner-notes", json={
        "text": "Please expedite AI-R-1 to 2026-11-05"
    })
    assert proposal.status_code == 200
    action = proposal.json()["proposed_actions"][0]
    assert action["receipt_code"] == receipt["receipt_code"]
    before = client.get(f"/api/v1/receipts/{receipt['id']}").json()["expected_arrival"]
    assert before.startswith("2026-11-10")
    apply = client.post(
        f"/api/v1/ai/planner-notes/{proposal.json()['interaction_id']}/apply",
        params={"reason": "Supplier confirmed faster delivery"},
    )
    assert apply.status_code == 200
    after = client.get(f"/api/v1/receipts/{receipt['id']}").json()["expected_arrival"]
    assert after.startswith("2026-11-05")
    assert client.post(
        f"/api/v1/ai/planner-notes/{proposal.json()['interaction_id']}/apply",
        params={"reason": "Repeated attempt"},
    ).status_code == 409


def test_exceptions_resolve_and_reopen_when_supply_changes(client):
    product = client.post("/api/v1/products", json={"sku": "EX-1", "name": "Exception product"}).json()
    location = client.post("/api/v1/locations", json={"code": "EX-L", "name": "Exception warehouse"}).json()
    order = client.post("/api/v1/orders", json={
        "order_number": "EX-O", "customer_name": "Acme", "priority": "HIGH",
        "requested_ship_date": "2026-11-08T00:00:00",
        "lines": [{"product_id": product["id"], "requested_quantity": 5}]
    }).json()
    client.post(f"/api/v1/orders/{order['id']}/confirm")
    first = client.get("/api/v1/exceptions").json()
    backorder = next(row for row in first if row["order_id"] == order["id"] and row["exception_type"] == "BACKORDER")
    client.post("/api/v1/inventory/adjust", json={
        "product_id": product["id"], "location_id": location["id"], "delta": 5, "reason": "Restock"
    })
    resolved = client.get("/api/v1/exceptions", params={"exception_status": "RESOLVED"}).json()
    assert any(row["id"] == backorder["id"] for row in resolved)
    client.post("/api/v1/inventory/adjust", json={
        "product_id": product["id"], "location_id": location["id"], "delta": -5, "reason": "Correction"
    })
    reopened = client.get("/api/v1/exceptions").json()
    assert any(row["id"] == backorder["id"] for row in reopened)


def test_ai_line_reassignment_requires_confirmation(client):
    product = client.post("/api/v1/products", json={"sku": "MOVE-SKU", "name": "Move product"}).json()
    first = client.post("/api/v1/locations", json={"code": "MOVE-A", "name": "First warehouse"}).json()
    second = client.post("/api/v1/locations", json={"code": "MOVE-B", "name": "Second warehouse"}).json()
    for location, quantity in ((first, 2), (second, 7)):
        client.post("/api/v1/inventory/adjust", json={
            "product_id": product["id"], "location_id": location["id"], "delta": quantity, "reason": "Opening"
        })
    order = client.post("/api/v1/orders", json={
        "order_number": "MOVE-O", "customer_name": "Acme", "requested_ship_date": "2026-11-06T00:00:00",
        "lines": [{"product_id": product["id"], "requested_quantity": 5, "preferred_location_id": first["id"]}]
    }).json()
    client.post(f"/api/v1/orders/{order['id']}/confirm")
    proposal = client.post("/api/v1/ai/planner-notes", json={
        "text": "Reassign order MOVE-O SKU MOVE-SKU to MOVE-B"
    }).json()
    assert proposal["proposed_actions"][0]["action"] == "reassign_line"
    assert Decimal(client.get(f"/api/v1/orders/{order['id']}").json()["lines"][0]["allocated_quantity"]) == 2
    applied = client.post(
        f"/api/v1/ai/planner-notes/{proposal['interaction_id']}/apply",
        params={"reason": "Approved destination change"},
    )
    assert applied.status_code == 200
    allocation = client.get(f"/api/v1/orders/{order['id']}/allocations").json()
    active = [row for row in allocation if row["status"] == "ACTIVE"]
    assert active and all(row["location_id"] == second["id"] for row in active)
    assert Decimal(active[0]["quantity"]) == 5


def test_canceled_receipt_releases_future_supply_and_atp_shows_demand(client):
    product = client.post("/api/v1/products", json={"sku": "ATP-1", "name": "ATP product"}).json()
    location = client.post("/api/v1/locations", json={"code": "ATP-L", "name": "ATP warehouse"}).json()
    client.post("/api/v1/inventory/adjust", json={
        "product_id": product["id"], "location_id": location["id"], "delta": 4, "reason": "Opening"
    })
    receipt = client.post("/api/v1/receipts", json={
        "receipt_code": "ATP-R", "product_id": product["id"], "location_id": location["id"],
        "quantity": 6, "expected_arrival": "2026-11-12T00:00:00"
    }).json()
    order = client.post("/api/v1/orders", json={
        "order_number": "ATP-O", "customer_name": "Acme", "requested_ship_date": "2026-11-08T00:00:00",
        "lines": [{"product_id": product["id"], "requested_quantity": 7}]
    }).json()
    client.post(f"/api/v1/orders/{order['id']}/confirm")
    projection = client.get(f"/api/v1/atp/{product['id']}/{location['id']}").json()
    assert any(event["event"] == "ALLOCATED_DEMAND" for event in projection["events"])
    canceled = client.post(f"/api/v1/receipts/{receipt['id']}/cancel",
                           params={"reason": "Supplier canceled shipment"})
    assert canceled.status_code == 200
    updated = client.get(f"/api/v1/orders/{order['id']}").json()
    assert Decimal(updated["lines"][0]["allocated_quantity"]) == 4
    assert Decimal(updated["lines"][0]["backordered_quantity"]) == 3
    assert any(row["exception_type"] == "CANCELED_INBOUND" and row["order_id"] == order["id"]
               for row in client.get("/api/v1/exceptions").json())


def test_receipt_delay_order_edit_and_cancel_release_supply(client):
    product = client.post("/api/v1/products", json={"sku": "EDIT-1", "name": "Editable product"}).json()
    location = client.post("/api/v1/locations", json={"code": "EDIT-L", "name": "Edit warehouse"}).json()
    client.post("/api/v1/inventory/adjust", json={
        "product_id": product["id"], "location_id": location["id"], "delta": 3, "reason": "Opening"
    })
    receipt = client.post("/api/v1/receipts", json={
        "receipt_code": "EDIT-R", "product_id": product["id"], "location_id": location["id"],
        "quantity": 7, "expected_arrival": "2026-11-12T00:00:00"
    }).json()
    order = client.post("/api/v1/orders", json={
        "order_number": "EDIT-O", "customer_name": "Acme", "requested_ship_date": "2026-11-10T00:00:00",
        "lines": [{"product_id": product["id"], "requested_quantity": 8}]
    }).json()
    confirmed = client.post(f"/api/v1/orders/{order['id']}/confirm").json()
    line = confirmed["lines"][0]
    assert Decimal(line["allocated_quantity"]) == 8
    assert line["promised_ship_date"].startswith("2026-11-12")
    delayed = client.patch(
        f"/api/v1/receipts/{receipt['id']}",
        params={"reason": "Supplier advised a delay"},
        json={"expected_arrival": "2026-11-16T00:00:00"},
    )
    assert delayed.status_code == 200
    changed = client.get(f"/api/v1/orders/{order['id']}").json()["lines"][0]
    assert changed["promised_ship_date"].startswith("2026-11-16")
    client.post(f"/api/v1/receipts/{receipt['id']}/cancel", params={"reason": "Supplier canceled"})
    line = client.get(f"/api/v1/orders/{order['id']}").json()["lines"][0]
    assert Decimal(line["allocated_quantity"]) == 3
    assert Decimal(line["backordered_quantity"]) == 5
    edited = client.patch(f"/api/v1/orders/{order['id']}/lines/{line['id']}", json={
        "product_id": product["id"], "requested_quantity": 2, "preferred_location_id": location["id"]
    })
    assert edited.status_code == 200
    canceled = client.post(f"/api/v1/orders/{order['id']}/cancel", params={"reason": "Customer canceled"})
    assert canceled.status_code == 200
    after_cancel = client.get(f"/api/v1/orders/{order['id']}/allocations").json()
    assert not any(row["status"] == "ACTIVE" for row in after_cancel)
    stock = client.get("/api/v1/inventory", params={"sku": "EDIT-1"}).json()
    assert Decimal(stock[0]["quantity"]) == 3
