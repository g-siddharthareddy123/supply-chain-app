import { useCallback, useState } from "react";
import { CircleAlert, Send, Sparkles } from "lucide-react";
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
import { useLoad, useToast, FormField, number, asArray } from "./shared";

export function AIAssistant() {
  const notify = useToast();
  const [note, setNote] = useState("");
  const [proposal, setProposal] = useState(null);
  const [orderId, setOrderId] = useState("");
  const [message, setMessage] = useState(null);
  const [summary, setSummary] = useState(null);
  const [working, setWorking] = useState(false);
  const loader = useCallback(() => allOrders(), []);
  const { data: orders, loading, error, refresh } = useLoad(loader);
  async function propose(event) {
    event.preventDefault();
    if (!note.trim()) return;
    setWorking(true);
    try {
      const result = await api.ai.propose(note.trim());
      setProposal(result);
      notify(
        result.proposed_actions?.length
          ? "Proposal generated for review. No changes were applied."
          : "No supported action was identified.",
      );
    } catch (err) {
      notify(getErrorMessage(err), "error");
    } finally {
      setWorking(false);
    }
  }
  async function applyProposal() {
    const reason = window.prompt("Reason for approving this planner proposal:");
    if (reason == null) return;
    if (!reason.trim())
      return notify("A reason is required to apply the proposal.", "error");
    if (!window.confirm("Apply the proposed backend changes?")) return;
    setWorking(true);
    try {
      await api.ai.apply(proposal.interaction_id, reason);
      notify("Proposal applied successfully.");
      setProposal(null);
      refresh();
    } catch (err) {
      notify(getErrorMessage(err), "error");
    } finally {
      setWorking(false);
    }
  }
  async function getMessage() {
    if (!orderId) return notify("Select an order.", "error");
    setWorking(true);
    try {
      const value = await api.ai.customerMessage(orderId);
      setMessage(value);
      notify("Customer message draft generated.");
    } catch (err) {
      notify(getErrorMessage(err), "error");
    } finally {
      setWorking(false);
    }
  }
  async function saveMessage() {
    if (!message?.message?.trim())
      return notify("The message cannot be empty.", "error");
    setWorking(true);
    try {
      const result = await api.ai.updateMessage(message.id, message.message);
      setMessage(result);
      notify("Draft saved.");
    } catch (err) {
      notify(getErrorMessage(err), "error");
    } finally {
      setWorking(false);
    }
  }
  async function markSent() {
    if (
      !window.confirm(
        "Mark this message as sent? This only updates local status; it will not send an email.",
      )
    )
      return;
    setWorking(true);
    try {
      const result = await api.ai.markSent(message.id);
      setMessage({ ...message, status: result.status });
      notify("Message marked as sent locally. No email was sent.");
    } catch (err) {
      notify(getErrorMessage(err), "error");
    } finally {
      setWorking(false);
    }
  }
  async function loadSummary() {
    if (!orderId) return notify("Select an order.", "error");
    setWorking(true);
    try {
      setSummary(await api.ai.exceptionSummary(orderId));
    } catch (err) {
      notify(getErrorMessage(err), "error");
    } finally {
      setWorking(false);
    }
  }
  return (
    <>
      <PageHeader
        title="AI assistant"
        description="Rule-based planning helpers that propose changes for explicit review. No external AI service is used."
      />
      {error && <ErrorState message={error} />}
      {loading ? (
        <Loading />
      ) : (
        <div className="ai-grid">
          <Card className="ai-card">
            <div className="ai-card-heading">
              <div className="ai-icon">
                <Sparkles size={19} />
              </div>
              <div>
                <h3>Planner notes</h3>
                <span>
                  Generate a proposal from supported receipt/order references
                </span>
              </div>
            </div>
            <form className="form-grid" onSubmit={propose}>
              <FormField label="Describe an operational action">
                <textarea
                  rows="4"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Example: Expedite receipt RCP-123 to 2026-11-02"
                  required
                />
              </FormField>
              <Button type="submit" disabled={working}>
                {working ? "Analyzing…" : "Generate proposal"}
              </Button>
            </form>
            {proposal && (
              <div className="proposal-box">
                <div className="proposal-status">
                  <Badge>{proposal.application_status}</Badge>
                  <span>Confidence {number(proposal.confidence)}</span>
                </div>
                <p>{proposal.preview}</p>
                {asArray(proposal.proposed_actions).length > 0 && (
                  <DataTable
                    rows={proposal.proposed_actions}
                    columns={[
                      { key: "action", label: "Action" },
                      { key: "receipt_code", label: "Receipt" },
                      { key: "order_number", label: "Order" },
                      { key: "expected_arrival", label: "Date" },
                      { key: "location_code", label: "Location" },
                    ]}
                  />
                )}
                {asArray(proposal.proposed_actions).length > 0 && (
                  <Button disabled={working} onClick={applyProposal}>
                    Review and apply proposal
                  </Button>
                )}
              </div>
            )}
          </Card>
          <Card className="ai-card">
            <div className="ai-card-heading">
              <div className="ai-icon blue">
                <Send size={18} />
              </div>
              <div>
                <h3>Customer message</h3>
                <span>Generate and edit an order update draft</span>
              </div>
            </div>
            <div className="form-grid">
              <FormField label="Order">
                <select
                  value={orderId}
                  onChange={(e) => {
                    setOrderId(e.target.value);
                    setSummary(null);
                  }}
                >
                  <option value="">Select order</option>
                  {asArray(orders).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.order_number} — {o.customer_name}
                    </option>
                  ))}
                </select>
              </FormField>
              <Button
                variant="secondary"
                onClick={getMessage}
                disabled={working}
              >
                Generate message draft
              </Button>
              {message && (
                <>
                  <FormField label={`Message draft · ${message.status}`}>
                    <textarea
                      rows="6"
                      value={message.message}
                      disabled={message.status === "SENT"}
                      onChange={(e) =>
                        setMessage({ ...message, message: e.target.value })
                      }
                    />
                  </FormField>
                  <div className="row-actions">
                    <Button
                      variant="secondary"
                      onClick={saveMessage}
                      disabled={working || message.status === "SENT"}
                    >
                      Save draft
                    </Button>
                    {message.status !== "SENT" && (
                      <Button onClick={markSent} disabled={working}>
                        Mark as sent
                      </Button>
                    )}
                  </div>
                  <div className="notice warning">
                    <CircleAlert size={16} />
                    Marking sent only changes backend status. It does not send
                    an email.
                  </div>
                </>
              )}
            </div>
            <div className="separator" />
            <div className="card-title-row">
              <div>
                <h3>Order exception summary</h3>
                <span>Backend-generated advisory information</span>
              </div>
              <Button
                variant="secondary"
                onClick={loadSummary}
                disabled={working || !orderId}
              >
                Load summary
              </Button>
            </div>
            {summary && (
              <div className="summary-box">
                <b>
                  {summary.order_number} · {summary.status}
                </b>
                <h4>Risks</h4>
                {summary.risks?.length ? (
                  <ul>
                    {summary.risks.map((risk, i) => (
                      <li key={i}>{risk}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No current risks reported.</p>
                )}
                <h4>Recommendations</h4>
                <ul>
                  {asArray(summary.recommendations).map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
