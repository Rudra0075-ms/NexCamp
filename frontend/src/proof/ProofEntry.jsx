import React, { Suspense, lazy } from "react";
import { Guard, Skeleton } from "../components/intel/kit.jsx";

/*
 * Round 3's entry points into the existing pages (see CHANGES-ROUND3.md).
 * Every panel is its own lazy chunk, so the first load on a low-end phone
 * carries none of it; each renders nothing unless the API is live and someone
 * is signed in, and each is wrapped in the existing error Guard.
 */

const mod = {
  mission: () => import("./MissionProof.jsx"),
  intervention: () => import("./InterventionProof.jsx"),
  student: () => import("./StudentProof.jsx"),
  staff: () => import("./StaffProof.jsx")
};
const pick = (m, name) => lazy(() => mod[m]().then((x) => ({ default: x[name] })));

const SLOTS = {
  mission: pick("mission", "default"), // 10 · process mining + equity card (staff)
  intervention: pick("intervention", "default"), // 09 · did it work? + portfolio (staff)
  proofBadges: pick("intervention", "ProofBadges"), // 20
  bestSlot: pick("student", "BestSlot"), // 02 (students)
  attendance: pick("student", "AttendanceProof"), // 03 (student view / ADMIN + WARDEN view)
  presence: pick("student", "PresenceForecast"), // 04
  unblock: pick("student", "Unblock"), // 17 (students)
  reliability: pick("staff", "Reliability"), // 08
  equity: pick("staff", "EquityPanel"), // 21 (staff)
  noticeLint: pick("staff", "NoticeLint"), // 13 (inside the compose form)
  preflight: pick("staff", "PreflightButton") // 15 (beside the existing commit button)
};

const STUDENT_ONLY = new Set(["bestSlot", "unblock"]);
const STAFF_ONLY = new Set(["mission", "intervention", "equity", "noticeLint", "preflight"]);

/** A named Round 3 panel inside an existing page. */
export function PfSlot({ name, live, user, fallback = null, ...props }) {
  const Panel = SLOTS[name];
  if (!Panel || !live || !user) return fallback;
  if (STUDENT_ONLY.has(name) && user.role !== "STUDENT") return fallback;
  if (STAFF_ONLY.has(name) && user.role === "STUDENT") return fallback;
  const inline = name === "noticeLint" || name === "preflight";
  return (
    <Guard name={`round3:${name}`}>
      <Suspense fallback={inline ? null : <div className="ci" aria-busy="true"><Skeleton lines={3} /></div>}>
        <Panel user={user} {...props} />
      </Suspense>
    </Guard>
  );
}
