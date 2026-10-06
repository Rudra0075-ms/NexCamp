import React, { Suspense, lazy } from "react";
import { Guard, Skeleton } from "../components/intel/kit.jsx";

/*
 * Silent Support System — entry points into existing pages (see
 * CHANGES-SILENT-SUPPORT.md). No page, route or nav item is added.
 *
 *   student  → 02 Student Dashboard: wellbeing check-in, "I don't know how to
 *              ask for help", private requests, "check on me later" (students only)
 *   mission  → 10 Mission Control: Student Support Overview (ADMIN: aggregate
 *              only) and the support queue (COUNSELLOR only)
 *
 * Each panel is its own lazy chunk, renders nothing unless the API is live and
 * the right role is signed in, and sits inside the existing error Guard.
 */

const StudentSupport = lazy(() => import("./StudentSupport.jsx"));
const MissionSupport = lazy(() => import("./MissionSupport.jsx"));

export function SupportSlot({ name, live, user, ...props }) {
  if (!user) return null;
  let Panel = null;
  if (name === "student" && user.role === "STUDENT") Panel = StudentSupport;
  if (name === "mission" && (user.role === "COUNSELLOR" || user.role === "ADMIN")) Panel = MissionSupport;
  if (!Panel) return null;
  return (
    <Guard name={`support:${name}`}>
      <Suspense fallback={<div className="ci" aria-busy="true" style={{ paddingTop: 12, paddingBottom: 12 }}><Skeleton lines={2} /></div>}>
        <Panel user={user} live={live} {...props} />
      </Suspense>
    </Guard>
  );
}
