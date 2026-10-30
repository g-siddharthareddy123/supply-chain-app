import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { api } from "../api";
import { getErrorMessage } from "../api/client";
import {
  Button,
  DataTable,
  ErrorState,
  Loading,
  Modal,
  PageHeader,
} from "../components";
import {
  useLoad,
  useToast,
  FormField,
  SubmitRow,
  RefreshAction,
  TableCard,
  SearchBox,
  number,
  asArray,
} from "./shared";

export function CatalogPage({ type }) {
  const product = type === "products";
  const resource = product ? api.products : api.locations;
  const { data, loading, error, refresh } = useLoad(resource.list, [type]);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [saving, setSaving] = useState(false);
  const notify = useToast();
  const rows = asArray(data).filter((row) =>
    `${row.sku || row.code} ${row.name}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const title = product ? "Products" : "Locations";
  const fields = product
    ? [
        ["sku", "SKU", "text"],
        ["name", "Product name", "text"],
        ["unit_of_measure", "Unit of measure", "text"],
        ["lead_time_days", "Lead time (days)", "number"],
      ]
    : [
        ["code", "Location code", "text"],
        ["name", "Location name", "text"],
        ["timezone", "Timezone (optional)", "text"],
      ];

  async function submit(event) {
    event.preventDefault();
    const form = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    );
    const payload = product
      ? {
          sku: form.sku.trim(),
          name: form.name.trim(),
          unit_of_measure: form.unit_of_measure.trim() || "EA",
          lead_time_days:
            form.lead_time_days === "" ? null : Number(form.lead_time_days),
        }
      : {
          code: form.code.trim(),
          name: form.name.trim(),
          timezone: form.timezone.trim() || null,
        };
    if (
      product &&
      payload.lead_time_days != null &&
      (!Number.isInteger(payload.lead_time_days) || payload.lead_time_days < 0)
    )
      return notify("Lead time must be a non-negative whole number.", "error");
    setSaving(true);
    try {
      if (modal?.id) await resource.update(modal.id, payload);
      else await resource.create(payload);
      notify(
        `${title.slice(0, -1)} ${modal?.id ? "updated" : "created"} successfully.`,
      );
      setModal(null);
      refresh();
    } catch (err) {
      notify(getErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(row) {
    if (
      !window.confirm(
        `Delete ${product ? row.sku : row.code}? This cannot be undone.`,
      )
    )
      return;
    try {
      await resource.delete(row.id);
      notify(`${title.slice(0, -1)} deleted.`);
      refresh();
    } catch (err) {
      notify(getErrorMessage(err), "error");
    }
  }
  async function editRecord(row) {
    try {
      setModal(await resource.get(row.id));
    } catch (err) {
      notify(getErrorMessage(err), "error");
    }
  }
  async function viewRecord(row) {
    try {
      setViewing(await resource.get(row.id));
    } catch (err) {
      notify(getErrorMessage(err), "error");
    }
  }

  return (
    <>
      <PageHeader
        title={title}
        description={
          product
            ? "Manage the product catalog used across planning and fulfillment."
            : "Manage warehouses and fulfillment locations."
        }
        actions={
          <>
            <RefreshAction onClick={refresh} loading={loading} />
            <Button icon={Plus} onClick={() => setModal({})}>
              Add {product ? "product" : "location"}
            </Button>
          </>
        }
      />
      <TableCard>
        <div className="table-toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder={`Search ${title.toLowerCase()}...`}
          />
          <span className="record-count">{rows.length} records</span>
        </div>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : (
          <DataTable
            rows={rows}
            columns={[
              {
                key: product ? "sku" : "code",
                label: product ? "SKU" : "Code",
                render: (row) => (
                  <strong className="primary-cell">
                    {product ? row.sku : row.code}
                  </strong>
                ),
              },
              {
                key: "name",
                label: product ? "Product name" : "Location name",
              },
              ...(product
                ? [
                    { key: "unit_of_measure", label: "UOM" },
                    {
                      key: "lead_time_days",
                      label: "Lead time",
                      render: (row) =>
                        row.lead_time_days == null
                          ? "Not set"
                          : `${row.lead_time_days} days`,
                    },
                  ]
                : [
                    {
                      key: "timezone",
                      label: "Timezone",
                      render: (row) => row.timezone || "Not set",
                    },
                  ]),
              {
                key: "actions",
                label: "",
                render: (row) => (
                  <div className="row-actions">
                    <button
                      className="text-button"
                      onClick={() => viewRecord(row)}
                    >
                      View
                    </button>
                    <button
                      className="text-button"
                      onClick={() => editRecord(row)}
                    >
                      Edit
                    </button>
                    <button
                      className="text-button danger-text"
                      onClick={() => remove(row)}
                    >
                      Delete
                    </button>
                  </div>
                ),
              },
            ]}
            emptyText={`No ${title.toLowerCase()} match this search`}
          />
        )}
      </TableCard>
      {modal && (
        <Modal
          title={`${modal.id ? "Edit" : "Add"} ${product ? "product" : "location"}`}
          onClose={() => setModal(null)}
        >
          <form className="form-grid" onSubmit={submit}>
            {fields.map(([key, label, kind]) => (
              <FormField key={key} label={label}>
                <input
                  name={key}
                  type={kind}
                  min={kind === "number" ? 0 : undefined}
                  step={kind === "number" ? 1 : undefined}
                  required={key !== "timezone" && key !== "lead_time_days"}
                  defaultValue={modal[key] ?? ""}
                />
              </FormField>
            ))}
            <SubmitRow busy={saving} onCancel={() => setModal(null)} />
          </form>
        </Modal>
      )}
      {viewing && (
        <Modal
          title={`${product ? viewing.sku : viewing.code} details`}
          onClose={() => setViewing(null)}
        >
          <div className="details-list">
            {Object.entries(viewing).map(([key, value]) => (
              <div className="detail-pair" key={key}>
                <span>{key.replaceAll("_", " ")}</span>
                <b>{value == null ? "Not set" : String(value)}</b>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
