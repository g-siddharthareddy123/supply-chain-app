from datetime import datetime
from decimal import Decimal
from enum import Enum

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum as SqlEnum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class ReceiptStatus(str, Enum):
    PLANNED = "PLANNED"
    IN_TRANSIT = "IN_TRANSIT"
    RECEIVED = "RECEIVED"
    CANCELED = "CANCELED"


class OrderPriority(str, Enum):
    LOW = "LOW"
    MED = "MED"
    HIGH = "HIGH"


class OrderStatus(str, Enum):
    DRAFT = "DRAFT"
    CONFIRMED = "CONFIRMED"
    FULFILLING = "FULFILLING"
    SHIPPED = "SHIPPED"
    CANCELED = "CANCELED"


class AllocationStatus(str, Enum):
    ACTIVE = "ACTIVE"
    RELEASED = "RELEASED"
    CONSUMED = "CONSUMED"


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (CheckConstraint("lead_time_days IS NULL OR lead_time_days >= 0",
                                      name="ck_product_lead_time_nonnegative"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sku: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    unit_of_measure: Mapped[str] = mapped_column(String(32), default="EA")
    lead_time_days: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    inventory: Mapped[list["Inventory"]] = relationship(back_populates="product")


class Location(Base):
    __tablename__ = "locations"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    timezone: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Inventory(Base):
    __tablename__ = "inventory"
    __table_args__ = (
        UniqueConstraint("product_id", "location_id", name="uq_inventory_product_location"),
        CheckConstraint("quantity >= 0", name="ck_inventory_nonnegative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), index=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="RESTRICT"), index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    product: Mapped[Product] = relationship(back_populates="inventory")
    location: Mapped[Location] = relationship()


class InboundReceipt(Base):
    __tablename__ = "inbound_receipts"
    __table_args__ = (CheckConstraint("quantity > 0", name="ck_receipt_quantity_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    receipt_code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), index=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="RESTRICT"), index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    expected_arrival: Mapped[datetime] = mapped_column(DateTime, index=True)
    status: Mapped[ReceiptStatus] = mapped_column(SqlEnum(ReceiptStatus), default=ReceiptStatus.PLANNED)
    received_at: Mapped[datetime | None] = mapped_column(DateTime)
    product: Mapped[Product] = relationship()
    location: Mapped[Location] = relationship()


class CustomerOrder(Base):
    __tablename__ = "customer_orders"
    __table_args__ = (Index("ix_orders_status_priority_created", "status", "priority", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    order_number: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    customer_name: Mapped[str] = mapped_column(String(200), index=True)
    priority: Mapped[OrderPriority] = mapped_column(SqlEnum(OrderPriority), default=OrderPriority.MED)
    requested_ship_date: Mapped[datetime] = mapped_column(DateTime, index=True)
    status: Mapped[OrderStatus] = mapped_column(SqlEnum(OrderStatus), default=OrderStatus.DRAFT)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    lines: Mapped[list["OrderLine"]] = relationship(back_populates="order", cascade="all, delete-orphan")


class OrderLine(Base):
    __tablename__ = "order_lines"
    __table_args__ = (
        CheckConstraint("requested_quantity > 0", name="ck_line_quantity_positive"),
        CheckConstraint("allocated_quantity >= 0 AND shipped_quantity >= 0 AND backordered_quantity >= 0",
                        name="ck_line_quantities_nonnegative"),
        CheckConstraint("shipped_quantity <= requested_quantity", name="ck_shipped_not_over_requested"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("customer_orders.id", ondelete="RESTRICT"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), index=True)
    requested_quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    preferred_location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id", ondelete="RESTRICT"))
    allocated_quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=0)
    shipped_quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=0)
    backordered_quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=0)
    promised_ship_date: Mapped[datetime | None] = mapped_column(DateTime)
    promise_override: Mapped[datetime | None] = mapped_column(DateTime)
    promise_explanation: Mapped[str | None] = mapped_column(Text)
    order: Mapped[CustomerOrder] = relationship(back_populates="lines")
    product: Mapped[Product] = relationship()


class Allocation(Base):
    __tablename__ = "allocations"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_allocation_quantity_positive"),
        CheckConstraint("source_type IN ('ON_HAND', 'RECEIPT')", name="ck_allocation_source_type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    order_line_id: Mapped[int] = mapped_column(ForeignKey("order_lines.id", ondelete="RESTRICT"), index=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="RESTRICT"), index=True)
    source_type: Mapped[str] = mapped_column(String(24))
    source_id: Mapped[int] = mapped_column(Integer)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    status: Mapped[AllocationStatus] = mapped_column(SqlEnum(AllocationStatus), default=AllocationStatus.ACTIVE)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Shipment(Base):
    __tablename__ = "shipments"

    id: Mapped[int] = mapped_column(primary_key=True)
    shipment_code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("customer_orders.id", ondelete="RESTRICT"), index=True)
    shipped_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    order: Mapped[CustomerOrder] = relationship()
    lines: Mapped[list["ShipmentLine"]] = relationship(back_populates="shipment", cascade="all, delete-orphan")


class ShipmentLine(Base):
    __tablename__ = "shipment_lines"
    __table_args__ = (CheckConstraint("quantity > 0", name="ck_shipment_quantity_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    shipment_id: Mapped[int] = mapped_column(ForeignKey("shipments.id", ondelete="RESTRICT"), index=True)
    order_line_id: Mapped[int] = mapped_column(ForeignKey("order_lines.id", ondelete="RESTRICT"), index=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="RESTRICT"))
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    shipment: Mapped[Shipment] = relationship(back_populates="lines")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(64), index=True)
    entity_id: Mapped[str] = mapped_column(String(64), index=True)
    action: Mapped[str] = mapped_column(String(64))
    reason: Mapped[str] = mapped_column(Text)
    details: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)


class ExceptionRecord(Base):
    __tablename__ = "exceptions"
    __table_args__ = (Index("ix_exception_order_type_status", "order_id", "exception_type", "status"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("customer_orders.id", ondelete="RESTRICT"), index=True)
    exception_type: Mapped[str] = mapped_column(String(64))
    details: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="OPEN", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class AIInteraction(Base):
    __tablename__ = "ai_interactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    interaction_type: Mapped[str] = mapped_column(String(64), index=True)
    input_text: Mapped[str] = mapped_column(Text)
    proposed_actions: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    preview: Mapped[str | None] = mapped_column(Text)
    application_status: Mapped[str] = mapped_column(String(24), default="PROPOSED")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class CustomerMessage(Base):
    __tablename__ = "customer_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("customer_orders.id", ondelete="RESTRICT"), index=True)
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="DRAFT")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    sent_at: Mapped[datetime | None] = mapped_column(DateTime)
