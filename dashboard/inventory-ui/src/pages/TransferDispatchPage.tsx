import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  createTransfer,
  dispatchTransfer,
  fetchTransferFormOptions,
  findTransferDepartment,
  findTransferLocation,
  formatTransferDepartmentLabel,
  formatTransferLocationLabel,
  getRuntimeDepartmentId,
  getRuntimeUserId,
  getTransferLocationsForDepartment,
  setRuntimeContext,
  TransferDepartmentOption,
  TransferLocationOption,
} from '../lib/transferApi';

type DraftLine = {
  id: string;
  productId: number;
  uomId?: number;
  qty: number;
  unitCost?: number;
  lineNotes?: string;
};

function newLine(seed: number): DraftLine {
  return { id: `line-${seed}`, productId: 0, qty: 1 };
}

export function TransferDispatchPage() {
  const [userId, setUserId] = useState<number>(getRuntimeUserId());
  const [sourceDepartmentId, setSourceDepartmentId] = useState<number>(getRuntimeDepartmentId());
  const [sourceLocationId, setSourceLocationId] = useState<number>(0);
  const [targetDepartmentId, setTargetDepartmentId] = useState<number>(0);
  const [targetLocationId, setTargetLocationId] = useState<number>(0);
  const [departments, setDepartments] = useState<TransferDepartmentOption[]>([]);
  const [locations, setLocations] = useState<TransferLocationOption[]>([]);
  const [expectedArrivalDate, setExpectedArrivalDate] = useState<string>('');
  const [courier, setCourier] = useState<string>('');
  const [transportMethod, setTransportMethod] = useState<string>('');
  const [trackingNumber, setTrackingNumber] = useState<string>('');
  const [dispatchReference, setDispatchReference] = useState<string>('');
  const [notesSender, setNotesSender] = useState<string>('');
  const [lines, setLines] = useState<DraftLine[]>([newLine(1)]);
  const [createdTransferId, setCreatedTransferId] = useState<number | null>(null);
  const [confirmDispatch, setConfirmDispatch] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);

  const sourceDepartment = useMemo(
    () => findTransferDepartment(departments, sourceDepartmentId),
    [departments, sourceDepartmentId],
  );
  const targetDepartment = useMemo(
    () => findTransferDepartment(departments, targetDepartmentId),
    [departments, targetDepartmentId],
  );
  const sourceLocations = useMemo(
    () => getTransferLocationsForDepartment(locations, sourceDepartmentId, 'issue'),
    [locations, sourceDepartmentId],
  );
  const targetLocations = useMemo(
    () => getTransferLocationsForDepartment(locations, targetDepartmentId, 'receive'),
    [locations, targetDepartmentId],
  );
  const sourceLocation = useMemo(
    () => findTransferLocation(sourceLocations, sourceLocationId),
    [sourceLocationId, sourceLocations],
  );
  const targetLocation = useMemo(
    () => findTransferLocation(targetLocations, targetLocationId),
    [targetLocationId, targetLocations],
  );

  const canSubmit = useMemo(() => {
    if (!userId || !sourceDepartmentId || !targetDepartmentId) return false;
    if (sourceDepartmentId === targetDepartmentId && sourceLocationId === targetLocationId) return false;
    return lines.length > 0 && lines.every((line) => line.productId > 0 && line.qty > 0);
  }, [userId, sourceDepartmentId, sourceLocationId, targetDepartmentId, targetLocationId, lines]);

  useEffect(() => {
    let cancelled = false;

    async function loadTransferOptions() {
      try {
        const data = await fetchTransferFormOptions();
        if (cancelled) return;
        setDepartments(data.departments);
        setLocations(data.locations);

        if (!findTransferDepartment(data.departments, sourceDepartmentId) && data.departments.length > 0) {
          setSourceDepartmentId(data.departments[0].department_id);
        }
      } catch (err) {
        if (!cancelled) {
          setStatus(`Department/location lookup failed: ${(err as Error).message}`);
        }
      }
    }

    void loadTransferOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (sourceLocationId && !sourceLocations.some((location) => location.location_id === sourceLocationId)) {
      setSourceLocationId(0);
    }
  }, [sourceLocationId, sourceLocations]);

  useEffect(() => {
    if (targetLocationId && !targetLocations.some((location) => location.location_id === targetLocationId)) {
      setTargetLocationId(0);
    }
  }, [targetLocationId, targetLocations]);

  function updateLine(id: string, field: keyof DraftLine, value: number | string | undefined) {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, [field]: value } : line)));
  }

  function addLine() {
    setLines((prev) => [...prev, newLine(prev.length + 1)]);
  }

  function removeLine(id: string) {
    setLines((prev) => prev.filter((line) => line.id !== id));
  }

  async function handleCreateDraft(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    if (sourceLocationId && !sourceLocations.some((location) => location.location_id === sourceLocationId)) {
      setStatus('Source location must belong to the selected source department and be allowed to issue stock.');
      return;
    }
    if (targetLocationId && !targetLocations.some((location) => location.location_id === targetLocationId)) {
      setStatus('Target location must belong to the selected target department and be allowed to receive stock.');
      return;
    }

    setBusy(true);
    setStatus('');
    try {
      setRuntimeContext(userId, sourceDepartmentId);
      const result = await createTransfer({
        user_id: userId,
        source_department_id: sourceDepartmentId,
        source_location_id: sourceLocationId || null,
        target_department_id: targetDepartmentId,
        target_location_id: targetLocationId || null,
        notes_sender: notesSender || undefined,
        expected_arrival_date: expectedArrivalDate || undefined,
        courier: courier || undefined,
        transport_method: transportMethod || undefined,
        tracking_number: trackingNumber || undefined,
        dispatch_reference: dispatchReference || undefined,
        lines: lines.map((line) => ({
          product_id: line.productId,
          uom_id: line.uomId,
          qty: line.qty,
          unit_cost: line.unitCost,
          line_notes: line.lineNotes,
        })),
      });
      setCreatedTransferId(result.transfer_id);
      setStatus(`Draft transfer created: #${result.transfer_id}`);
    } catch (err) {
      setStatus(`Create draft failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDispatchExisting() {
    if (!createdTransferId) return;
    setBusy(true);
    setStatus('');
    try {
      await dispatchTransfer({
        transfer_id: createdTransferId,
        user_id: userId,
        sender_confirmation: confirmDispatch,
        notes_sender: notesSender || undefined,
      });
      setStatus(`Transfer #${createdTransferId} dispatched`);
    } catch (err) {
      setStatus(`Dispatch failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Send Stock</h2>
      <p>Choose the departments first. Location stays optional, so department-level movement still works.</p>

      <form className="panel" onSubmit={handleCreateDraft}>
        <div className="grid-4">
          <label>
            User ID
            <input type="number" min={1} value={userId || ''} onChange={(e) => setUserId(Number(e.target.value))} required />
          </label>
          <label>
            Source Department
            {departments.length > 0 ? (
              <select value={sourceDepartmentId || ''} onChange={(e) => setSourceDepartmentId(Number(e.target.value))} required>
                <option value="">Select source department</option>
                {departments.map((department) => (
                  <option key={department.department_id} value={department.department_id}>
                    {formatTransferDepartmentLabel(department)}
                  </option>
                ))}
              </select>
            ) : (
              <input type="number" min={1} value={sourceDepartmentId || ''} onChange={(e) => setSourceDepartmentId(Number(e.target.value))} required />
            )}
          </label>
          <label>
            Source Location
            <select
              value={sourceLocationId || ''}
              onChange={(e) => setSourceLocationId(Number(e.target.value) || 0)}
              disabled={!sourceDepartmentId}
            >
              <option value="">Department level</option>
              {sourceLocations.map((location) => (
                <option key={location.location_id} value={location.location_id}>
                  {formatTransferLocationLabel(location)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Expected Arrival
            <input type="date" value={expectedArrivalDate} onChange={(e) => setExpectedArrivalDate(e.target.value)} />
          </label>
        </div>

        <div className="grid-4">
          <label>
            Target Department
            {departments.length > 0 ? (
              <select value={targetDepartmentId || ''} onChange={(e) => setTargetDepartmentId(Number(e.target.value))} required>
                <option value="">Select target department</option>
                {departments.map((department) => (
                  <option key={department.department_id} value={department.department_id}>
                    {formatTransferDepartmentLabel(department)}
                  </option>
                ))}
              </select>
            ) : (
              <input type="number" min={1} value={targetDepartmentId || ''} onChange={(e) => setTargetDepartmentId(Number(e.target.value))} required />
            )}
          </label>
          <label>
            Target Location
            <select
              value={targetLocationId || ''}
              onChange={(e) => setTargetLocationId(Number(e.target.value) || 0)}
              disabled={!targetDepartmentId}
            >
              <option value="">Department level</option>
              {targetLocations.map((location) => (
                <option key={location.location_id} value={location.location_id}>
                  {formatTransferLocationLabel(location)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Courier
            <input value={courier} onChange={(e) => setCourier(e.target.value)} />
          </label>
          <label>
            Transport Method
            <input value={transportMethod} onChange={(e) => setTransportMethod(e.target.value)} />
          </label>
        </div>

        <div className="metrics">
          <article>
            <span>Source Department</span>
            <strong>{formatTransferDepartmentLabel(sourceDepartment)}</strong>
          </article>
          <article>
            <span>Source Location</span>
            <strong>{formatTransferLocationLabel(sourceLocation)}</strong>
          </article>
          <article>
            <span>Target Department</span>
            <strong>{formatTransferDepartmentLabel(targetDepartment)}</strong>
          </article>
          <article>
            <span>Target Location</span>
            <strong>{formatTransferLocationLabel(targetLocation)}</strong>
          </article>
        </div>

        <div className="grid-4">
          <label>
            Tracking Number
            <input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} />
          </label>
          <label>
            Dispatch Reference
            <input value={dispatchReference} onChange={(e) => setDispatchReference(e.target.value)} />
          </label>
          <label>
            Sender Notes
            <input value={notesSender} onChange={(e) => setNotesSender(e.target.value)} placeholder="Sent between stores" />
          </label>
        </div>

        <h3>Lines</h3>
        {lines.map((line) => (
          <div className="grid-6" key={line.id}>
            <label>
              Product ID
              <input type="number" min={1} value={line.productId || ''} onChange={(e) => updateLine(line.id, 'productId', Number(e.target.value))} required />
            </label>
            <label>
              UOM ID
              <input type="number" min={1} value={line.uomId || ''} onChange={(e) => updateLine(line.id, 'uomId', e.target.value ? Number(e.target.value) : undefined)} />
            </label>
            <label>
              Qty
              <input type="number" min={0.0001} step="0.0001" value={line.qty} onChange={(e) => updateLine(line.id, 'qty', Number(e.target.value))} required />
            </label>
            <label>
              Unit Cost
              <input type="number" min={0} step="0.0001" value={line.unitCost || ''} onChange={(e) => updateLine(line.id, 'unitCost', e.target.value ? Number(e.target.value) : undefined)} />
            </label>
            <label>
              Line Notes
              <input value={line.lineNotes || ''} onChange={(e) => updateLine(line.id, 'lineNotes', e.target.value)} />
            </label>
            <button type="button" className="ghost" onClick={() => removeLine(line.id)} disabled={lines.length === 1}>Remove</button>
          </div>
        ))}

        <div className="row-actions">
          <button type="button" className="ghost" onClick={addLine}>Add Line</button>
          <button type="submit" disabled={!canSubmit || busy}>Create Draft</button>
        </div>
      </form>

      <section className="panel">
        <h3>Dispatch Sign-off</h3>
        <p>Stock leaves the source only after dispatch confirmation.</p>
        <label className="inline">
          <input type="checkbox" checked={confirmDispatch} onChange={(e) => setConfirmDispatch(e.target.checked)} />
          I confirm this stock is physically sent.
        </label>
        <div className="row-actions">
          <button type="button" disabled={!createdTransferId || !confirmDispatch || busy} onClick={handleDispatchExisting}>Dispatch Transfer</button>
        </div>
      </section>

      {status ? <p className="status">{status}</p> : null}
    </section>
  );
}
