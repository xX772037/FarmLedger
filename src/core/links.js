// Links between records: a treatment links to an animal and a supply, a sale to a contact and money,
// a note to a field. A link is { type, id }; a record keeps its links in data.links.

/** Keep only well-formed links, without duplicates. */
export function cleanLinks(links) {
  const seen = new Set(), out = [];
  for (const l of Array.isArray(links) ? links : []) {
    if (!l || typeof l.type !== 'string' || typeof l.id !== 'string' || !l.type || !l.id) continue;
    const k = `${l.type}:${l.id}`;
    if (!seen.has(k)) { seen.add(k); out.push({ type: l.type, id: l.id }); }
  }
  return out;
}

export const linksTo = (record, type, id) => (record?.data?.links || []).some(l => l.type === type && l.id === id);

/** Records of `type` (in an operation) that link to the given record. */
export async function linkedRecords(ops, type, target) {
  return (await ops.list(type)).filter(r => linksTo(r, target.type, target.id));
}
