function quantity(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sum(values) {
  return values.some((value) => value === null)
    ? null
    : values.reduce((total, value) => total + value, 0);
}

function remainingFor(line) {
  const ordered = quantity(line.requested_quantity);
  const shipped = quantity(line.shipped_quantity);
  return ordered === null || shipped === null
    ? null
    : Math.max(0, ordered - shipped);
}

export function getOrderFulfillment(order, allocations) {
  const lines = Array.isArray(order?.lines) ? order.lines : [];
  const isCanceled = order?.status === "CANCELED";
  const isTerminal = isCanceled || order?.status === "SHIPPED";
  const allocated = Array.isArray(allocations)
    ? sum(
        allocations
          .filter((allocation) => allocation.status === "ACTIVE")
          .map((allocation) => quantity(allocation.quantity)),
      )
    : isTerminal
      ? 0
      : sum(lines.map((line) => quantity(line.allocated_quantity)));
  const ordered = sum(lines.map((line) => quantity(line.requested_quantity)));
  const shipped = sum(lines.map((line) => quantity(line.shipped_quantity)));
  const remaining = sum(lines.map(remainingFor));
  const backordered = isCanceled
    ? null
    : sum(lines.map((line) => quantity(line.backordered_quantity)));

  return {
    ordered,
    allocated,
    shipped,
    remaining,
    backordered,
    percent:
      ordered !== null && shipped !== null && ordered > 0
        ? (shipped / ordered) * 100
        : null,
  };
}

export function getLineFulfillment(order, line, allocations) {
  const isCanceled = order?.status === "CANCELED";
  const isTerminal = isCanceled || order?.status === "SHIPPED";
  const activeAllocations = Array.isArray(allocations)
    ? allocations.filter(
        (allocation) =>
          allocation.line_id === line.id && allocation.status === "ACTIVE",
      )
    : [];
  const allocated = Array.isArray(allocations)
    ? sum(activeAllocations.map((allocation) => quantity(allocation.quantity)))
    : isTerminal
      ? 0
      : quantity(line.allocated_quantity);
  const shipped = quantity(line.shipped_quantity);
  const ordered = quantity(line.requested_quantity);
  const backordered = isCanceled
    ? null
    : quantity(line.backordered_quantity);

  let status = "Not available";
  if (isCanceled) status = "Canceled";
  else if (ordered !== null && shipped !== null && shipped >= ordered)
    status = "Fulfilled";
  else if (shipped !== null && shipped > 0) status = "Partially shipped";
  else if (
    allocated !== null &&
    backordered !== null &&
    allocated > 0 &&
    backordered > 0
  )
    status = "Partially allocated";
  else if (allocated !== null && allocated > 0) status = "Allocated";
  else if (order?.status === "DRAFT") status = "Draft - not allocated";
  else if (backordered !== null && backordered > 0) status = "Backordered";
  else if (allocated === 0 && backordered === 0) status = "Awaiting shipment";

  return {
    ordered,
    allocated,
    shipped,
    remaining:
      ordered === null || shipped === null
        ? null
        : Math.max(0, ordered - shipped),
    backordered,
    status,
  };
}

export function getLineLocationSummary(
  lineId,
  allocations,
  shipments,
  locationMap,
) {
  const locationTotals = new Map();
  const addQuantity = (locationId, kind, value) => {
    if (locationId == null) return;
    const total = locationTotals.get(locationId) || {
      allocated: 0,
      shipped: 0,
    };
    total[kind] += Number(value) || 0;
    locationTotals.set(locationId, total);
  };

  (Array.isArray(allocations) ? allocations : [])
    .filter(
      (allocation) =>
        allocation.line_id === lineId && allocation.status === "ACTIVE",
    )
    .forEach((allocation) =>
      addQuantity(allocation.location_id, "allocated", allocation.quantity),
    );
  (Array.isArray(shipments) ? shipments : [])
    .flatMap((shipment) => shipment.lines || [])
    .filter((shipmentLine) => shipmentLine.order_line_id === lineId)
    .forEach((shipmentLine) =>
      addQuantity(shipmentLine.location_id, "shipped", shipmentLine.quantity),
    );

  return [...locationTotals.entries()].map(([locationId, totals]) => ({
    locationId,
    location: locationMap[locationId],
    ...totals,
  }));
}
