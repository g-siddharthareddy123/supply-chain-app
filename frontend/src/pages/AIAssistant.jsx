import { useCallback, useMemo, useState } from "react";
import { CircleAlert, ClipboardList, MessageSquareText, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { api, allOrders } from "../api";
import { getErrorMessage } from "../api/client";
import {
  Badge,
  Button,
  Card,
  DataTable,
  ErrorState,
  Loading,
  PageHeader,
} from "../components";
import {
  useLoad,
  useToast,
  FormField,
  dateLabel,
  number,
  asArray,
} from "./shared";

const earlierDate = (value) => {
  if (!value) return "";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "";
  return new Date(Date.UTC(year, month - 1, day - 1))
    .toISOString()
    .slice(0, 10);
};
const laterDate = (value) => {
  if (!value) return "";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "";
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasLocationCode = (text, code) =>
  new RegExp(`\\b${escapeRegExp(code)}\\b`, "i").test(text);
const hasIdentifier = (text, identifier) =>
  new RegExp(
    `(?<![A-Za-z0-9_-])${escapeRegExp(String(identifier))}(?![A-Za-z0-9_-])`,
    "i",
  ).test(text);

function orderBackordered(order) {
  return asArray(order?.lines).reduce(
    (total, line) => total + Number(line.backordered_quantity || 0),
    0,
  );
}

export function AIAssistant() {
  const notify = useToast();
  const [section, setSection] = useState("planning");
  const [planningMode, setPlanningMode] = useState("guided");
  const [actionType, setActionType] = useState("expedite");
  const [selectedReceiptId, setSelectedReceiptId] = useState("");
  const [receiptDate, setReceiptDate] = useState("");
  const [selectedLineId, setSelectedLineId] = useState("");
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [note, setNote] = useState("");
  const [proposal, setProposal] = useState(null);
  const [approvalReason, setApprovalReason] = useState("");
  const [approved, setApproved] = useState(false);
  const [proposalError, setProposalError] = useState("");
  const [proposalDismissed, setProposalDismissed] = useState(false);
  const [proposalApplyUnconfirmed, setProposalApplyUnconfirmed] =
    useState(false);
  const [messageOrderId, setMessageOrderId] = useState("");
  const [messageRecord, setMessageRecord] = useState(null);
  const [messageText, setMessageText] = useState("");
  const [summaryOrderId, setSummaryOrderId] = useState("");
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState("");
  const [working, setWorking] = useState(false);

  const dataLoader = useCallback(
    () =>
      Promise.all([
        allOrders(),
        api.receipts.list(),
        api.products.list(),
        api.locations.list(),
        api.inventory.list(),
      ]),
    [],
  );
  const {
    data: context,
    loading,
    error,
    refresh: refreshContext,
  } = useLoad(dataLoader);
  const [orders, receipts, products, locations, inventory] = context || [
    [],
    [],
    [],
    [],
    [],
  ];
  const orderMap = useMemo(
    () => Object.fromEntries(asArray(orders).map((order) => [order.id, order])),
    [orders],
  );
  const productMap = useMemo(
    () =>
      Object.fromEntries(
        asArray(products).map((product) => [product.id, product]),
      ),
    [products],
  );
  const locationMap = useMemo(
    () =>
      Object.fromEntries(
        asArray(locations).map((location) => [location.id, location]),
      ),
    [locations],
  );
  const allLines = useMemo(
    () =>
      asArray(orders).flatMap((order) =>
        asArray(order.lines).map((line) => ({ ...line, order })),
      ),
    [orders],
  );
  const eligibleReceipts = asArray(receipts).filter((receipt) =>
    ["PLANNED", "IN_TRANSIT"].includes(
      String(receipt.status).toUpperCase(),
    ),
  );
  const selectedReceipt = eligibleReceipts.find(
    (receipt) => String(receipt.id) === selectedReceiptId,
  );
  const selectedLine = allLines.find(
    (line) => String(line.id) === selectedLineId,
  );
  const selectedProduct = selectedLine && productMap[selectedLine.product_id];
  const selectedLocation = locations.find(
    (location) => String(location.id) === destinationLocationId,
  );
  const selectableLines = allLines.filter((line) => {
    if (!["CONFIRMED", "FULFILLING"].includes(line.order.status)) return false;
    const product = productMap[line.product_id];
    if (!product) return false;
    return (
      asArray(line.order.lines).filter(
        (otherLine) => productMap[otherLine.product_id]?.sku === product.sku,
      ).length === 1
    );
  });
  const proposalActions = asArray(proposal?.proposed_actions);
  const proposalLineOrderIds = proposalActions
    .filter((action) => action.action === "reassign_line")
    .map(
      (action) =>
        asArray(orders).find(
          (order) => order.order_number === action.order_number,
        )?.id,
    )
    .filter(Boolean);
  const allocationOrderIds = [
    ...new Set([
      ...(selectedLine ? [selectedLine.order.id] : []),
      ...(summaryOrderId ? [Number(summaryOrderId)] : []),
      ...proposalLineOrderIds,
    ]),
  ];
  const allocationKey = allocationOrderIds.join(",");
  const allocationLoader = useCallback(
    async () => {
      if (!allocationOrderIds.length) return {};
      return Object.fromEntries(
        await Promise.all(
          allocationOrderIds.map(async (id) => [
            id,
            await api.orders.allocations(id),
          ]),
        ),
      );
    },
    [allocationKey],
  );
  const {
    data: allocationData,
    loading: allocationsLoading,
    error: allocationsError,
    refresh: refreshAllocations,
  } = useLoad(allocationLoader, [allocationKey]);
  const allocationsByOrder = allocationData || {};

  const selectedReceiptInstruction = selectedReceipt
    ? `${actionType === "delay" ? "Delay" : "Expedite"} ${selectedReceipt.receipt_code} to ${receiptDate}`
    : "";
  const matchingReceiptCodes = selectedReceipt
    ? asArray(receipts).filter((receipt) =>
        hasIdentifier(selectedReceiptInstruction, receipt.receipt_code),
      )
    : [];
  const receiptInstructionAmbiguous =
    matchingReceiptCodes.length > 1 ||
    (selectedReceipt &&
      asArray(receipts).some(
        (receipt) =>
          receipt.id !== selectedReceipt.id &&
          String(receipt.receipt_code).toLowerCase() ===
            String(selectedReceipt.receipt_code).toLowerCase(),
      ));
  const selectedLineInstruction =
    selectedLine && selectedProduct && selectedLocation
      ? `Reassign ${selectedLine.order.order_number} ${selectedProduct.sku} to ${selectedLocation.code}`
      : "";
  const matchingOrders = selectedLineInstruction
    ? asArray(orders).filter((order) =>
        hasIdentifier(selectedLineInstruction, order.order_number),
      )
    : [];
  const matchingLocations = selectedLineInstruction
    ? asArray(locations).filter((location) =>
        hasLocationCode(selectedLineInstruction, location.code),
      )
    : [];
  const matchingSkuLines = selectedLine
    ? asArray(selectedLine.order.lines).filter(
        (line) =>
          productMap[line.product_id]?.sku === selectedProduct?.sku,
      )
    : [];
  const lineInstructionAmbiguous =
    matchingOrders.length !== 1 ||
    matchingLocations.length !== 1 ||
    matchingSkuLines.length !== 1;
  const receiptAction = actionType !== "reassign";
  const guidedInstruction =
    receiptAction
      ? selectedReceiptInstruction
      : selectedLineInstruction;
  const guidedInstructionValid =
    receiptAction
      ? Boolean(
          selectedReceipt &&
            receiptDate &&
            (actionType === "delay"
              ? receiptDate > String(selectedReceipt.expected_arrival).slice(0, 10)
              : receiptDate < String(selectedReceipt.expected_arrival).slice(0, 10)) &&
            !receiptInstructionAmbiguous,
        )
      : Boolean(
          selectedLine &&
            selectedProduct &&
            selectedLocation &&
            !lineInstructionAmbiguous,
        );

  const messageOrder = orderMap[Number(messageOrderId)];
  const summaryOrder = orderMap[Number(summaryOrderId)];
  const summaryLineMap = Object.fromEntries(
    asArray(summaryOrder?.lines).map((line) => [line.id, line]),
  );
  const summaryProductIds = new Set(
    asArray(summaryOrder?.lines).map((line) => Number(line.product_id)),
  );
  const summaryIncomingReceipts = asArray(receipts).filter(
    (receipt) =>
      summaryProductIds.has(Number(receipt.product_id)) &&
      ["PLANNED", "IN_TRANSIT"].includes(
        String(receipt.status).toUpperCase(),
      ),
  );
  const summaryAllocations = asArray(
    allocationsByOrder[Number(summaryOrderId)],
  ).filter(
    (allocation) => String(allocation.status).toUpperCase() === "ACTIVE",
  );
  const summaryAlternativeStock = asArray(
    summary?.fulfillment_plan,
  ).flatMap((planLine) => {
    const line = summaryLineMap[planLine.line_id];
    if (!line) return [];
    const currentLocationIds = new Set([
      ...summaryAllocations
        .filter(
          (allocation) =>
            Number(allocation.line_id) === Number(line.id),
        )
        .map((allocation) => Number(allocation.location_id)),
      ...(line.preferred_location_id
        ? [Number(line.preferred_location_id)]
        : []),
    ]);
    return asArray(inventory)
      .filter(
        (row) =>
          Number(row.product_id) === Number(line.product_id) &&
          Number(row.quantity) > 0 &&
          !currentLocationIds.has(Number(row.location_id)),
      )
      .map((row) => ({
        lineId: line.id,
        product: productMap[line.product_id],
        location: locationMap[row.location_id],
        quantity: row.quantity,
      }));
  });
  const messageDirty =
    Boolean(messageRecord) && messageText !== messageRecord.message;
  const receiptExampleDate = selectedReceipt
    ? earlierDate(selectedReceipt.expected_arrival)
    : "";
  const receiptExample =
    selectedReceipt && receiptExampleDate
      ? `Expedite ${selectedReceipt.receipt_code} to ${receiptExampleDate}`
      : "";
  const delayExampleDate = selectedReceipt
    ? laterDate(selectedReceipt.expected_arrival)
    : "";
  const delayExample =
    selectedReceipt && delayExampleDate
      ? `Delay ${selectedReceipt.receipt_code} to ${delayExampleDate}`
      : "";
  const reassignExample =
    selectedLine && selectedProduct && selectedLocation && !lineInstructionAmbiguous
      ? selectedLineInstruction
      : "";

  async function startProposal(instruction) {
    if (!instruction.trim()) return;
    setWorking(true);
    setProposalError("");
    setApprovalReason("");
    setApproved(false);
    setProposalDismissed(false);
    setProposalApplyUnconfirmed(false);
    setProposal(null);
    try {
      const result = await api.ai.propose(instruction.trim());
      setProposal(result);
      notify(
        asArray(result.proposed_actions).length
          ? "Proposal created for review. No planning changes were applied."
          : "No complete supported action was identified. No planning changes were applied.",
        asArray(result.proposed_actions).length ? "success" : "error",
      );
    } catch (err) {
      setProposalError(getErrorMessage(err));
      notify(getErrorMessage(err), "error");
    } finally {
      setWorking(false);
    }
  }

  function submitGuided(event) {
    event.preventDefault();
    if (!guidedInstructionValid) {
      return;
    }
    if (receiptAction) {
      const currentDate = String(selectedReceipt.expected_arrival).slice(0, 10);
      if (
        actionType === "delay"
          ? receiptDate <= currentDate
          : receiptDate >= currentDate
      ) {
        return;
      }
    }
    startProposal(guidedInstruction);
  }

  function submitFreeText(event) {
    event.preventDefault();
    startProposal(note);
  }

  async function applyProposal() {
    if (!proposal?.interaction_id || !proposalActions.length) return;
    if (!approvalReason.trim()) {
      setProposalError("Enter a reason before approving this proposal.");
      return;
    }
    if (
      !window.confirm(
        "Apply the reviewed proposal? This will update the corresponding receipt date or order-line fulfillment preference.",
      )
    )
      return;
    setWorking(true);
    setProposalError("");
    try {
      const result = await api.ai.apply(
        proposal.interaction_id,
        approvalReason.trim(),
      );
      setProposal({ ...proposal, application_status: result.application_status });
      setApproved(false);
      if (result.application_status !== "APPLIED") {
        setProposalApplyUnconfirmed(true);
        refreshContext();
        refreshAllocations();
        setProposalError(
          `The backend returned status ${result.application_status || "unknown"}; the application is not confirmed.`,
        );
        return;
      }
      notify(
        "Proposal applied. Relevant receipts, orders, and allocations are refreshing.",
      );
      refreshContext();
      refreshAllocations();
    } catch (err) {
      setProposalApplyUnconfirmed(true);
      refreshContext();
      refreshAllocations();
      setProposalError(getErrorMessage(err));
      notify(getErrorMessage(err), "error");
    } finally {
      setWorking(false);
    }
  }

  async function generateMessage() {
    if (!messageOrderId) return;
    if (
      messageDirty &&
      !window.confirm("Discard your unsaved message edits and generate a new draft?")
    )
      return;
    setWorking(true);
    try {
      const result = await api.ai.customerMessage(messageOrderId);
      setMessageRecord(result);
      const lineDetails = asArray(messageOrder?.lines)
        .map((line) => {
          const product = productMap[line.product_id];
          const productLabel = product
            ? `${product.sku} — ${product.name}`
            : "Product not available";
          return `- ${productLabel}: ${number(line.requested_quantity)} ordered (line ${line.id}).`;
        })
        .join("\n");
      const backorderRisks = asArray(messageOrder?.lines)
        .filter((line) => Number(line.backordered_quantity) > 0)
        .map(
          (line) =>
            `- Order line ${line.id} has ${number(line.backordered_quantity)} backordered.`,
        )
        .join("\n");
      const orderContext = lineDetails
        ? `\n\nItems ordered (from persisted order lines):\n${lineDetails}${backorderRisks ? `\n\nCurrent fulfillment risks:\n${backorderRisks}` : ""}`
        : "\n\nOrder-line details are not available from the current order response.";
      setMessageText(`${result.message || ""}${orderContext}`);
      notify(
        "Customer draft generated with persisted order-line details. Save the draft before marking it sent.",
      );
    } catch (err) {
      notify(getErrorMessage(err), "error");
    } finally {
      setWorking(false);
    }
  }

  function changeMessageOrder(event) {
    const nextOrderId = event.target.value;
    if (
      messageDirty &&
      !window.confirm("Discard your unsaved message edits and select another order?")
    )
      return;
    setMessageOrderId(nextOrderId);
    setMessageRecord(null);
    setMessageText("");
  }

  async function saveMessage() {
    if (!messageText.trim()) {
      notify("The message cannot be empty.", "error");
      return;
    }
    if (!messageRecord || messageRecord.status === "SENT") return;
    setWorking(true);
    try {
      const result = await api.ai.updateMessage(
        messageRecord.id,
        messageText.trim(),
      );
      setMessageRecord(result);
      setMessageText(result.message || "");
      notify("Draft changes saved.");
    } catch (err) {
      notify(getErrorMessage(err), "error");
    } finally {
      setWorking(false);
    }
  }

  async function markSent() {
    if (!messageRecord || messageRecord.status === "SENT") return;
    if (
      !window.confirm(
        "Confirm that you sent this message outside the application? This only marks the message SENT here; it does not send an email.",
      )
    )
      return;
    setWorking(true);
    try {
      const result = await api.ai.markSent(messageRecord.id);
      if (
        result.status !== "SENT" ||
        (result.email_sent != null && result.email_sent !== false)
      ) {
        throw new Error(
          "The backend did not confirm the SENT status; the message status was not updated in the UI.",
        );
      }
      setMessageRecord({ ...messageRecord, status: result.status });
      notify("Message marked as sent in this application. No email was sent.");
    } catch (err) {
      notify(getErrorMessage(err), "error");
    } finally {
      setWorking(false);
    }
  }

  async function loadSummary() {
    if (!summaryOrderId) return;
    setWorking(true);
    setSummaryError("");
    try {
      setSummary(await api.ai.exceptionSummary(summaryOrderId));
    } catch (err) {
      setSummary(null);
      setSummaryError(getErrorMessage(err));
    } finally {
      setWorking(false);
    }
  }

  function proposalLine(action) {
    const order = asArray(orders).find(
      (candidate) => candidate.order_number === action.order_number,
    );
    const line = asArray(order?.lines).find(
      (candidate) => candidate.id === action.line_id,
    );
    return line ? { order, line, product: productMap[line.product_id] } : null;
  }

  function allocationLocations(orderId, lineId) {
    return asArray(allocationsByOrder[orderId])
      .filter(
        (allocation) =>
          Number(allocation.line_id) === Number(lineId) &&
          String(allocation.status).toUpperCase() === "ACTIVE",
      )
      .map((allocation) => locationMap[allocation.location_id])
      .filter(Boolean);
  }

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} />;

  return (
    <>
      <PageHeader
        title="AI assistant"
        description="Understand fulfillment problems, prepare planning actions for approval, and create customer update drafts using your existing supply chain data."
      />
      <div className="notice info ai-intro">
        <Sparkles size={17} />
        <span>
          This is a rule-based assistant using your existing supply chain data.
          It is not an external AI service, and it never applies a planning
          proposal without your approval.
        </span>
      </div>
      <div className="mode-tabs ai-section-tabs" role="tablist">
        {[
          ["planning", "Planning Assistant"],
          ["messages", "Customer Messages"],
          ["summary", "Order Risk Summary"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={section === value}
            className={section === value ? "selected" : ""}
            onClick={() => setSection(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {section === "planning" && (
        <div className="ai-workflow">
          <Card className="ai-card">
            <div className="ai-card-heading">
              <div className="ai-icon">
                <ClipboardList size={19} />
              </div>
              <div>
                <h3>Prepare a planning proposal</h3>
                <span>
                  The existing rule parser supports receipt delays/expedites
                  and order-line reassignment. It does not support split
                  shipments.
                </span>
              </div>
            </div>
            <div className="mode-tabs ai-input-tabs">
              {[
                ["guided", "Guided action builder"],
                ["free-text", "Enter instruction"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={planningMode === value ? "selected" : ""}
                  onClick={() => setPlanningMode(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            {planningMode === "guided" ? (
              <>
                <div className="ai-action-choices">
                  <label>
                    <input
                      type="radio"
                      name="planning-action"
                      value="expedite"
                      checked={actionType === "expedite"}
                      onChange={() => setActionType("expedite")}
                    />
                    Expedite a receipt
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="planning-action"
                      value="delay"
                      checked={actionType === "delay"}
                      onChange={() => setActionType("delay")}
                    />
                    Delay a receipt
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="planning-action"
                      value="reassign"
                      checked={actionType === "reassign"}
                      onChange={() => setActionType("reassign")}
                    />
                    Reassign an order line
                  </label>
                </div>

                {receiptAction ? (
                  <div className="ai-form-grid">
                    <FormField
                      label="Receipt"
                      hint="Only planned or in-transit receipts can be selected."
                    >
                      <select
                        value={selectedReceiptId}
                        onChange={(event) => {
                          setSelectedReceiptId(event.target.value);
                          setReceiptDate("");
                        }}
                      >
                        <option value="">Select a receipt</option>
                        {eligibleReceipts.map((receipt) => {
                          const product = productMap[receipt.product_id];
                          const location = locationMap[receipt.location_id];
                          return (
                            <option key={receipt.id} value={receipt.id}>
                              {receipt.receipt_code}
                              {product ? ` · ${product.sku} — ${product.name}` : ""}
                              {location
                                ? ` · ${location.code} — ${location.name}`
                                : ""}
                              {` · ${dateLabel(receipt.expected_arrival)} · ${number(receipt.quantity)} · ${receipt.status}`}
                            </option>
                          );
                        })}
                      </select>
                    </FormField>
                    <FormField
                      label={
                        actionType === "delay"
                          ? "Later expected arrival"
                          : "Earlier expected arrival"
                      }
                      hint={
                        selectedReceipt
                          ? `Must be ${actionType === "delay" ? "after" : "before"} ${dateLabel(selectedReceipt.expected_arrival)}.`
                          : "Select a receipt first."
                      }
                    >
                      <input
                        type="date"
                        value={receiptDate}
                        min={
                          selectedReceipt && actionType === "delay"
                            ? laterDate(selectedReceipt.expected_arrival)
                            : undefined
                        }
                        max={
                          selectedReceipt && actionType !== "delay"
                            ? earlierDate(selectedReceipt.expected_arrival)
                            : undefined
                        }
                        onChange={(event) => setReceiptDate(event.target.value)}
                        disabled={!selectedReceipt}
                      />
                    </FormField>
                    {selectedReceipt && (
                      <div className="ai-selection-summary">
                        <b>Selected receipt details</b>
                        <span>
                          Product:{" "}
                          {productMap[selectedReceipt.product_id]
                            ? `${productMap[selectedReceipt.product_id].sku} — ${productMap[selectedReceipt.product_id].name}`
                            : "Not available"}
                        </span>
                        <span>
                          Location:{" "}
                          {locationMap[selectedReceipt.location_id]
                            ? `${locationMap[selectedReceipt.location_id].code} — ${locationMap[selectedReceipt.location_id].name}`
                            : "Not available"}
                        </span>
                        <span>Quantity: {number(selectedReceipt.quantity)}</span>
                        <span>Status: {selectedReceipt.status}</span>
                        <span>
                          Current expected arrival:{" "}
                          {dateLabel(selectedReceipt.expected_arrival)}
                        </span>
                      </div>
                    )}
                    {receiptInstructionAmbiguous && (
                      <div className="notice warning">
                        This receipt code overlaps another receipt code in the
                        backend parser. It cannot be targeted reliably by the
                        guided instruction.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="ai-form-grid">
                    <FormField
                      label="Order line"
                      hint="Only confirmed or fulfilling orders with a unique product SKU are offered."
                    >
                      <select
                        value={selectedLineId}
                        onChange={(event) =>
                          setSelectedLineId(event.target.value)
                        }
                      >
                        <option value="">Select an order line</option>
                        {selectableLines.map((line) => {
                          const product = productMap[line.product_id];
                          const preferred =
                            locationMap[line.preferred_location_id];
                          return (
                            <option key={line.id} value={line.id}>
                              {line.order.order_number} · line {line.id} ·{" "}
                              {product.sku} — {product.name} ·{" "}
                              {number(line.backordered_quantity)} backordered
                              {preferred
                                ? ` · preferred ${preferred.code}`
                                : ""}
                            </option>
                          );
                        })}
                      </select>
                    </FormField>
                    {selectedLine && (
                      <div className="ai-selection-summary">
                        <b>
                          {selectedLine.order.order_number} · line{" "}
                          {selectedLine.id}
                        </b>
                        <span>
                          Product:{" "}
                          {selectedProduct
                            ? `${selectedProduct.sku} — ${selectedProduct.name}`
                            : "Not available"}
                        </span>
                        <span>
                          Backordered:{" "}
                          {number(selectedLine.backordered_quantity)}
                        </span>
                        <span>
                          Requested: {number(selectedLine.requested_quantity)} ·
                          Allocated: {number(selectedLine.allocated_quantity)}
                        </span>
                        <span>
                          Current preferred location:{" "}
                          {locationMap[selectedLine.preferred_location_id]
                            ? `${locationMap[selectedLine.preferred_location_id].code} — ${locationMap[selectedLine.preferred_location_id].name}`
                            : "Not specified"}
                        </span>
                        <span>
                          Current active allocation location(s):{" "}
                          {asArray(allocationsByOrder[selectedLine.order.id])
                            .filter(
                              (allocation) =>
                                Number(allocation.line_id) ===
                                  Number(selectedLine.id) &&
                                String(allocation.status).toUpperCase() ===
                                  "ACTIVE",
                            )
                            .map(
                              (allocation) =>
                                locationMap[allocation.location_id]?.code,
                            )
                            .filter(Boolean)
                            .join(", ") ||
                            (allocationsLoading
                              ? "Loading…"
                              : "Not available")}
                        </span>
                      </div>
                    )}
                    {selectedLine && allocationsError && (
                      <ErrorState message={allocationsError} />
                    )}
                    <FormField
                      label="New fulfillment location"
                      hint="This changes the order-line fulfillment preference; it does not move physical stock."
                    >
                      <select
                        value={destinationLocationId}
                        onChange={(event) =>
                          setDestinationLocationId(event.target.value)
                        }
                      >
                        <option value="">Select a destination</option>
                        {asArray(locations).map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.code} — {location.name}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    {selectedLineInstruction && lineInstructionAmbiguous && (
                      <div className="notice warning">
                        These identifiers are ambiguous to the existing parser.
                        Choose a different line or location; no proposal will be
                        sent with this selection.
                      </div>
                    )}
                  </div>
                )}
                <form className="form-grid" onSubmit={submitGuided}>
                  <FormField label="Generated instruction">
                    <input
                      value={guidedInstruction}
                      readOnly
                      placeholder="Select the action details above."
                    />
                    <small>
                      This uses the instruction format recognized by the
                      existing rule-based parser.
                    </small>
                  </FormField>
                  <Button
                    type="submit"
                    disabled={working || !guidedInstructionValid}
                  >
                    {working ? "Creating proposal…" : "Create proposal"}
                  </Button>
                </form>
              </>
            ) : (
              <form className="form-grid" onSubmit={submitFreeText}>
                <FormField
                  label="Planning instruction"
                  hint="Use an action verb, exact persisted identifiers, and an ISO date (YYYY-MM-DD) for receipt changes. Natural-language phrasing is accepted only when those identifiers and action are unambiguous."
                >
                  <textarea
                    rows="4"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Enter an instruction using one of the examples below."
                    required
                  />
                </FormField>
                <div className="ai-examples">
                  <b>Examples using currently available data</b>
                  {receiptExample ? (
                    <div className="ai-example-row">
                      <code>{receiptExample}</code>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setNote(receiptExample)}
                      >
                        Insert receipt example
                      </button>
                    </div>
                  ) : (
                    <p>Select a receipt in the guided builder to create real receipt examples.</p>
                  )}
                  {delayExample && (
                    <div className="ai-example-row">
                      <code>{delayExample}</code>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setNote(delayExample)}
                      >
                        Insert delay example
                      </button>
                    </div>
                  )}
                  {reassignExample ? (
                    <div className="ai-example-row">
                      <code>{reassignExample}</code>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setNote(reassignExample)}
                      >
                        Insert reassignment example
                      </button>
                    </div>
                  ) : (
                    <p>Select an eligible order line and destination in the guided builder to create a real reassignment example.</p>
                  )}
                </div>
                <Button type="submit" disabled={working || !note.trim()}>
                  {working ? "Creating proposal…" : "Create proposal"}
                </Button>
              </form>
            )}
            {proposalError && (
              <div className="error-state ai-inline-error">
                <CircleAlert size={18} />
                <div>
                  <b>Action not completed</b>
                  <span>{proposalError}</span>
                </div>
              </div>
            )}
          </Card>

          {proposal && (
            <Card className="ai-card">
              <div className="ai-card-heading">
                <div className="ai-icon blue">
                  <Sparkles size={19} />
                </div>
                <div>
                  <h3>Review proposal</h3>
                  <span>Review all identified changes before approval.</span>
                </div>
              </div>
              <div className="proposal-status">
                <span>Proposal status</span>
                <Badge
                  tone={
                    proposal.application_status === "APPLIED"
                      ? "green"
                      : proposalDismissed
                        ? "red"
                      : proposalApplyUnconfirmed
                        ? "red"
                      : proposalActions.length
                        ? "amber"
                        : "red"
                  }
                >
                  {proposal.application_status === "APPLIED"
                    ? "APPLIED"
                    : proposalDismissed
                      ? "DISMISSED LOCALLY — BACKEND STILL PROPOSED"
                    : proposalApplyUnconfirmed
                      ? "APPLY NOT CONFIRMED"
                    : proposalActions.length
                      ? "PROPOSED — NOT APPLIED"
                      : "NO ACTION IDENTIFIED"}
                </Badge>
              </div>
              <p>{proposal.preview}</p>
              <div className="ai-recognition">
                <b>Backend recognition score:</b>{" "}
                {proposal.confidence ?? "Not returned"}
                <span>
                  The parser returns a fixed rule-match score (0.9 when an
                  action is identified); it is not a calibrated probability.
                </span>
                <span>
                  AI interaction #{proposal.interaction_id} is audited by the
                  backend. There is no backend rejection or interaction-history
                  endpoint; dismissing below is local only.
                </span>
              </div>
              {!proposalActions.length ? (
                <div className="notice warning">
                  No complete supported action was identified. The backend
                  reported that no records were changed. Check that the input
                  includes the exact persisted identifiers and required date.
                  {asArray(proposal.identified_orders).length > 0 && (
                    <span>
                      {" "}
                      Identified order(s):{" "}
                      {proposal.identified_orders.join(", ")}.
                    </span>
                  )}
                </div>
              ) : (
                <>
                  <DataTable
                    rows={proposalActions}
                    columns={[
                      {
                        key: "action",
                        label: "Action",
                        render: (action) => (
                          <>
                            {action.action === "reassign_line"
                              ? "Reassign order line"
                              : action.action === "expedite"
                                ? "Expedite receipt"
                                : action.action === "delay"
                                  ? "Delay receipt"
                                  : action.action}
                            {action.explanation && (
                              <span className="cell-sub">
                                {action.explanation}
                              </span>
                            )}
                          </>
                        ),
                      },
                      {
                        key: "affected",
                        label: "Affected item",
                        render: (action) => {
                          if (action.action === "reassign_line") {
                            const target = proposalLine(action);
                            return target
                              ? `${target.order.order_number} · line ${target.line.id} · ${target.product?.sku || "Product not available"}${target.product ? ` — ${target.product.name}` : ""}`
                              : `${action.order_number} · line ${action.line_id}`;
                          }
                          const receipt = asArray(receipts).find(
                            (item) =>
                              item.receipt_code === action.receipt_code,
                          );
                          const product =
                            receipt && productMap[receipt.product_id];
                          const location =
                            receipt && locationMap[receipt.location_id];
                          return (
                            <>
                              {action.receipt_code}
                              {product && (
                                <span className="cell-sub">
                                  {product.sku} — {product.name}
                                </span>
                              )}
                              {receipt && (
                                <span className="cell-sub">
                                  {location
                                    ? `${location.code} — ${location.name}`
                                    : "Location not available"}
                                  {" · "}
                                  {number(receipt.quantity)} · {receipt.status}
                                </span>
                              )}
                            </>
                          );
                        },
                      },
                      {
                        key: "current",
                        label: "Current value",
                        render: (action) => {
                          if (action.action === "reassign_line") {
                            const target = proposalLine(action);
                            const currentLocations =
                              target &&
                              allocationLocations(
                                target.order.id,
                                target.line.id,
                              );
                            const preferred =
                              target &&
                              locationMap[target.line.preferred_location_id];
                            return (
                              <>
                                {currentLocations?.length
                                  ? currentLocations
                                      .map(
                                        (location) =>
                                          `${location.code} — ${location.name}`,
                                      )
                                      .join(", ")
                                  : allocationsLoading
                                    ? "Loading active allocations…"
                                    : "Active allocation not available"}
                                {preferred && (
                                  <span className="cell-sub">
                                    Preferred: {preferred.code} — {preferred.name}
                                  </span>
                                )}
                              </>
                            );
                          }
                          const receipt = asArray(receipts).find(
                            (item) =>
                              item.receipt_code === action.receipt_code,
                          );
                          return receipt
                            ? dateLabel(receipt.expected_arrival)
                            : "Not available";
                        },
                      },
                      {
                        key: "proposed",
                        label: "Proposed value",
                        render: (action) => {
                          if (action.action !== "reassign_line")
                            return dateLabel(action.expected_arrival);
                          const location = asArray(locations).find(
                            (item) => item.code === action.location_code,
                          );
                          return location
                            ? `${location.code} — ${location.name}`
                            : action.location_code;
                        },
                      },
                      {
                        key: "change",
                        label: "What will change",
                        render: (action) =>
                          action.action === "reassign_line"
                            ? "Order-line fulfillment preference and allocations may change; physical stock is not transferred."
                            : "Receipt expected-arrival date changes; physical inventory increases only when the receipt is received.",
                      },
                      {
                        key: "confidence",
                        label: "Backend match score",
                        render: (action) =>
                          action.confidence ?? "Not returned",
                      },
                    ]}
                  />
                  <div className="notice warning">
                    <CircleAlert size={17} />
                    {proposalActions.some(
                      (action) => action.action === "reassign_line",
                    ) && (
                      <span>
                        Reassignment changes the fulfillment plan and may
                        rebuild allocations. It does not physically transfer
                        stock between locations.
                      </span>
                    )}
                    {proposalActions.some((action) =>
                      ["expedite", "delay"].includes(action.action),
                    ) && (
                      <span>
                        Changing a receipt date does not increase physical
                        inventory. Inventory changes only after receipt.
                      </span>
                    )}
                  </div>
                  {proposalActions.some(
                    (action) => action.action === "reassign_line",
                  ) && allocationsError && (
                    <ErrorState message={allocationsError} />
                  )}
                  {proposal.application_status !== "APPLIED" &&
                    !proposalDismissed &&
                    !proposalApplyUnconfirmed && (
                    <div className="ai-approval">
                      <h4>Approve and apply</h4>
                      <label className="ai-approval-check">
                        <input
                          type="checkbox"
                          checked={approved}
                          onChange={(event) =>
                            setApproved(event.target.checked)
                          }
                        />
                        I reviewed the proposed changes above and approve them.
                      </label>
                      <FormField label="Reason for approval">
                        <textarea
                          rows="2"
                          value={approvalReason}
                          onChange={(event) =>
                            setApprovalReason(event.target.value)
                          }
                          placeholder="Enter why this action is being approved."
                          required
                        />
                      </FormField>
                      <Button
                        disabled={
                          working || !approved || !approvalReason.trim()
                        }
                        onClick={applyProposal}
                      >
                        {working ? "Applying…" : "Approve and apply proposal"}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={working}
                        onClick={() => {
                          setApproved(false);
                          setProposalDismissed(true);
                        }}
                      >
                        Dismiss locally
                      </Button>
                    </div>
                  )}
                  {proposalDismissed && (
                    <div className="notice warning">
                      This proposal is dismissed in the current view only. The
                      backend has no rejection endpoint, so its persisted
                      interaction remains PROPOSED and no change was applied.
                    </div>
                  )}
                  {proposalApplyUnconfirmed && (
                    <div className="notice warning">
                      The apply result was not confirmed. The UI will not claim
                      this proposal was applied; verify the order or receipt
                      before retrying. Review the backend audit trail.
                    </div>
                  )}
                </>
              )}
            </Card>
          )}
        </div>
      )}

      {section === "messages" && (
        <Card className="ai-card">
          <div className="ai-card-heading">
            <div className="ai-icon blue">
              <MessageSquareText size={19} />
            </div>
            <div>
              <h3>Customer messages</h3>
              <span>
                Create a factual draft from the selected order, then review it
                before sharing it outside this application.
              </span>
            </div>
          </div>
          <div className="ai-form-grid">
            <FormField label="Order">
              <select
                value={messageOrderId}
                onChange={changeMessageOrder}
              >
                <option value="">Select an order</option>
                {asArray(orders).map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.order_number} · {order.customer_name} ·{" "}
                    {order.status} · {number(orderBackordered(order))}{" "}
                    backordered
                  </option>
                ))}
              </select>
            </FormField>
            {messageOrder && (
              <div className="ai-selection-summary">
                <b>
                  {messageOrder.order_number} · {messageOrder.customer_name}
                </b>
                <span>
                  Status: {messageOrder.status} · Priority:{" "}
                  {messageOrder.priority}
                </span>
                <span>
                  Backordered quantity: {number(orderBackordered(messageOrder))}
                </span>
                <span>
                  Next expected update: Not provided by the available backend
                  data; do not promise a date from this assistant.
                </span>
              </div>
            )}
            <Button
              variant="secondary"
              onClick={generateMessage}
              disabled={working || !messageOrderId}
            >
              Generate message draft
            </Button>
          </div>
          {messageRecord && (
            <div className="ai-message-editor">
              <div className="proposal-status">
                <span>
                  Message #{messageRecord.id} ·{" "}
                  {messageRecord.status === "SENT"
                    ? "Marked as sent"
                    : "Ready for review or editing"}
                </span>
                <Badge
                  tone={messageRecord.status === "SENT" ? "green" : "blue"}
                >
                  {messageRecord.status}
                </Badge>
              </div>
              <div className="ai-summary-facts">
                <span>
                  <b>Created</b> {dateLabel(messageRecord.created_at)}
                </span>
                {messageDirty && (
                  <span>
                    <b>Unsaved</b> Added order-line context must be saved before
                    marking this draft as sent.
                  </span>
                )}
              </div>
              <FormField label="Message text">
                <textarea
                  rows="7"
                  value={messageText}
                  disabled={
                    working || messageRecord.status === "SENT"
                  }
                  onChange={(event) => setMessageText(event.target.value)}
                />
              </FormField>
              {messageRecord.status === "SENT" && (
                <div className="notice warning">
                  This message is marked SENT in the application, so it cannot
                  be edited. Generate a fresh draft if you need another message.
                </div>
              )}
              <div className="ai-message-actions">
                <Button
                  variant="secondary"
                  onClick={saveMessage}
                  disabled={
                    working ||
                    messageRecord.status === "SENT" ||
                    !messageDirty ||
                    !messageText.trim()
                  }
                >
                  Save changes
                </Button>
                {messageRecord.status !== "SENT" && (
                  <Button
                    onClick={markSent}
                    disabled={working || !messageText.trim() || messageDirty}
                  >
                    Mark as sent
                  </Button>
                )}
              </div>
            </div>
          )}
          <div className="notice info">
            <CircleAlert size={17} />
            <span>
              Marking a message as sent updates its status in this application.
              It does not send an email.
            </span>
          </div>
        </Card>
      )}

      {section === "summary" && (
        <Card className="ai-card">
          <div className="ai-card-heading">
            <div className="ai-icon">
              <CircleAlert size={19} />
            </div>
            <div>
              <h3>Order risk summary</h3>
              <span>
                Backend-reported risks and recommendations for investigation.
              </span>
            </div>
          </div>
          <div className="ai-form-grid">
            <FormField label="Order">
              <select
                value={summaryOrderId}
                onChange={(event) => {
                  setSummaryOrderId(event.target.value);
                  setSummary(null);
                  setSummaryError("");
                }}
              >
                <option value="">Select an order</option>
                {asArray(orders).map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.order_number} · {order.customer_name} ·{" "}
                    {order.status} · {number(orderBackordered(order))}{" "}
                    backordered
                  </option>
                ))}
              </select>
            </FormField>
            <Button
              variant="secondary"
              onClick={loadSummary}
              disabled={working || !summaryOrderId}
            >
              {working ? "Loading summary…" : "Load order risk summary"}
            </Button>
          </div>
          {summaryError && <ErrorState message={summaryError} />}
          {summary && (
            <>
              <div className="proposal-status">
                <span>
                  {summary.order_number} · {summaryOrder?.customer_name || "Customer not available"}
                </span>
                <Badge>{summary.status}</Badge>
              </div>
              {summaryOrder && (
                <div className="ai-summary-facts">
                  <span>
                    <b>Priority</b> {summaryOrder.priority}
                  </span>
                  <span>
                    <b>Requested ship</b>{" "}
                    {dateLabel(summaryOrder.requested_ship_date)}
                  </span>
                  <span>
                    <b>Order details</b>{" "}
                    <Link to={`/orders/${summaryOrder.id}`}>Open order</Link>
                  </span>
                </div>
              )}
              <section className="summary-box">
                <h4>A. What happened</h4>
                <p>
                  Order status: <b>{summary.status || "Not available"}</b>.
                  Fulfillment risks are returned by the backend and are
                  advisory.
                </p>
                {asArray(summary.risks).length ? (
                  <ul>
                    {summary.risks.map((risk, index) => (
                      <li key={`${risk}-${index}`}>{risk}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No current fulfillment risks were returned for this order.</p>
                )}
                <DataTable
                  rows={asArray(summary.fulfillment_plan)}
                  columns={[
                    {
                      key: "line_id",
                      label: "Order line",
                      render: (planLine) => (
                        <Link to={`/orders/${summaryOrderId}`}>
                          {summaryOrder?.order_number || "Order"} · line{" "}
                          {planLine.line_id}
                        </Link>
                      ),
                    },
                    {
                      key: "product",
                      label: "Product",
                      render: (planLine) => {
                        const line = summaryLineMap[planLine.line_id];
                        const product = line && productMap[line.product_id];
                        return product
                          ? `${product.sku} — ${product.name}`
                          : "Not available";
                      },
                    },
                    {
                      key: "requested",
                      label: "Requested",
                      render: (planLine) => {
                        const line = summaryLineMap[planLine.line_id];
                        return line
                          ? number(line.requested_quantity)
                          : "Not available";
                      },
                    },
                    {
                      key: "shipped",
                      label: "Shipped",
                      render: (planLine) => number(planLine.shipped),
                    },
                    {
                      key: "allocated",
                      label: "Allocated",
                      render: (planLine) => number(planLine.allocated),
                    },
                    {
                      key: "backordered",
                      label: "Backordered",
                      render: (planLine) => number(planLine.backordered),
                    },
                    {
                      key: "promised_ship_date",
                      label: "Promised ship",
                      render: (planLine) =>
                        dateLabel(planLine.promised_ship_date),
                    },
                    {
                      key: "location",
                      label: "Location",
                      render: (planLine) => {
                        const locationIds = [
                          ...new Set(
                            summaryAllocations
                              .filter(
                                (allocation) =>
                                  Number(allocation.line_id) ===
                                  Number(planLine.line_id),
                              )
                              .map((allocation) =>
                                Number(allocation.location_id),
                              ),
                          ),
                        ];
                        const locationsForLine = locationIds
                          .map((id) => locationMap[id])
                          .filter(Boolean);
                        if (locationsForLine.length)
                          return locationsForLine
                            .map((location) => `${location.code} — ${location.name}`)
                            .join(", ");
                        const line = summaryLineMap[planLine.line_id];
                        const preferred =
                          line && locationMap[line.preferred_location_id];
                        return preferred
                          ? `Preferred: ${preferred.code} — ${preferred.name}`
                          : allocationsLoading
                            ? "Loading…"
                            : "Not available";
                      },
                    },
                  ]}
                  emptyText="No fulfillment lines were returned."
                />
                {allocationsError && (
                  <ErrorState message={allocationsError} />
                )}
              </section>
              <section className="summary-box">
                <h4>B. Current plan</h4>
                <p>
                  Persisted active allocations and eligible inbound receipts
                  for these products are shown below. Receipts are not assumed
                  to be allocated unless an allocation record links them.
                </p>
                <h5>Active allocations</h5>
                <DataTable
                  rows={summaryAllocations}
                  columns={[
                    {
                      key: "line_id",
                      label: "Order line",
                      render: (allocation) => (
                        <Link to={`/orders/${summaryOrderId}`}>
                          Line {allocation.line_id}
                        </Link>
                      ),
                    },
                    {
                      key: "product",
                      label: "Product",
                      render: (allocation) => {
                        const line = summaryLineMap[allocation.line_id];
                        const product = line && productMap[line.product_id];
                        return product
                          ? `${product.sku} — ${product.name}`
                          : "Not available";
                      },
                    },
                    {
                      key: "quantity",
                      label: "Allocated quantity",
                      render: (allocation) => number(allocation.quantity),
                    },
                    {
                      key: "location_id",
                      label: "Location",
                      render: (allocation) => {
                        const location = locationMap[allocation.location_id];
                        return location
                          ? `${location.code} — ${location.name}`
                          : "Not available";
                      },
                    },
                    {
                      key: "source_type",
                      label: "Supply source",
                      render: (allocation) => {
                        if (allocation.source_type !== "RECEIPT")
                          return allocation.source_type || "Not available";
                        const receipt = asArray(receipts).find(
                          (item) =>
                            Number(item.id) === Number(allocation.source_id),
                        );
                        return receipt
                          ? `Receipt ${receipt.receipt_code}`
                          : "Receipt not available";
                      },
                    },
                  ]}
                  emptyText={
                    allocationsLoading
                      ? "Loading active allocations…"
                      : "No active allocations were returned for this order."
                  }
                />
                <h5>Incoming receipts for this order’s products</h5>
                <DataTable
                  rows={summaryIncomingReceipts}
                  columns={[
                    { key: "receipt_code", label: "Receipt" },
                    {
                      key: "product_id",
                      label: "Product",
                      render: (receipt) => {
                        const product = productMap[receipt.product_id];
                        return product
                          ? `${product.sku} — ${product.name}`
                          : "Not available";
                      },
                    },
                    {
                      key: "location_id",
                      label: "Location",
                      render: (receipt) => {
                        const location = locationMap[receipt.location_id];
                        return location
                          ? `${location.code} — ${location.name}`
                          : "Not available";
                      },
                    },
                    {
                      key: "quantity",
                      label: "Receipt quantity",
                      render: (receipt) => number(receipt.quantity),
                    },
                    {
                      key: "expected_arrival",
                      label: "Expected arrival",
                      render: (receipt) => dateLabel(receipt.expected_arrival),
                    },
                    { key: "status", label: "Status" },
                    {
                      key: "allocation",
                      label: "Relationship to this order",
                      render: (receipt) => {
                        const linked = summaryAllocations.filter(
                          (allocation) =>
                            allocation.source_type === "RECEIPT" &&
                            Number(allocation.source_id) === Number(receipt.id),
                        );
                        return linked.length
                          ? `Allocated to line(s) ${linked.map((row) => row.line_id).join(", ")}`
                          : "Not allocated to this order";
                      },
                    },
                  ]}
                  emptyText="No eligible inbound receipts for these products were returned."
                />
                {allocationsError && (
                  <ErrorState message={allocationsError} />
                )}
              </section>
              <section className="summary-box">
                <h4>C. Next best actions</h4>
                <b>Recommendations returned by the backend</b>
                {asArray(summary.recommendations).length ? (
                  <ul>
                    {summary.recommendations.map((recommendation, index) => (
                      <li key={`${recommendation}-${index}`}>
                        {recommendation}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No recommendations were returned.</p>
                )}
                <div className="ai-recommendation-detail">
                  <b>Receipt-date review</b>
                  {asArray(summary.risks).length > 0 ? (
                    <>
                      <p>
                        The backend reports a fulfillment risk and recommends
                        reviewing receipt dates. A planner-approved expedite
                        may change receipt-backed allocations and promises
                        after the plan is rebuilt. It cannot guarantee an
                        earlier physical arrival.
                      </p>
                      {summaryIncomingReceipts.length ? (
                        <ul>
                          {summaryIncomingReceipts.map((receipt) => (
                            <li key={receipt.id}>
                              {receipt.receipt_code} ·{" "}
                              {dateLabel(receipt.expected_arrival)} ·{" "}
                              {locationMap[receipt.location_id]?.code ||
                                "Location not available"}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>
                          No eligible incoming receipt for these products was
                          returned, so an expedite cannot be evaluated from
                          current data.
                        </p>
                      )}
                    </>
                  ) : (
                    <p>
                      No current backorder risk was returned. Review eligible
                      receipt dates only if other operational information
                      warrants it; this summary does not recommend an
                      expedite.
                    </p>
                  )}
                  <b>Other planner checks (not returned as recommendations)</b>
                  <b>Location reassignment</b>
                    {summaryAlternativeStock.length ? (
                      <>
                        <p>
                          Positive on-hand inventory exists at another
                          location for the affected product(s). Consider
                          reassignment only after reviewing the current plan;
                          this changes the line preference and does not
                          transfer physical stock.
                        </p>
                        <ul>
                          {summaryAlternativeStock.map((candidate, index) => (
                            <li key={`${candidate.lineId}-${candidate.location?.id}-${index}`}>
                              Line {candidate.lineId} ·{" "}
                              {candidate.product
                                ? `${candidate.product.sku} — ${candidate.product.name}`
                                : "Product not available"}{" "}
                              ·{" "}
                              {candidate.location
                                ? `${candidate.location.code} — ${candidate.location.name}`
                                : "Location not available"}{" "}
                              · on-hand {number(candidate.quantity)}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p>
                        Current inventory data does not show positive on-hand
                        stock at another location for these products, so a
                        reassignment benefit cannot be established. Incoming
                        receipts above are not treated as on-hand stock.
                      </p>
                    )}
                    <b>Promise-date review</b>
                    <p>
                      Current promised dates are shown above when returned.
                      The summary endpoint does not recommend or change a
                      promise date; any override must be a separate planner
                      action.
                    </p>
                </div>
              </section>
              <div className="notice info">
                This summary is advisory. Loading it does not change order
                allocations, inventory, receipt dates, or order promises.
                The backend records the request as an ADVISORY AI interaction,
                but this API does not return its interaction ID or expose audit
                history.
              </div>
            </>
          )}
        </Card>
      )}
    </>
  );
}
