import { Anomaly } from "../models/Anomaly.js";
import { Building } from "../models/Building.js";
import { Complaint } from "../models/Complaint.js";
import { Incident } from "../models/Incident.js";
import { Relationship } from "../models/Relationship.js";
import { round } from "../utils/text.js";

/** Cross-domain chains as graph nodes and edges, ready for any visualisation. */
export async function relationships({ chain } = {}) {
  const filter = chain ? { chain } : {};
  const edges = await Relationship.find(filter).sort({ chain: 1, order: 1 }).lean();

  const chains = new Map();
  for (const edge of edges) {
    const entry = chains.get(edge.chain) || { chain: edge.chain, edges: [], labels: [] };
    entry.edges.push(edge);
    chains.set(edge.chain, entry);
  }

  const nodeIds = new Map();
  const nodes = [];
  const idFor = (label, type) => {
    if (!nodeIds.has(label)) {
      const id = `n${nodes.length}`;
      nodeIds.set(label, id);
      nodes.push({ id, label, type });
    }
    return nodeIds.get(label);
  };

  const graphEdges = edges.map((edge) => ({
    id: String(edge._id),
    chain: edge.chain,
    from: idFor(edge.fromLabel, edge.fromType),
    to: idFor(edge.toLabel, edge.toType),
    fromLabel: edge.fromLabel,
    toLabel: edge.toLabel,
    relation: edge.relation,
    confidence: edge.confidence,
    basis: edge.basis,
    kind: edge.kind,
    order: edge.order
  }));

  return {
    nodes,
    edges: graphEdges,
    chains: [...chains.values()].map((entry) => ({
      chain: entry.chain,
      steps: [entry.edges[0].fromLabel, ...entry.edges.map((edge) => edge.toLabel)],
      confidence: round(
        entry.edges.reduce((total, edge) => total + edge.confidence, 0) / entry.edges.length
      )
    })),
    method: "STORED_RELATIONSHIP_GRAPH",
    disclaimer: "Edge confidences are stored analyst/rule estimates, not model outputs."
  };
}

/** Everything the system knows that touches one entity. */
export async function forEntity(entityType, entityId) {
  const stored = await Relationship.find({ entityType, entityId }).sort({ order: 1 }).lean();

  if (entityType === "Building") {
    const building = await Building.findById(entityId).lean();
    if (!building) return null;

    const [incidents, complaintCount, anomalies] = await Promise.all([
      Incident.find({ building: building._id }).sort({ risk: -1 }).limit(10).lean(),
      Complaint.countDocuments({ building: building._id }),
      Anomaly.find({ building: building._id, status: { $ne: "DISMISSED" } })
        .sort({ predictedRisk: -1 })
        .limit(5)
        .lean()
    ]);

    return {
      entity: {
        type: "Building",
        id: String(building._id),
        code: building.code,
        name: building.name,
        risk: building.currentRisk,
        riskLevel: building.riskLevel
      },
      related: {
        incidents: incidents.map((incident) => ({
          id: String(incident._id),
          reference: incident.reference,
          title: incident.title,
          risk: incident.risk,
          status: incident.status,
          complaints: incident.complaints?.length || 0
        })),
        complaintCount,
        anomalies: anomalies.map((anomaly) => ({
          id: String(anomaly._id),
          signal: anomaly.signal,
          predictedRisk: anomaly.predictedRisk,
          complaintsSoFar: anomaly.complaintsSoFar
        }))
      },
      edges: stored.map((edge) => ({
        fromLabel: edge.fromLabel,
        toLabel: edge.toLabel,
        relation: edge.relation,
        confidence: edge.confidence,
        basis: edge.basis
      })),
      method: "DATABASE_JOIN"
    };
  }

  if (entityType === "Incident") {
    const incident = await Incident.findById(entityId).populate("building", "code name").lean();
    if (!incident) return null;
    const complaints = await Complaint.find({ relatedIncident: incident._id })
      .select("reference title status createdAt")
      .lean();

    return {
      entity: {
        type: "Incident",
        id: String(incident._id),
        reference: incident.reference,
        title: incident.title,
        risk: incident.risk,
        status: incident.status
      },
      related: {
        building: incident.building
          ? { id: String(incident.building._id), code: incident.building.code, name: incident.building.name }
          : null,
        complaints: complaints.map((c) => ({
          id: String(c._id),
          reference: c.reference,
          title: c.title,
          status: c.status,
          createdAt: c.createdAt
        }))
      },
      edges: stored.map((edge) => ({
        fromLabel: edge.fromLabel,
        toLabel: edge.toLabel,
        relation: edge.relation,
        confidence: edge.confidence,
        basis: edge.basis
      })),
      method: "DATABASE_JOIN"
    };
  }

  return { entity: { type: entityType, id: entityId }, related: {}, edges: stored, method: "DATABASE_JOIN" };
}
