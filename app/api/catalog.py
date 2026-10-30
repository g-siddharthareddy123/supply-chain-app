from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import require_auth
from app.db import get_db
from app.models import Location, Product
from app.schemas import LocationCreate, LocationOut, ProductCreate, ProductOut

router = APIRouter(dependencies=[Depends(require_auth)])


@router.get("/products", response_model=list[ProductOut])
def list_products(db: Session = Depends(get_db)):
    return db.scalars(select(Product).order_by(Product.sku)).all()


@router.post("/products", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
def create_product(payload: ProductCreate, db: Session = Depends(get_db)):
    product = Product(**payload.model_dump())
    db.add(product)
    try:
        db.commit()
        db.refresh(product)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "SKU already exists or product data violates a database constraint") from exc
    return product


@router.get("/products/{product_id}", response_model=ProductOut)
def get_product(product_id: int, db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(404, "Product not found")
    return product


@router.put("/products/{product_id}", response_model=ProductOut)
def update_product(product_id: int, payload: ProductCreate, db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(404, "Product not found")
    for key, value in payload.model_dump().items():
        setattr(product, key, value)
    try:
        db.commit()
        db.refresh(product)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "SKU already exists or product data violates a database constraint") from exc
    return product


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(product_id: int, db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(404, "Product not found")
    db.delete(product)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Product is referenced by other records and cannot be deleted") from exc


@router.get("/locations", response_model=list[LocationOut])
def list_locations(db: Session = Depends(get_db)):
    return db.scalars(select(Location).order_by(Location.code)).all()


@router.post("/locations", response_model=LocationOut, status_code=status.HTTP_201_CREATED)
def create_location(payload: LocationCreate, db: Session = Depends(get_db)):
    location = Location(**payload.model_dump())
    db.add(location)
    try:
        db.commit()
        db.refresh(location)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Location code already exists") from exc
    return location


@router.get("/locations/{location_id}", response_model=LocationOut)
def get_location(location_id: int, db: Session = Depends(get_db)):
    location = db.get(Location, location_id)
    if not location:
        raise HTTPException(404, "Location not found")
    return location


@router.put("/locations/{location_id}", response_model=LocationOut)
def update_location(location_id: int, payload: LocationCreate, db: Session = Depends(get_db)):
    location = db.get(Location, location_id)
    if not location:
        raise HTTPException(404, "Location not found")
    for key, value in payload.model_dump().items():
        setattr(location, key, value)
    try:
        db.commit()
        db.refresh(location)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Location code already exists") from exc
    return location


@router.delete("/locations/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_location(location_id: int, db: Session = Depends(get_db)):
    location = db.get(Location, location_id)
    if not location:
        raise HTTPException(404, "Location not found")
    db.delete(location)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Location is referenced by other records and cannot be deleted") from exc
