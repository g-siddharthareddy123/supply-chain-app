from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models import OrderPriority, OrderStatus, ReceiptStatus


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ProductCreate(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    unit_of_measure: str = "EA"
    lead_time_days: int | None = Field(default=None, ge=0)


class LocationCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    timezone: str | None = None


class ProductOut(ORMModel):
    id: int
    sku: str
    name: str
    unit_of_measure: str
    lead_time_days: int | None


class LocationOut(ORMModel):
    id: int
    code: str
    name: str
    timezone: str | None


class ReceiptCreate(BaseModel):
    receipt_code: str
    product_id: int
    location_id: int
    quantity: Decimal = Field(gt=0)
    expected_arrival: datetime


class ReceiptUpdate(BaseModel):
    quantity: Decimal | None = Field(default=None, gt=0)
    expected_arrival: datetime | None = None
    status: ReceiptStatus | None = None


class OrderLineCreate(BaseModel):
    product_id: int
    requested_quantity: Decimal = Field(gt=0)
    preferred_location_id: int | None = None


class OrderCreate(BaseModel):
    order_number: str
    customer_name: str
    priority: OrderPriority = OrderPriority.MED
    requested_ship_date: datetime
    lines: list[OrderLineCreate] = Field(min_length=1)


class OrderUpdate(BaseModel):
    customer_name: str | None = Field(default=None, min_length=1, max_length=200)
    priority: OrderPriority | None = None
    requested_ship_date: datetime | None = None


class OrderLineOut(ORMModel):
    id: int
    product_id: int
    requested_quantity: Decimal
    preferred_location_id: int | None
    allocated_quantity: Decimal
    shipped_quantity: Decimal
    backordered_quantity: Decimal
    promised_ship_date: datetime | None
    promise_explanation: str | None


class OrderOut(ORMModel):
    id: int
    order_number: str
    customer_name: str
    priority: OrderPriority
    requested_ship_date: datetime
    status: OrderStatus
    created_at: datetime
    lines: list[OrderLineOut]


class InventoryAdjust(BaseModel):
    product_id: int
    location_id: int
    delta: Decimal
    reason: str = Field(min_length=1)


class PlannerNote(BaseModel):
    text: str = Field(min_length=1)


class MessageUpdate(BaseModel):
    message: str = Field(min_length=1)
