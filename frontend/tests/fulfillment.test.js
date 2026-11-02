import assert from "node:assert/strict";
import test from "node:test";
import {
  getLineFulfillment,
  getLineLocationSummary,
  getOrderFulfillment,
} from "../src/utils/fulfillment.js";

test("summarizes an unfulfilled order without counting reservations as shipped", () => {
  const order = {
    status: "CONFIRMED",
    lines: [
      {
        requested_quantity: "10",
        allocated_quantity: "6",
        shipped_quantity: "0",
        backordered_quantity: "4",
      },
    ],
  };

  assert.deepEqual(getOrderFulfillment(order), {
    ordered: 10,
    allocated: 6,
    shipped: 0,
    remaining: 10,
    backordered: 4,
    percent: 0,
  });
});

test("summarizes partial fulfillment across multiple lines", () => {
  const order = {
    status: "FULFILLING",
    lines: [
      {
        requested_quantity: 10,
        allocated_quantity: 3,
        shipped_quantity: 4,
        backordered_quantity: 3,
      },
      {
        requested_quantity: 5,
        allocated_quantity: 4,
        shipped_quantity: 1,
        backordered_quantity: 0,
      },
    ],
  };

  assert.deepEqual(getOrderFulfillment(order), {
    ordered: 15,
    allocated: 7,
    shipped: 5,
    remaining: 10,
    backordered: 3,
    percent: (5 / 15) * 100,
  });
});

test("uses active allocation records and leaves canceled backorders not applicable", () => {
  const canceledOrder = {
    status: "CANCELED",
    lines: [
      {
        requested_quantity: 8,
        allocated_quantity: 5,
        shipped_quantity: 2,
        backordered_quantity: 3,
      },
    ],
  };

  assert.deepEqual(getOrderFulfillment(canceledOrder), {
    ordered: 8,
    allocated: 0,
    shipped: 2,
    remaining: 6,
    backordered: null,
    percent: 25,
  });
  assert.equal(
    getOrderFulfillment(
      { ...canceledOrder, status: "FULFILLING" },
      [
        { status: "ACTIVE", quantity: "2.5" },
        { status: "RELEASED", quantity: "4" },
      ],
    ).allocated,
    2.5,
  );
});

test("handles full fulfillment and unavailable or zero ordered quantity safely", () => {
  const fulfilled = {
    status: "SHIPPED",
    lines: [
      {
        requested_quantity: 4,
        allocated_quantity: 0,
        shipped_quantity: 4,
        backordered_quantity: 0,
      },
    ],
  };
  assert.equal(getOrderFulfillment(fulfilled).percent, 100);
  assert.equal(getOrderFulfillment(fulfilled).allocated, 0);
  assert.equal(getLineFulfillment(fulfilled, fulfilled.lines[0]).status, "Fulfilled");
  assert.equal(getLineFulfillment(fulfilled, fulfilled.lines[0]).allocated, 0);

  const zero = {
    status: "DRAFT",
    lines: [
      {
        requested_quantity: 0,
        allocated_quantity: 0,
        shipped_quantity: 0,
        backordered_quantity: 0,
      },
    ],
  };
  assert.equal(getOrderFulfillment(zero).percent, null);
  assert.equal(getOrderFulfillment({ status: "DRAFT", lines: [] }).ordered, 0);
  assert.equal(
    getOrderFulfillment({
      status: "DRAFT",
      lines: [{ requested_quantity: null, shipped_quantity: 0 }],
    }).ordered,
    null,
  );
});

test("aggregates locations across active allocations and multiple shipments", () => {
  const locations = getLineLocationSummary(
    7,
    [
      {
        line_id: 7,
        location_id: 2,
        quantity: 3,
        status: "ACTIVE",
      },
      {
        line_id: 7,
        location_id: 3,
        quantity: 9,
        status: "RELEASED",
      },
    ],
    [
      { lines: [{ order_line_id: 7, location_id: 2, quantity: 2 }] },
      { lines: [{ order_line_id: 7, location_id: 4, quantity: 1 }] },
    ],
    { 2: { code: "WH-A", name: "Alpha" }, 4: { code: "WH-B", name: "Beta" } },
  );

  assert.deepEqual(locations, [
    {
      locationId: 2,
      location: { code: "WH-A", name: "Alpha" },
      allocated: 3,
      shipped: 2,
    },
    {
      locationId: 4,
      location: { code: "WH-B", name: "Beta" },
      allocated: 0,
      shipped: 1,
    },
  ]);
});
