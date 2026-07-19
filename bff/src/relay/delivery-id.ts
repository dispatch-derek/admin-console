// bff/src/relay/delivery-id.ts — stable transport delivery id composition (spec REQ-F004-018/048;
// design §2.3). `deliveryId = "<outbox-epoch>:<row-id>"`: the epoch is the outbox_meta singleton
// generated once per DB provisioning (constant for the DB lifetime); the row id is the
// event_outbox.id. Identical across every re-delivery of a row (the consumer-dedupe key), yet
// distinct across a DB reset that recycles SQLite rowids (a fresh epoch). Lives only at the
// transport/message level — never inside the frozen AdminEventEnvelope (REQ-F004-004).

export function composeDeliveryId(epoch: string, rowId: number): string {
  return `${epoch}:${rowId}`;
}
