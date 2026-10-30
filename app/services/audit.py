from sqlalchemy.orm import Session

from app.models import AuditLog


def audit(db: Session, entity_type: str, entity_id: int | str, action: str, reason: str,
          details: str | None = None) -> AuditLog:
    if not reason.strip():
        raise ValueError("An audit reason is required")
    record = AuditLog(entity_type=entity_type, entity_id=str(entity_id), action=action,
                      reason=reason.strip(), details=details)
    db.add(record)
    return record
