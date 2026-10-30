from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import select

from app.db import SessionLocal
from app.models import (
    CustomerOrder, InboundReceipt, Inventory, Location, OrderLine, OrderPriority, OrderStatus,
    Product, ReceiptStatus,
)
from app.services.planning import rebuild_allocations


def seed():
    db = SessionLocal()
    try:
        locations = []
        for code, name, timezone in [
            ("SEA", "Seattle Distribution", "America/Los_Angeles"),
            ("CHI", "Chicago Distribution", "America/Chicago"),
            ("ATL", "Atlanta Distribution", "America/New_York"),
        ]:
            row = db.scalar(select(Location).where(Location.code == code))
            if not row:
                row = Location(code=code, name=name, timezone=timezone)
                db.add(row)
            locations.append(row)
        products = []
        for i in range(1, 13):
            sku = f"SKU-{i:03d}"
            row = db.scalar(select(Product).where(Product.sku == sku))
            if not row:
                row = Product(sku=sku, name=f"Control Tower Product {i}", unit_of_measure="EA",
                              lead_time_days=3 + (i % 8))
                db.add(row)
            products.append(row)
        db.flush()
        for product_index, product in enumerate(products):
            for location_index, location in enumerate(locations):
                row = db.scalar(select(Inventory).where(
                    Inventory.product_id == product.id, Inventory.location_id == location.id
                ))
                if not row:
                    quantity = Decimal(0) if product_index < 4 and location_index == 0 else Decimal(10 + product_index)
                    db.add(Inventory(product_id=product.id, location_id=location.id, quantity=quantity))

        base = datetime.utcnow()
        for index in range(4):
            code = f"RCPT-{index + 1:03d}"
            row = db.scalar(select(InboundReceipt).where(InboundReceipt.receipt_code == code))
            if not row:
                db.add(InboundReceipt(
                    receipt_code=code, product_id=products[index].id, location_id=locations[index % 3].id,
                    quantity=Decimal(25 + index * 5), expected_arrival=base + timedelta(days=index + 2),
                    status=ReceiptStatus.CANCELED if index == 3 else ReceiptStatus.IN_TRANSIT if index == 2
                    else ReceiptStatus.PLANNED,
                ))

        for index in range(20):
            number = f"ORD-{index + 1:04d}"
            order = db.scalar(select(CustomerOrder).where(CustomerOrder.order_number == number))
            if order:
                continue
            order = CustomerOrder(
                order_number=number, customer_name=f"Customer {(index % 7) + 1}",
                priority=[OrderPriority.HIGH, OrderPriority.MED, OrderPriority.LOW][index % 3],
                requested_ship_date=base + timedelta(days=(index % 6) + 1),
                status=OrderStatus.DRAFT if index in (0, 1) else OrderStatus.CONFIRMED,
            )
            order.lines = [
                OrderLine(product_id=products[index % len(products)].id,
                          requested_quantity=Decimal(8 + (index % 5) * 7),
                          preferred_location_id=locations[index % 3].id if index % 4 == 0 else None)
            ]
            db.add(order)
        db.flush()
        rebuild_allocations(db)
        db.commit()
        print("Seeded 3 locations, 12 products, 4 receipts, and 20 orders (existing records preserved).")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
