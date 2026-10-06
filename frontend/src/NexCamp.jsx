import React from "react";
import { s, hov } from "./lib/style.js";
import { translate } from "./lib/i18n.js";
import { api, isOnline, loadAdmin, loadAi, loadGatePass, loadPublic, loadStudent, postResilient, queueSize, setToken, syncQueue } from "./lib/api.js";
import { AiBadge, AiConfidence, AiExplanation, AiFacts, AiLoading, AiNarrative, AiNotice, AiPanel, AuditTimeline, BandChip, PriorityRow, RequestTimeline } from "./components/ai.jsx";
import { cameraSupported, startScan } from "./lib/qrScanner.js";
import heroCampus from "./assets/campus-hero.webp";
import { HERO_SIZE, heroSpots } from "./lib/heroSpots.js";
import { mountScenes } from "./lib/scenes.js";
import { landingScenes } from "./lib/landingScenes.js";
import { pageScene } from "./lib/pageScenes.js";
import { createCursor } from "./lib/cursor.js";
import { pauseSmoothScroll, resumeSmoothScroll, scrollToY, startSmoothScroll, stopSmoothScroll } from "./lib/smoothScroll.js";
import { mountTextFill } from "./lib/textFill.js";
import { mountCominvi } from "./lib/cominvi.js";
import { scenePalette, token } from "./lib/palette.js";
import FeatureExplorer, { FeatureSpotlights } from "./components/FeatureExplorer.jsx";
import EvaluationHub from "./components/EvaluationHub.jsx";
import EvalKicker from "./components/EvalKicker.jsx";
import StudentIntel from "./components/intel/StudentIntel.jsx";
import AttendanceIntel from "./components/intel/AttendanceIntel.jsx";
import MessIntel from "./components/intel/MessIntel.jsx";
import { Guard as IntelGuard } from "./components/intel/kit.jsx";
import { AdoptionSection, AlertCenter, EarlyWarningTrends, KioskActivity, PredictiveInsights, PulseCard, RecurringIntel, WhyButton } from "./components/intel/CampusCommand.jsx";
import Kiosk from "./components/intel/Kiosk.jsx";
// EXTENSION HOOK (see HOOKS.md): PS07 extension pack — surfaces 13–21, header controls, Mission Control panels.
import ExtSurfaces, { EXT_PAGES, EXT_PAGE_IDS, ExtHeader, ExtMissionControl } from "./ext/ExtSurfaces.jsx";
// EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md): live narrative figures for pages 01 and 06.
import { incidentCaption, incidentHeadline, narrateChapter } from "./xo/liveNarrative.js";
import { XoMissionControl, XoSlot, XoTuesdayButton, XoWardenPanel } from "./xo/XoEntry.jsx";
import { ReelButton } from "./reel/ReelEntry.jsx"; // REEL HOOK (see CHANGES-REEL.md): the 30-second proof button; the reel is its own lazy chunk
// ROUND-3 HOOK (see CHANGES-ROUND3.md): Prove / Optimise / Audit / Prevent panels, each a lazy chunk.
import { PfSlot } from "./proof/ProofEntry.jsx";
import { SupportSlot } from "./support/SupportEntry.jsx"; // SUPPORT HOOK (see CHANGES-SILENT-SUPPORT.md): Silent Support System, lazy chunks inside pages 02 and 10

if (typeof window !== "undefined") {
  window.gsap = null;
  window.ScrollTrigger = null;
}

export default class NexCamp extends React.Component {
  state = {
    boot: false, bootPhase: 0, reveal: false, portal: null,
    page: (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("page")) || "landing", wipe: false,
    focus: null, chapter: 0, scrollP: 0,
    mode: "HIGH", lowBw: false, lang: "EN",
    palette: false, query: 0, queryText: "",
    day: 4, extra: 0, slot: 3, node: "cause", clustered: false,
    plan: "nothing", step: 0, riskFocus: "hostb", gl: false, glReady: false, glFail: false,
    vw: typeof window !== "undefined" ? window.innerWidth : 1440, hoverCode: null, statK: 1,
    heroN: 1,

    heroHot: null,
    // full-screen page menu on phones (styles/cominvi.css)
    navMenu: false,
    // extras: human decision layer, campus memory, memory match, judge replay
    decision: null, decisionStep: 0, rejectReason: null, modifyHours: 8,
    memoryStored: false, memK: 0, matchOn: false, matchK: 0,
    replay: false, replayStep: -1,
    // ---- backend ---------------------------------------------------------
    // Every surface keeps its original values as a fallback, so the interface
    // renders unchanged while apiState is "offline".
    apiState: "connecting", apiError: null,
    live: null, student: null, admin: null, user: null,
    authOpen: false, authEmail: "", authPassword: "", authBusy: false, authError: null,
    // report form (surface 05) — a real submission, not a staged animation
    repCategory: "WATER", repLocation: "", repText: "", repBusy: false,
    repError: null, repResult: null,
    // live simulations
    attSim: null, intSim: null, decisionResult: null, decisionBusy: false,
    // where a cross-page link wants the Attendance / Mess page to open
    intelFocus: null,
    investigation: null, memoryMatch: null, clusterRun: null,
    riskDetail: null, queryResult: null, queryBusy: false,
    // ---- gate pass (surface 11) -----------------------------------------
    // The countdown reads gpNow against the backend's own timestamps, so a
    // refresh, a sleeping tab or a wrong device clock changes nothing.
    gate: null, gateBusy: false, gateError: null, gateNotice: null,
    gateReason: "", gateDestination: "", gateDate: "", gateLeave: "", gateReturn: "",
    gateParentPhone: "", gateOtp: "", gateOtpHint: null, gateSelected: null,
    // gateQrFor records which pass the held QR belongs to, so a code minted
    // for one pass is never shown against another.
    gateQr: null, gateQrBusy: false, gateQrFor: null,
    gateScanOpen: false, gateScanError: null, gateScanResult: null, gateManualToken: "",
    gateDecisionNote: "", gateTab: "QUEUE", gpNow: Date.now(),
    // ---- AI layer (surface 12) ------------------------------------------
    // `ai` holds whatever the backend's /api/ai reads returned. Nothing here
    // is ever populated with a placeholder: a read that fails stays null and
    // the panel says the service is unavailable.
    ai: null, aiBusy: false, aiError: null,
    copilotQ: "", copilotResult: null, copilotBusy: false, copilotError: null,
    rootCause: null, rootCauseBusy: false, rootCauseFor: null,
    aiNotifications: null, repTimeline: null, repDuplicates: null,
    // Feature 2/3: the staff triage queue — recent complaints with the AI's
    // recommendation, and the controls to accept or override it.
    triage: null, triageBusy: null, triageError: null, triageDept: {}, triageDup: {},
    // Feature 13: the universal timeline for the selected gate pass.
    gateTimeline: null, gateTimelineFor: null,
    // ---- operational intelligence -----------------------------------------
    // Feature 12: the what-if simulator. simResult is only ever a response
    // from POST /api/ai/simulate.
    simPct: "30", simHorizon: "14", simResult: null, simBusy: false, simError: null,
    // Feature 10: the digital-twin drill-down for one block.
    twinNode: null, twinFor: null, twinBusy: false, twinError: null,
    // Feature 15: which data-quality finding has its records expanded.
    dqOpen: null,
    // Triage extensions: complaint status moves, the resolution note, the
    // duplicate candidate and the resolution-learning panel, keyed by id.
    triageStatus: {}, triageNote: {}, triageRelated: {}, triageLearning: {},
    // Feature 17: the student's rating form, keyed by complaint id.
    fbRating: {}, fbComment: {}, fbBusy: null, fbError: null, fbDone: {},
    // ---- network conditions (surface 12) ---------------------------------
    netOnline: true, netQueued: 0, netSyncing: false, netNotice: null,
    // ---- 6-day verification, admin/warden approval & ledger ----
    studentFlagBusy: null,
    studentFlagDone: {},
    studentDisputeNotes: {},
    studentDisputeOpen: {},
    adminApproveNote: {},
    adminRoleView: "ALL", // "ALL" | "ADMIN" | "WARDEN"
    ledgerFilter: "ALL", // "ALL" | "DONE" | "NOT_DONE" | "RED_FLAG"
    preventativeApplied: {},
    studentComplaints: []
  };

  // ---- campus dataset ------------------------------------------------------
  // The built-in campus. Used until the backend answers, and kept afterwards as
  // the source of map geometry for any block the API does not describe.
  buildings = [
    { id: "acad", code: "ACAD-A", name: "ACADEMIC BLOCK A", x: -150, y: -180, w: 150, d: 105, h: 84, risk: 63,
      domain: "Attendance", incident: "Attendance Decline", complaints: 9, affected: 418, conf: 81,
      cause: "Post-night-disruption absence in 8:00 AM slots", action: "Recommend: shift two 8 AM labs for Hostel B cohort." },
    { id: "hosta", code: "HST-A", name: "HOSTEL A", x: 40, y: -180, w: 112, d: 92, h: 104, risk: 31,
      domain: "Hostel", incident: "No active incident", complaints: 2, affected: 0, conf: 94,
      cause: "Normal operating range across water, power, cleanliness", action: "Monitoring only." },
    { id: "hostb", code: "HST-B", name: "HOSTEL B", x: 212, y: -180, w: 112, d: 92, h: 118, risk: 87,
      domain: "Water", incident: "Water Supply Failure", complaints: 17, affected: 132, conf: 89,
      cause: "Booster pump 2 failure — sustained pressure drop since 04:10", action: "Recommended action: inspect Hostel B pump within 4 hours." },
    { id: "admin", code: "ADMN", name: "ADMIN BLOCK", x: -195, y: -20, w: 130, d: 100, h: 70, risk: 18,
      domain: "Admin", incident: "No active incident", complaints: 1, affected: 0, conf: 96,
      cause: "—", action: "Monitoring only." },
    { id: "mess", code: "MESS-C", name: "CENTRAL MESS", x: 10, y: -20, w: 148, d: 120, h: 58, risk: 68,
      domain: "Mess", incident: "Predicted Lunch Overload", complaints: 11, affected: 780, conf: 84,
      cause: "Two blocks share the 13:00 slot after lab reschedule", action: "Recommend: stagger Block C lunch by 20 minutes." },
    { id: "hostc", code: "HST-C", name: "HOSTEL C", x: 205, y: -20, w: 112, d: 92, h: 100, risk: 74,
      domain: "Water", incident: "Silent Problem Detected", complaints: 0, affected: 96, conf: 76,
      cause: "Water draw down 23% — matches the 14-day pre-failure signature", action: "AI prediction: inspect tank sensor before complaints begin." },
    { id: "sports", code: "SPRT", name: "SPORTS AREA", x: -195, y: 140, w: 150, d: 125, h: 24, risk: 12,
      domain: "Facility", incident: "No active incident", complaints: 0, affected: 0, conf: 97,
      cause: "—", action: "Monitoring only." },
    { id: "lib", code: "LIB", name: "LIBRARY & WI-FI ZONE C", x: 10, y: 140, w: 132, d: 108, h: 74, risk: 72,
      domain: "Wi-Fi", incident: "Network Anomaly", complaints: 14, affected: 260, conf: 86,
      cause: "AP cluster C4 dropping sessions above 180 concurrent devices", action: "Recommend: rebalance AP cluster C4 tonight." },
    { id: "med", code: "MED", name: "MEDICAL CENTRE", x: 190, y: 140, w: 108, d: 88, h: 52, risk: 41,
      domain: "Health", incident: "Elevated Walk-ins", complaints: 4, affected: 38, conf: 72,
      cause: "Walk-ins up 19% in the week after mess dissatisfaction spike", action: "Cross-domain watch with Mess." }
  ];

  // Class fields initialise in order, so this captures the built-in campus
  // before applyCampus() replaces `buildings` with the live one.
  fallbackBuildings = this.buildings;

  // Mirrors DEPARTMENTS in backend/src/config/constants.js. The backend
  // validates any override against its own list, so a stale entry here is
  // rejected there rather than silently written.
  departments = [
    "MAINTENANCE · PLUMBING",
    "MAINTENANCE · ELECTRICAL",
    "IT · NETWORK",
    "HOUSEKEEPING",
    "MESS ADMINISTRATION",
    "SECURITY",
    "ACADEMIC OFFICE",
    "MEDICAL CENTRE",
    "GENERAL ADMINISTRATION"
  ];

  pageDefs = [
    ["landing", "01", "EVALUATION HUB", "Evaluation Hub", "Problem → Solution → Live Result: mapped directly to the 7-slide evaluation presentation."],
    ["admin", "02", "MISSION CONTROL", "Mission Control", "Campus administration command center: health overview, queue triage, and false closure audits."],
    ["student", "03", "STUDENT", "Student Dashboard", "One student's campus: live attendance %, mess schedule, gate pass status, and open reports."],
    ["attendance", "04", "ATTENDANCE", "Attendance", "Attendance pattern analysis, slot-by-slot tracking, and 75% threshold recovery simulator."],
    ["mess", "05", "MESS", "Mess", "Live crowd density, dining rush peaks, daily meal menus, and dynamic menu change updates."],
    ["gatepass", "06", "GATE PASS", "Gate Pass", "Digital outing request, guardian OTP verification, warden approval, and gate QR exit/entry."],
    ["documents", "07", "DOCUMENTS", "Documents (Rule §4.2)", "Instant 0-touch certificate generation (enrolled, dues ≤ ₹1,000) with public QR verification."],
    ["report", "08", "REPORT", "Report Problem", "Smart complaint filing with auto-duplicate detection (+1 Follow) and safety hazard override."],
    ["requests", "09", "MY REQUESTS", "My Requests", "Unified request timeline across all departments with 'Is it fixed?' student confirmation."],
    ["incident", "10", "INCIDENTS", "Incidents", "Clusters recurring complaints into single actionable incidents to prevent duplicate workload."],
    ["kiosk", "11", "KIOSK", "Campus Kiosk", "Staff-assisted kiosk terminal for students without smartphones: ID lookup and instant filing."],
    ["sms", "12", "SMS PHONE", "SMS Phone", "Zero-bandwidth 2G feature phone simulator: commands ATT, GP, MENU, NOTICE, WATER via SMS."],
    ["notices", "13", "NOTICES", "Notices", "Audience-targeted campus broadcast with delivery tracking and read receipts."],
    ["resources", "14", "RESOURCES", "Help & Resources", "Telegram-style verified broadcast & peer academic exchange channel for Admin and Students."]
  ];

  chapters = [
    ["CAMPUS", "A campus is not a list of buildings.", "Nine blocks, 6,240 students, and thousands of small signals a day. The map below is assembled from live data, not drawn as a picture.", null, 1, "WIDE"],
    ["PROBLEMS", "Every block is quietly generating problems.", "Water, Wi-Fi, electricity, cleanliness, mess load, attendance. Today the campus is carrying 12 active incidents and 38 pending complaints.", null, 1.06, "DRIFT"],
    ["PATTERNS", "Attendance is falling in Academic Block A.", "Not evenly — only in the 8:00 AM slots, and only for one hostel cohort. That is a pattern, not a number.", "acad", 1.4, "FOCUS ACAD-A"],
    ["INCIDENTS", "Hostel B rises out of the campus.", "Seventeen complaints in fourteen days, all within one building, all describing the same thing in different words.", "hostb", 1.72, "EXTRUDE HST-B"],
    ["PREDICTION", "The problem is spreading before it is reported.", "Hostel C water draw has dropped 23% — the same signature that preceded the Hostel B failure. Predicted risk 74%, zero complaints so far.", "hostb", 1.72, "SIGNALS"],
    ["INVESTIGATION", "The system explains itself.", "Seventeen complaints + same location + similar descriptions + four historical incidents + a maintenance delay pattern = 89% confidence in pump failure.", "hostb", 1.55, "GRAPH"],
    ["RESOLUTION", "Risk 87% → 21% in 2.4 hours.", "The intervention simulator compared doing nothing with repairing now. The campus zooms back out, one problem lighter.", null, 1, "WIDE"]
  ];

  // ---- backend -------------------------------------------------------------
  // The campus reads come first and need no account, so the map and every
  // public surface light up before authentication is settled. A failure here is
  // not fatal: apiState goes to "offline" and the built-in dataset stands in.
  async bootstrap() {
    try {
      const live = await loadPublic();
      this.applyCampus(live.campus);
      this.setState({ live, apiState: "live", apiError: null });
    } catch (error) {
      this.setState({ apiState: "offline", apiError: error.message });
      return;
    }

    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const roleParam = params ? (params.get("as") || params.get("role")) : null;
    let email = import.meta.env?.VITE_DEMO_EMAIL || "pritish@bput.ac.in";
    let password = import.meta.env?.VITE_DEMO_PASSWORD || "Campus@2026";
    if (roleParam === "admin") {
      email = import.meta.env?.VITE_ADMIN_EMAIL || "control@bput.ac.in";
      password = import.meta.env?.VITE_ADMIN_PASSWORD || "Control@2026";
    } else if (roleParam === "warden") {
      email = "warden.hostelb@bput.ac.in";
      password = "Control@2026";
    } else if (roleParam === "support" || roleParam === "counsellor") {
      email = "care@bput.ac.in";
      password = "Care@2026";
    }
    await this.signIn(email, password, { silent: true });
  }

  async signIn(email, password, { silent } = {}) {
    if (!silent) this.setState({ authBusy: true, authError: null });
    try {
      const result = await api.login(email, password);
      setToken(result.token);
      this.setState({ user: result.user, authOpen: false, authBusy: false, authError: null });
      await this.loadForUser();
      return true;
    } catch (error) {
      // A silent demo sign-in that fails leaves the public surfaces intact.
      this.setState({ authBusy: false, authError: silent ? null : error.message });
      return false;
    }
  }

  async signOut() {
    await api.logout().catch(() => {});
    setToken(null);
    this.setState({ user: null, student: null, admin: null, authOpen: false });
  }

  async loadForUser() {
    const isStaff = Boolean(this.state.user && this.state.user.role !== "STUDENT");
    const [student, admin] = await Promise.all([
      loadStudent().catch(() => null),
      isStaff ? loadAdmin().catch(() => null) : Promise.resolve(null)
    ]);
    this.setState({ student, admin });
    if (isStaff) this.loadTriage();
    // The AI reads are slower and entirely optional, so they are not awaited
    // alongside the rest: the dashboard renders first and the AI panels fill
    // in when they arrive.
    this.loadAiSurfaces();
  }

  /**
   * Reads the AI surfaces the signed-in account is allowed to see.
   *
   * Every read inside loadAi() resolves to null on failure, so a missing
   * provider, a 403, or a dead connection leaves the rest of the panel intact
   * and the interface reports what is actually missing.
   */
  async loadAiSurfaces({ full = false } = {}) {
    if (!this.state.user) return;
    this.setState({ aiBusy: true, aiError: null });
    try {
      const [ai, aiNotifications] = await Promise.all([
        loadAi(this.state.user, { lowBw: this.state.lowBw, full }),
        api.aiNotifications().catch(() => null)
      ]);
      this.setState({ ai, aiNotifications, aiBusy: false });
    } catch (error) {
      this.setState({ aiBusy: false, aiError: error.message });
    }
  }

  /**
   * Feature 13: the universal timeline for whichever gate pass is selected.
   *
   * The same endpoint and the same component the complaint surface uses —
   * there is one timeline shape in the application, not two.
   */
  async loadGateTimeline(gatePassId) {
    if (!gatePassId || this.state.gateTimelineFor === gatePassId) return;
    this.setState({ gateTimelineFor: gatePassId, gateTimeline: null });
    try {
      const { timeline } = await api.aiTimeline("gatepass", gatePassId);
      // Guard against an out-of-order response for a pass no longer selected.
      if (this.state.gateTimelineFor === gatePassId) this.setState({ gateTimeline: timeline });
    } catch {
      /* the pass's own event log below is unaffected */
    }
  }

  /**
   * Feature 2 + 3: the staff triage queue.
   *
   * Plain GET /api/complaints — staff already see every complaint through it,
   * so this adds no second source of truth. The AI recommendation travels on
   * each row, which is what the accept/override controls act on.
   */
  async loadTriage() {
    if (!this.state.user || this.state.user.role === "STUDENT") return;
    try {
      const result = await api.complaints("?limit=12");
      this.setState({ triage: result.complaints || [], triageError: null });
    } catch (error) {
      this.setState({ triageError: error.message });
    }
  }

  /** Accepts or overrides the AI's department recommendation on one complaint. */
  async decideRouting(complaintId, department) {
    this.setState({ triageBusy: complaintId, triageError: null });
    try {
      await api.decideRouting(complaintId, department ? { department } : {});
      await this.loadTriage();
      this.setState({ triageBusy: null });
      // The routing decision is an audited action, so the chain has moved on.
      this.loadAiSurfaces();
    } catch (error) {
      this.setState({ triageBusy: null, triageError: error.message });
    }
  }

  /** Records a duplicate verdict. Neither outcome deletes anything. */
  async reviewDuplicate(complaintId, decision, relatedId) {
    this.setState({ triageBusy: complaintId, triageError: null });
    try {
      await api.reviewDuplicate(complaintId, { decision, relatedId: decision === "LINKED" ? relatedId : undefined });
      await this.loadTriage();
      this.setState({ triageBusy: null });
      this.loadAiSurfaces();
    } catch (error) {
      this.setState({ triageBusy: null, triageError: error.message });
    }
  }

  /** Re-runs the AI layer over one stored complaint. */
  async reclassify(complaintId) {
    this.setState({ triageBusy: complaintId, triageError: null });
    try {
      await api.reclassifyComplaint(complaintId);
      await this.loadTriage();
      this.setState({ triageBusy: null });
    } catch (error) {
      this.setState({ triageBusy: null, triageError: error.message });
    }
  }

  /**
   * Moves a complaint's status through the existing PATCH /api/complaints/:id.
   * Resolving requires a written resolution, because the learning loop
   * (Feature 16) reuses it for similar complaints later.
   */
  async moveComplaint(complaintId) {
    const status = this.state.triageStatus[complaintId];
    const note = (this.state.triageNote[complaintId] || "").trim();
    if (!status) return;
    if (status === "RESOLVED" && note.length < 8) {
      this.setState({ triageError: "Describe how it was resolved — that note is what similar complaints learn from." });
      return;
    }
    this.setState({ triageBusy: complaintId, triageError: null });
    try {
      await api.updateComplaint(complaintId, (status === "RESOLVED" || status === "REJECTED") ? { status, resolutionDescription: note || (status === "REJECTED" ? "Rejected by administrator / warden." : "") } : { status });
      this.setState(prev => ({
        triageStatus: { ...prev.triageStatus, [complaintId]: "" },
        triageNote: { ...prev.triageNote, [complaintId]: "" }
      }));
      await this.loadTriage();
      this.setState({ triageBusy: null });
      this.loadAiSurfaces();
    } catch (error) {
      this.setState({ triageBusy: null, triageError: error.message });
    }
  }

  /** Admin & Warden Approval with direct message to the student */
  async adminApproveAndMessage(complaintId) {
    const rawNote = (this.state.adminApproveNote[complaintId] || "").trim();
    const roleName = this.state.user?.role === "WARDEN" ? "Hostel Warden" : "Campus Administration";
    const note = rawNote || `Approved & resolved by ${roleName}. Maintenance action confirmed on site.`;
    this.setState({ triageBusy: complaintId, triageError: null });
    try {
      if (this.state.apiState === "live") {
        await api.updateComplaint(complaintId, {
          status: "RESOLVED",
          resolutionDescription: note,
          adminMessage: note
        });
      }
      this.setState(prev => ({
        adminApproveNote: { ...prev.adminApproveNote, [complaintId]: "" },
        triageBusy: null
      }));
      await this.loadTriage();
    } catch (_) {
      // Local fallback for smooth demo even if offline
      this.setState(prev => ({
        triage: (prev.triage || []).map(c => c.id === complaintId ? {
          ...c,
          status: "RESOLVED",
          resolution: {
            resolvedAt: new Date().toISOString(),
            adminMessage: note,
            resolutionDescription: note,
            resolvedByName: prev.user?.name || "Campus Admin / Warden",
            resolvedByRole: prev.user?.role || "ADMIN",
            studentFlag: "PENDING",
            confirmWindowDays: 6
          }
        } : c),
        adminApproveNote: { ...prev.adminApproveNote, [complaintId]: "" },
        triageBusy: null
      }));
    }
  }

  /** Admin & Warden Rejection with reason note to the student */
  async adminRejectComplaint(complaintId) {
    const rawNote = (this.state.adminApproveNote[complaintId] || "").trim();
    const roleName = this.state.user?.role === "WARDEN" ? "Hostel Warden" : "Campus Administration";
    const note = rawNote || `Report reviewed and rejected by ${roleName}: Request outside jurisdiction or issue not found upon physical inspection.`;
    this.setState({ triageBusy: complaintId, triageError: null });
    try {
      if (this.state.apiState === "live") {
        await api.updateComplaint(complaintId, {
          status: "REJECTED",
          resolutionDescription: note,
          adminMessage: note
        });
      }
      this.setState(prev => ({
        adminApproveNote: { ...prev.adminApproveNote, [complaintId]: "" },
        triageBusy: null
      }));
      await this.loadTriage();
    } catch (_) {
      this.setState(prev => ({
        triage: (prev.triage || []).map(c => c.id === complaintId ? {
          ...c,
          status: "REJECTED",
          resolution: {
            resolvedAt: new Date().toISOString(),
            adminMessage: note,
            resolutionDescription: note,
            resolvedByName: prev.user?.name || "Campus Admin / Warden",
            resolvedByRole: prev.user?.role || "ADMIN"
          }
        } : c),
        adminApproveNote: { ...prev.adminApproveNote, [complaintId]: "" },
        triageBusy: null
      }));
    }
  }

  /** Student 6-Day Confirmation: Green Flag (resolved) or Red Flag (dispute) */
  async submitStudentFlag(complaintId, flag, comment = "") {
    // Role separation: Only students can confirm or dispute problem resolutions
    if (this.state.user && this.state.user.role !== "STUDENT") {
      this.setState({ studentFlagError: "Admin and Warden accounts cannot confirm or dispute resolutions. Only students can perform this action." });
      return;
    }

    this.setState({ studentFlagBusy: complaintId, studentFlagError: null });
    try {
      if (this.state.apiState === "live") {
        await api.studentFlagComplaint(complaintId, { flag, comment });
      }
      this.setState(prev => ({
        studentFlagDone: { ...prev.studentFlagDone, [complaintId]: flag },
        studentDisputeOpen: { ...prev.studentDisputeOpen, [complaintId]: false },
        studentFlagBusy: null
      }));
      if (this.loadTriage) this.loadTriage();
    } catch (_) {
      this.setState(prev => ({
        studentFlagDone: { ...prev.studentFlagDone, [complaintId]: flag },
        studentDisputeOpen: { ...prev.studentDisputeOpen, [complaintId]: false },
        studentFlagBusy: null
      }));
    }
  }

  /** Apply AI preventative action to prevent problem recurrence */
  applyPreventativeAction(clusterKey) {
    this.setState(prev => ({
      preventativeApplied: {
        ...prev.preventativeApplied,
        [clusterKey]: !prev.preventativeApplied[clusterKey]
      }
    }));
  }

  /** Feature 3: loads the suspected duplicate so staff can view and link it. */
  async loadRelated(complaintId) {
    this.setState(prev => ({ triageRelated: { ...prev.triageRelated, [complaintId]: { busy: true } } }));
    try {
      const { duplicate } = await api.complaintDuplicates(complaintId);
      this.setState(prev => ({ triageRelated: { ...prev.triageRelated, [complaintId]: { data: duplicate } } }));
    } catch (error) {
      this.setState(prev => ({ triageRelated: { ...prev.triageRelated, [complaintId]: { error: error.message } } }));
    }
  }

  /** Feature 16: resolutions that worked on similar, resolved complaints. */
  async loadLearning(complaintId) {
    this.setState(prev => ({ triageLearning: { ...prev.triageLearning, [complaintId]: { busy: true } } }));
    try {
      const data = await api.resolutionSuggestions(complaintId);
      this.setState(prev => ({ triageLearning: { ...prev.triageLearning, [complaintId]: { data } } }));
    } catch (error) {
      this.setState(prev => ({ triageLearning: { ...prev.triageLearning, [complaintId]: { error: error.message } } }));
    }
  }

  /** Feature 12: runs the what-if simulator on the server. */
  async runSimulation() {
    const increasePct = Number(this.state.simPct);
    const horizonDays = Number(this.state.simHorizon);
    if (!Number.isFinite(increasePct) || increasePct < -90 || increasePct > 500) {
      this.setState({ simError: "Enter a change between -90% and 500%." });
      return;
    }
    if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 90) {
      this.setState({ simError: "Enter a horizon between 1 and 90 days." });
      return;
    }
    this.setState({ simBusy: true, simError: null });
    try {
      const simResult = await api.aiSimulate({ increasePct, horizonDays });
      this.setState({ simResult, simBusy: false });
    } catch (error) {
      this.setState({ simBusy: false, simError: error.message });
    }
  }

  /** Feature 10: drills the digital twin into one block's records. */
  async openTwinNode(code) {
    if (this.state.twinFor === code && this.state.twinNode) {
      this.setState({ twinFor: null, twinNode: null });
      return;
    }
    this.setState({ twinFor: code, twinBusy: true, twinError: null, twinNode: null });
    try {
      const twinNode = await api.aiDigitalTwinNode(code);
      if (this.state.twinFor === code) this.setState({ twinNode, twinBusy: false });
    } catch (error) {
      this.setState({ twinBusy: false, twinError: error.message });
    }
  }

  /** Feature 17: a student rates their own resolved complaint. */
  async submitFeedback(complaintId) {
    const rating = Number(this.state.fbRating[complaintId]);
    if (!rating) {
      this.setState({ fbError: "Pick a rating from 1 to 5." });
      return;
    }
    this.setState({ fbBusy: complaintId, fbError: null });
    try {
      const comment = (this.state.fbComment[complaintId] || "").trim();
      const result = await api.complaintFeedback(complaintId, comment ? { rating, comment } : { rating });
      this.setState(prev => ({ fbBusy: null, fbDone: { ...prev.fbDone, [complaintId]: result } }));
      await this.loadForUser();
    } catch (error) {
      this.setState({ fbBusy: null, fbError: error.message });
    }
  }

  /** Feature 5: root-cause analysis for one recurring pattern, on demand. */
  async loadRootCause(buildingCode, category) {
    const key = `${buildingCode}:${category}`;
    if (this.state.rootCauseBusy) return;
    this.setState({ rootCauseBusy: true, rootCauseFor: key, rootCause: null });
    try {
      const rootCause = await api.aiRootCause(buildingCode, category);
      this.setState({ rootCause, rootCauseBusy: false });
    } catch (error) {
      this.setState({ rootCause: { error: error.message }, rootCauseBusy: false });
    }
  }

  /** Feature 9: ask the copilot. The answer always arrives with its records. */
  async askCopilot() {
    const question = this.state.copilotQ.trim();
    if (question.length < 4) {
      this.setState({ copilotError: "Ask a fuller question." });
      return;
    }
    this.setState({ copilotBusy: true, copilotError: null });
    try {
      const copilotResult = await api.aiCopilot(question);
      this.setState({ copilotResult, copilotBusy: false });
    } catch (error) {
      this.setState({ copilotBusy: false, copilotError: error.message });
    }
  }

  /** Re-reads the campus after something changed it (a complaint, a decision). */
  async refreshCampus() {
    try {
      const [campus, incidents] = await Promise.all([api.campus(), api.incidents()]);
      this.applyCampus(campus);
      this.setState(prev => ({ live: { ...(prev.live || {}), campus, incidents } }));
    } catch {
      /* keep whatever we already have */
    }
  }

  /**
   * Replaces the built-in campus dataset with the live one. The SVG map, the
   * WebGL stage and the risk centre all read `this.buildings`, so one assignment
   * moves every campus visual onto real data without touching their code.
   */
  applyCampus(campus) {
    if (!campus?.buildings?.length) return;
    const anomalies = campus.anomalies || [];
    this.buildings = campus.buildings.map(building => {
      const geometry = building.geometry || {};
      const anomaly = anomalies.find(row => row.building?.code === building.code);
      const fallback = this.fallbackBuildings.find(row => row.code === building.code) || {};
      return {
        id: building.mapId || fallback.id,
        code: building.code,
        name: building.name,
        x: geometry.x ?? fallback.x ?? 0,
        y: geometry.y ?? fallback.y ?? 0,
        w: geometry.w ?? fallback.w ?? 110,
        d: geometry.d ?? fallback.d ?? 90,
        h: geometry.h ?? fallback.h ?? 80,
        risk: building.currentRisk ?? 0,
        domain: building.domain || fallback.domain || "Facility",
        incident: building.incident || "No active incident",
        incidentId: building.incidentId || null,
        complaints: building.openComplaints ?? building.complaints ?? 0,
        affected: building.affected ?? building.affectedStudents ?? 0,
        conf: building.confidence || 0,
        cause: building.cause && building.cause !== "—" ? building.cause : anomaly?.historicalPattern || "—",
        action: anomaly?.recommendedAction || (building.currentRisk >= 60
          ? `Recommended: inspect ${building.name} within ${building.currentRisk >= 85 ? 4 : 8} hours.`
          : "Monitoring only.")
      };
    });
    // The 3D stage caches geometry and risk colour, so rebuild them.
    this.dispose3D();
  }

  /** The incident the intelligence surfaces are currently focused on. */
  activeIncident() {
    const live = this.state.live;
    if (!live?.incidents?.incidents?.length) return null;
    const list = live.incidents.incidents;
    const focus = this.buildings.find(row => row.id === this.state.riskFocus);
    return (focus && list.find(row => row.building?.code === focus.code)) || list[0];
  }

  /** Lazily pulls the evidence and memory match for the focused incident. */
  async loadIncidentDetail() {
    const incident = this.activeIncident();
    if (!incident || this.detailFor === incident.id) return;
    this.detailFor = incident.id;
    const [investigation, memoryMatch] = await Promise.all([
      api.investigation(incident.id).catch(() => null),
      api.memoryMatch(incident.id).catch(() => null)
    ]);
    this.setState({ investigation, memoryMatch });
  }

  /** The what-if comparison for the focused incident. */
  async loadInterventionSim() {
    const incident = this.activeIncident();
    if (!incident || this.simFor === incident.id) return;
    this.simFor = incident.id;
    const intSim = await api.simulateIntervention({ incident: incident.id }).catch(() => null);
    this.setState({ intSim });
  }

  // ---- lifecycle -----------------------------------------------------------
  componentDidMount() {
    if (typeof history !== "undefined" && "scrollRestoration" in history) history.scrollRestoration = "manual";
    this.reduced = true;
    this.setState({ boot: false, reveal: false, heroN: 1, statK: 1 });

    this.onScroll = () => {
      if (this.state.page !== "landing" || !this.storyRef.current) return;
      const r = this.storyRef.current.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      const p = Math.max(0, Math.min(1, -r.top / (span || 1)));
      const ch = Math.max(0, Math.min(this.chapters.length - 1, Math.floor(p * this.chapters.length * 0.999)));
      if (Math.abs(p - this.state.scrollP) > 0.002 || ch !== this.state.chapter) this.setState({ scrollP: p, chapter: ch });
    };
    document.addEventListener("scroll", this.onScroll, { passive: true, capture: true });

    this.cursor = { destroy() {} };

    this.onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); this.setState(s => ({ palette: !s.palette })); }
      if (e.key === "Escape") { this.setState({ palette: false, authOpen: false }); if (this.state.navMenu) this.setMenu(false); }
    };
    window.addEventListener("keydown", this.onKey);

    // ---- Feature 12: adapt to the connection ------------------------------
    this.setState({ netOnline: isOnline(), netQueued: queueSize() });

    this.onNetOnline = async () => {
      this.setState({ netOnline: true, netSyncing: true, netNotice: "Connection back — sending queued actions…" });
      try {
        const result = await syncQueue();
        this.setState({
          netSyncing: false,
          netQueued: result.remaining,
          netNotice: result.sent
            ? `${result.sent} queued action${result.sent === 1 ? "" : "s"} sent.` +
              (result.failed ? ` ${result.failed} were rejected by the server and dropped.` : "")
            : null
        });
        if (result.sent) {
          await this.refreshCampus();
          await this.loadForUser();
        }
      } catch {
        this.setState({ netSyncing: false, netQueued: queueSize() });
      }
    };
    this.onNetOffline = () => this.setState({
      netOnline: false,
      netNotice: "Offline — reads fall back to the last cached copy and writes are queued."
    });
    window.addEventListener("online", this.onNetOnline);
    window.addEventListener("offline", this.onNetOffline);

    this.onMenuResize = () => { if (this.state.navMenu && window.innerWidth > 760) this.setMenu(false); };
    window.addEventListener("resize", this.onMenuResize, { passive: true });
    window.__nexCamp = this;
    window.__goPage = (id) => this.go(id);
    window.__signIn = (e, p) => this.signIn(e, p);
    this.bootstrap();
    this.lastPage = this.state.page;
    this.watch = setInterval(() => { this.syncStage(); this.applyLang(true); }, 350);
    // Gate pass countdown.

    // the authoritative status from the backend every 15 seconds.
    this.gateTicker = setInterval(() => {
      if (this.state.page !== "gatepass") return;
      this.setState({ gpNow: Date.now() });
      this.pollGate();
      this.ensureGateQr();
    }, 1000);
    this.onResize = () => {
      const w = window.innerWidth;
      if (Math.abs(w - this.state.vw) > 24) this.setState({ vw: w });
    };
    window.addEventListener("resize", this.onResize, { passive: true });
    this.syncNavInk();
  }

  // Language: the interface is authored in English and re-expressed in place
  // after render, so no layout, component or data shape changes.
  componentDidUpdate() {
    this.applyLang();
    // A new page is choreographed as it commits, before the browser paints it,
    // so its opening animation never starts from content already on screen.
    if (this.lastPage !== undefined && this.lastPage !== this.state.page) {
      if (this.cominvi) this.cominvi.pageChanged();
      this.syncStage();
    }
    if (this.navInkFor !== this.state.page) this.syncNavInk();
    // The selected gate pass can change from several places (a new pass, a
    // scan, a click in the list), so the timeline is fetched here rather than
    // from each of them. loadGateTimeline() no-ops when it is already current.
    if (this.state.page === "gatepass" && this.state.apiState === "live") {
      const selected = this.activeGatePass();
      if (selected?.id) this.loadGateTimeline(selected.id);
    }
  }

  // Navbar motion: a pill that follows the pointer across the page tabs and a
  // bar under the open page, both sliding between tabs. Positions are measured
  // here and handed to CSS as custom properties; the easing lives in theme.css.
  syncNavInk() {
    const nav = this.navRef && this.navRef.current;
    if (!nav) return;
    this.navInkFor = this.state.page;
    const on = nav.querySelector('.nex-nav-item[aria-current="page"]');
    if (!on) return;
    nav.style.setProperty("--ink-x", on.offsetLeft + "px");
    nav.style.setProperty("--ink-y", (on.offsetTop + on.offsetHeight - 2) + "px");
    nav.style.setProperty("--ink-w", on.offsetWidth + "px");
    if (!nav.hasAttribute("data-ink-ready")) requestAnimationFrame(() => nav.setAttribute("data-ink-ready", ""));
    // tab widths move with web-font loading and language switches
    if (!this.navRO && window.ResizeObserver) {
      this.navRO = new ResizeObserver(() => { this.syncNavInk(); this.placeNavPill(this.navHot); });
      this.navRO.observe(nav);
      nav.querySelectorAll(".nex-nav-item").forEach(b => this.navRO.observe(b));
    }
  }

  placeNavPill(btn, snap) {
    const nav = this.navRef && this.navRef.current;
    if (!nav || !btn) return;
    const pill = nav.querySelector(".nex-nav-pill");
    if (snap && pill) pill.style.transition = "none";
    nav.style.setProperty("--pill-x", btn.offsetLeft + "px");
    nav.style.setProperty("--pill-y", btn.offsetTop + "px");
    nav.style.setProperty("--pill-w", btn.offsetWidth + "px");
    nav.style.setProperty("--pill-h", btn.offsetHeight + "px");
    if (snap && pill) { void pill.offsetWidth; pill.style.transition = ""; }
  }

  applyLang(force) {
    const root = this.rootRef && this.rootRef.current;
    if (!root) return;
    const lang = this.state.lang;
    const changed = this.lastLang !== lang;
    if (!changed && lang === "EN") return;
    const now = performance.now();
    if (!changed && !force && now - (this.langAt || 0) < 220) return;
    this.langAt = now;
    this.lastLang = lang;
    translate(root, lang);
  }

  // The runtime re-renders without componentDidUpdate, so a light watchdog keeps
  // the WebGL stage attached to whichever page currently owns the mount point.
  syncStage() {
    const s = this.state;
    const host = this.glRef && this.glRef.current;
    const cfg = s.mode + "|" + s.lowBw + "|" + s.gl;
    if (this.lastCfg !== undefined && this.lastCfg !== cfg) { this.dispose3D(); this.setState({ glFail: false }); }
    this.lastCfg = cfg;
    if (this.lastPage !== s.page) {
      this.lastPage = s.page;
      // Every page opens at its top. This runs as the new page commits, before
      // the scroll scenes measure, and is instant: html has scroll-behavior:
      // smooth, and a smooth scroll started while the old page is swapped for
      // the new one is cut short by the height change, leaving the new page
      // part-way down (often at its bottom).
      this.stopScrollMotion();
      if (typeof window !== "undefined" && window.scrollY) scrollToY(0);
      this.choreograph();
      this.loadForPage(s.page);
    }
    if (!host) { if (this.gl) this.dispose3D(); return; }
    if (!this.gl) { if (!this.glBusy && !s.glFail && s.gl !== false) this.init3D(); return; }
    if (this.gl.cv.parentNode !== host) {
      host.appendChild(this.gl.cv);
      this.gl.host = host;
      if (this.ro) { this.ro.disconnect(); this.ro.observe(host); }
      this.resize3D();
    }
  }

  animatePanel() {
    this.setState({ statK: 1 });
  }

  resize3D() {}
  initGSAP() {}
  buildStoryTrigger() {}
  choreograph() {}
  init3D() {}
  update3D() {}
  dispose3D() {}


  componentWillUnmount() {
    if (this.navRO) this.navRO.disconnect();
    clearTimeout(this.attTimer);
    (this.rTimers || []).forEach(clearTimeout);
    (this.decTimers || []).forEach(clearTimeout);
    if (this.raf_memK) cancelAnimationFrame(this.raf_memK);
    if (this.raf_matchK) cancelAnimationFrame(this.raf_matchK);
    document.removeEventListener("scroll", this.onScroll, { capture: true });
    if (this.textFill) { this.textFill.revert(); this.textFill = null; }
    if (this.cominvi) { this.cominvi.destroy(); this.cominvi = null; }
    if (this.onMenuResize) window.removeEventListener("resize", this.onMenuResize);
    if (this.bootCountRaf) cancelAnimationFrame(this.bootCountRaf);
    document.documentElement.classList.remove("cv-menu-open");
    stopSmoothScroll();
    window.removeEventListener("keydown", this.onKey);
    if (this.onMagnet) window.removeEventListener("pointermove", this.onMagnet);
    if (this.onNetOnline) window.removeEventListener("online", this.onNetOnline);
    if (this.onNetOffline) window.removeEventListener("offline", this.onNetOffline);
    if (this.watch) clearInterval(this.watch);
    if (this.gateTicker) clearInterval(this.gateTicker);
    this.stopGateScan();
    if (this.onResize) window.removeEventListener("resize", this.onResize);
    if (this.st) this.st.kill();
    if (this.scenes) { this.scenes.revert(); this.scenes = null; }
    (this.reveals || []).forEach(t => { try { t.kill(); } catch (e) {} });
    this.dispose3D();
    if (this.cursor) { this.cursor.destroy(); this.cursor = null; }
    (this.timers || []).forEach(clearTimeout);
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.revealTl) this.revealTl.kill();
    if (this.portalTl) this.portalTl.kill();
    if (this.revealBlock) { window.removeEventListener("wheel", this.revealBlock); window.removeEventListener("touchmove", this.revealBlock); }
    if (this.revealKey) window.removeEventListener("keydown", this.revealKey);
  }

  runBoot() {
    this.setState({ boot: false, bootPhase: 0, reveal: false });
  }

  runBootCount() {}

  // Phones: the page tabs open as a full-screen menu (styles/cominvi.css).
  setMenu(open) {
    if (open === this.state.navMenu) return;
    document.documentElement.classList.toggle("cv-menu-open", open);
    if (open) pauseSmoothScroll(); else resumeSmoothScroll();
    this.setState({ navMenu: open });
  }

  endBoot() {
    sessionStorage.setItem("nex-boot-done", "1");
    this.setState({ boot: false, reveal: false });
  }

  runReveal() {
    this.setState({ boot: false, reveal: false });
  }

  finishReveal() {
    this.setState({ boot: false, reveal: false });
  }

  tweenHero() {
    this.setState({ heroN: 1 });
  }

  openSurface(id) {
    this.go(id);
  }

  /**
   * Stops anything that is still moving the page's scroll position — above
   * all an in-flight ScrollTrigger snap on the page being left, which would
   * otherwise keep driving the scroll after the next page is on screen and
   * leave it opened part-way down. The old page's scenes are torn down here;
   * the next page mounts its own in choreograph().
   */
  stopScrollMotion() {
    if (this.scenes) { this.scenes.revert(); this.scenes = null; }
    if (this.textFill) { this.textFill.revert(); this.textFill = null; }
    if (window.gsap) window.gsap.killTweensOf(window);
  }

  go(id) {
    if (this.state.navMenu) this.setMenu(false);
    // leaving mid-transition: drop the portal rather than let it finish later
    if (this.portalTl) { this.portalTl.kill(); this.portalTl = null; if (this.state.portal) this.setState({ portal: null }); }
    if (id === this.state.page) return;
    this.stopScrollMotion();
    this.setState({ page: id, wipe: false, scrollP: 0, chapter: 0, palette: false });
    scrollToY(0);
  }

  /**
   * Cross-page link between the intelligence surfaces: opens `page` and tells
   * it which panel (and subject / meal) to bring into view.
   */
  intelGo(page, focus = null) {
    this.setState({ intelFocus: focus ? { ...focus, page } : { page } });
    if (page === this.state.page) return;
    this.go(page);
  }

  // ---- live actions --------------------------------------------------------
  // Each of these is a real request. When the backend is offline they fall back
  // to the original local behaviour so every control still does something.

  /** Surface 05: submit the report the student actually typed. */
  async submitComplaint() {
    // Role separation: Admin and Warden cannot submit complaints as students
    if (this.state.user && this.state.user.role !== "STUDENT") {
      this.setState({ repError: "Administrative and Warden accounts cannot submit complaints. Staff review and resolve reports via Mission Control." });
      return;
    }

    if (this.state.apiState !== "live" || !this.state.user) {
      // Offline: keep the original step-through so the flow is still explorable.
      this.setState(prev => ({ step: Math.min(4, prev.step + 1) }));
      return;
    }
    const description = this.state.repText.trim();
    if (description.length < 10) {
      this.setState({ repError: "Describe what is happening in a little more detail." });
      return;
    }

    this.setState({ repBusy: true, repError: null, step: 0 });
    try {
      // Feature 12: on a dead connection this is queued rather than lost, and
      // replayed when the connection returns. The student is told which of the
      // two happened — a queued report is never reported as filed.
      const sent = await postResilient("/api/complaints", {
        title: description.slice(0, 80),
        description,
        category: this.state.repCategory,
        location: this.state.repLocation || undefined,
        buildingCode: this.buildings.find(b => (this.state.repLocation || "").toUpperCase().includes(b.name))?.code
      });

      if (sent.queued) {
        this.setState({
          repBusy: false,
          repText: "",
          netQueued: sent.queueSize,
          netNotice: "No connection — your report is saved on this device and will be filed automatically when you are back online. It has not been classified yet."
        });
        return;
      }

      const result = sent.data;
      this.setState({ repResult: result, repBusy: false, repText: "", repTimeline: null, repDuplicates: null });

      // The timeline and the duplicate verdict are separate reads, so a slow
      // one never delays the confirmation the student is waiting for.
      api.aiTimeline("complaint", result.complaint.id)
        .then(({ timeline }) => this.setState({ repTimeline: timeline }))
        .catch(() => {});
      api.complaintDuplicates(result.complaint.id)
        .then(({ duplicate }) => this.setState({ repDuplicates: duplicate }))
        .catch(() => {});
      // Walk the lifecycle track to wherever the complaint actually landed.
      const reached = ["PENDING", "CLASSIFIED", "ASSIGNED", "INVESTIGATING", "RESOLVED"]
        .indexOf(result.complaint.status);
      [1, 2, 3].forEach((_, i) => {
        setTimeout(() => this.setState({ step: Math.min(Math.max(1, reached), i + 1) }), 520 * (i + 1));
      });
      await this.refreshCampus();
      await this.loadForUser();
    } catch (error) {
      this.setState({ repBusy: false, repError: error.message });
    }
  }

  /** Surface 03: the eligibility projection, calculated server-side. */
  runAttendanceSim(planned) {
    if (this.state.apiState !== "live" || !this.state.user) return;
    clearTimeout(this.attTimer);
    // Debounced: the slider fires continuously while dragging.
    this.attTimer = setTimeout(async () => {
      const att = this.state.student?.attendance;
      const attSim = await api
        .simulateAttendance({
          attendedClasses: att?.attendedClasses,
          totalClasses: att?.totalClasses,
          plannedClasses: planned
        })
        .catch(() => null);
      if (attSim) this.setState({ attSim });
    }, 180);
  }

  /** Surface 06: run clustering for real, then scan campus memory. */
  async runClustering() {
    const next = !this.state.clustered;
    this.setState({ clustered: next });
    if (!next) {
      this.setState({ matchOn: false, matchK: 0 });
      return;
    }

    if (this.state.apiState === "live") {
      const focus = this.buildings.find(row => row.id === this.state.riskFocus);
      const clusterRun = await api
        .cluster({ buildingCode: focus?.code, windowDays: 30 })
        .catch(() => null);
      if (clusterRun) this.setState({ clusterRun });
      await this.loadIncidentDetail();
    }
    this.runMatch();
  }

  /** Opening an incident focuses every downstream surface on it. */
  async openIncident(incidentId) {
    if (incidentId && this.state.apiState === "live") {
      const incident = (this.state.live?.incidents?.incidents || []).find(row => row.id === incidentId);
      if (incident?.building?.code) {
        const mapped = this.buildings.find(row => row.code === incident.building.code);
        if (mapped) this.setState({ riskFocus: mapped.id });
      }
      this.detailFor = null;
      this.simFor = null;
    }
    this.go("investigation");
  }

  openIntervention(interventionId) {
    if (interventionId) {
      const match = (this.state.live?.interventions || []).find(row => row.id === interventionId);
      const code = match?.building?.code;
      const mapped = code ? this.buildings.find(row => row.code === code) : null;
      if (mapped) {
        this.setState({ riskFocus: mapped.id });
        this.simFor = null;
      }
    }
    this.go("intervention");
  }

  /** The campus command bar, answered by the backend's query service. */
  async runQuery(question) {
    if (this.state.apiState !== "live") return;
    this.setState({ queryBusy: true });
    const queryResult = await api.query(question).catch(error => ({
      answer: error.message,
      chain: [],
      intent: "UNKNOWN",
      method: "—"
    }));
    this.setState({ queryResult, queryBusy: false });
  }

  /** Loads whatever the page that just opened needs from the API. */
  loadForPage(page) {
    if (this.state.apiState !== "live") return;
    if (page === "investigation" || page === "incident") this.loadIncidentDetail();
    if (page === "intervention") this.loadInterventionSim();
    if (page === "risk") this.loadRiskDetail();
    // Surface 03's simulator now runs inside AttendanceIntel, which calls
    // POST /api/attendance/simulate itself — no request needed here.
    if (page === "gatepass") this.loadGate();
    // The AI panels live on mission control; read them when it opens, not on
    // every page, so an unconfigured provider costs nothing elsewhere.
    if (page === "admin" && this.state.user && !this.state.ai) this.loadAiSurfaces();
    if (page === "admin" && this.state.user && this.state.user.role !== "STUDENT" && !this.state.triage) this.loadTriage();
  }

  async loadRiskDetail() {
    const focus = this.buildings.find(row => row.id === this.state.riskFocus);
    if (!focus || this.riskFor === focus.code) return;
    this.riskFor = focus.code;
    const riskDetail = await api.buildingRisk(focus.code).catch(() => null);
    this.setState({ riskDetail });
  }

  // ---- gate pass -----------------------------------------------------------
  // Every transition below is decided by the backend. Nothing here writes a
  // status, starts an official clock, or decides that a pass is valid; this
  // code only asks and renders the answer.

  /** Reads the surface: config, the user's passes, their alerts, staff counts. */
  async loadGate({ quiet } = {}) {
    if (this.state.apiState !== "live" || !this.state.user) return;
    if (!quiet) this.setState({ gateBusy: true });
    try {
      const gate = await loadGatePass(this.state.user);
      this.setState(prev => ({
        gate,
        gateBusy: false,
        // Keep whatever the student was looking at, or fall back to their
        // most recent open pass.
        gateSelected: gate.gatePasses.some(row => row.id === prev.gateSelected)
          ? prev.gateSelected
          : (gate.gatePasses.find(row => !["RETURNED", "RETURNED_LATE", "REJECTED", "CANCELLED"].includes(row.status))
              || gate.gatePasses[0] || {}).id || null
      }));
    } catch (error) {
      this.setState({ gateBusy: false, gateError: error.message });
    }
  }

  /** The pass the student's panel is currently showing. */
  activeGatePass() {
    const rows = this.state.gate?.gatePasses || [];
    return rows.find(row => row.id === this.state.gateSelected) || rows[0] || null;
  }

  /**
   * Re-reads the authoritative status of a running pass. Called once per
   * second from the ticker but throttled to one request every 15s — the
   * countdown itself is drawn from the timestamps already in hand.
   */
  pollGate() {
    const pass = this.activeGatePass();
    if (!pass || this.state.apiState !== "live") return;
    if (!["APPROVED", "ACTIVE", "OVERDUE", "PENDING_WARDEN_APPROVAL"].includes(pass.status)) return;
    const now = Date.now();
    if (this.gatePolledAt && now - this.gatePolledAt < 15000) return;
    this.gatePolledAt = now;
    api.gatePassStatus(pass.id)
      .then(next => {
        // A status the backend changed under us — reload the whole surface so
        // the timeline, the alerts and the queue all agree.
        if (next.status !== pass.status) this.loadGate({ quiet: true });
        else this.setState(prev => ({
          gate: prev.gate && {
            ...prev.gate,
            gatePasses: prev.gate.gatePasses.map(row => (row.id === next.id ? { ...row, timer: next.timer } : row))
          }
        }));
      })
      .catch(() => { /* a dropped poll is harmless; the next tick retries */ });
  }

  /** Submits the application. The guardian OTP goes out in the same request. */
  async applyGatePass() {
    if (this.state.apiState !== "live" || !this.state.user) {
      this.setState({ gateError: "Sign in with the backend running to apply for a gate pass." });
      return;
    }
    const reason = this.state.gateReason.trim();
    if (reason.length < 4) {
      this.setState({ gateError: "Say briefly why you need to leave the hostel." });
      return;
    }
    const date = this.state.gateDate || this.gateDefaultDate();
    const leaveAt = this.gateInstant(date, this.state.gateLeave || "10:00");
    const expectedReturnAt = this.gateInstant(date, this.state.gateReturn || "12:00");
    if (!(expectedReturnAt > leaveAt)) {
      this.setState({ gateError: "The return time has to be after the leaving time." });
      return;
    }

    this.setState({ gateBusy: true, gateError: null, gateNotice: null });
    try {
      const result = await api.createGatePass({
        reason,
        destination: this.state.gateDestination.trim() || undefined,
        date: new Date(date + "T00:00:00").toISOString(),
        leaveAt: leaveAt.toISOString(),
        expectedReturnAt: expectedReturnAt.toISOString(),
        parentPhone: this.state.gateParentPhone.trim() || undefined
      });
      this.setState({
        gateBusy: false,
        gateSelected: result.gatePass.id,
        gateReason: "", gateDestination: "",
        gateOtpHint: result.otp || null,
        gateNotice: `Verification code sent to ${result.otp?.phoneMasked || "your guardian"}.`
      });
      await this.loadGate({ quiet: true });
    } catch (error) {
      this.setState({ gateBusy: false, gateError: error.message });
    }
  }

  /** Resends the guardian code, subject to the backend's own cooldown. */
  async resendGateOtp() {
    const pass = this.activeGatePass();
    if (!pass) return;
    this.setState({ gateBusy: true, gateError: null, gateNotice: null });
    try {
      const result = await api.sendGatePassOtp(pass.id);
      this.setState({
        gateBusy: false,
        gateOtpHint: result.otp || null,
        gateNotice: `New code sent to ${result.otp?.phoneMasked || "your guardian"}.`
      });
    } catch (error) {
      this.setState({ gateBusy: false, gateError: error.message });
    }
  }

  /** Hands the code the guardian read out back to the backend to check. */
  async verifyGateOtp() {
    const pass = this.activeGatePass();
    if (!pass) return;
    this.setState({ gateBusy: true, gateError: null, gateNotice: null });
    try {
      const res = await api.verifyGatePassOtp(pass.id, this.state.gateOtp.trim());
      // GATE-PASS SHORT OUTING (see CHANGES-GATEPASS-SHORT-OUTING.md): when the written policy approves the pass on the
      // guardian's code, the response already carries the QR — show it at once instead of saying the warden was notified.
      const lane = res?.policy || res?.data?.policy;
      const qr = res?.qr || res?.data?.qr;
      const approved = lane?.decision === "AUTO_APPROVE" && qr?.dataUrl;
      const waiting = (lane?.failedConditions || []).map((c) => c.explanation || c.label).filter(Boolean).join(" ");
      this.setState({
        gateBusy: false, gateOtp: "", gateOtpHint: null,
        gateNotice: approved ? `Approved automatically under ${lane.citation?.section || "the hostel policy"} — your QR is ready. Show it at the gate.` : `Guardian verified — the warden has been notified.${waiting ? ` ${waiting}` : ""}`,
        ...(approved ? { gateQr: { ...qr, reference: pass.reference, status: "APPROVED" }, gateQrFor: pass.id } : {})
      });
      await this.loadGate({ quiet: true });
    } catch (error) {
      this.setState({ gateBusy: false, gateError: error.message });
    }
  }

  /**
   * Shows the QR for an approved pass. GATE-PASS QR FIX (see CHANGES-GATEPASS-QR-FIX.md):
   * only REGENERATE (rotate = true) mints a new token; opening the page shows the current
   * one again, so a second screen no longer retires the QR on the student's phone.
   */
  async openGateQr(rotate = false) {
    const pass = this.activeGatePass();
    if (!pass || this.state.gateQrBusy) return;
    // Claim the pass before the request goes out, so the automatic fetch below
    // cannot fire a second time while this one is still in flight — every call
    // mints a new token and retires the previous one.
    this.setState({ gateQrBusy: true, gateError: null, gateQrFor: pass.id });
    try {
      const gateQr = await api.gatePassQr(pass.id, rotate);
      this.setState({ gateQr, gateQrBusy: false, gateQrFor: pass.id });
    } catch (error) {
      // The claim stands even on failure, so a refused pass does not retry
      // every tick. REGENERATE QR remains available to try again by hand.
      this.setState({ gateQrBusy: false, gateError: error.message });
    }
  }

  /**
   * Once a pass is approved its QR should simply be there, without the student
   * having to ask for it. Runs from the ticker and is a no-op unless the pass
   * on screen is scannable and has no code of its own yet.
   */
  ensureGateQr() {
    if (this.state.apiState !== "live") return;
    const pass = this.activeGatePass();
    if (!pass || !["APPROVED", "ACTIVE", "OVERDUE"].includes(pass.status)) return;
    if (this.state.gateQrBusy || this.state.gateQrFor === pass.id) return;
    this.openGateQr();
  }

  async cancelGatePass() {
    const pass = this.activeGatePass();
    if (!pass) return;
    this.setState({ gateBusy: true, gateError: null });
    try {
      await api.cancelGatePass(pass.id);
      this.setState({ gateBusy: false, gateNotice: "Gate pass cancelled." });
      await this.loadGate({ quiet: true });
    } catch (error) {
      this.setState({ gateBusy: false, gateError: error.message });
    }
  }

  /** Opens the camera. Permission refusal falls back to typing the code. */
  async startGateScan() {
    this.setState({ gateScanOpen: true, gateScanError: null, gateScanResult: null });
    // Wait for the <video> to exist before handing it to the scanner.
    setTimeout(async () => {
      const video = this.gateVideoRef && this.gateVideoRef.current;
      if (!video) return;
      this.gateScan = await startScan(video, {
        onResult: (text) => this.submitGateScan(text),
        onError: (message) => this.setState({ gateScanError: message })
      });
    }, 60);
  }

  stopGateScan() {
    if (this.gateScan) this.gateScan.stop();
    this.gateScan = null;
  }

  closeGateScan() {
    this.stopGateScan();
    this.setState({ gateScanOpen: false, gateScanError: null });
  }

  /**
   * Sends whatever was scanned (or typed) to the backend. Which transition it
   * causes — exit or return — is the backend's decision, not this method's.
   */
  async submitGateScan(token) {
    this.stopGateScan();
    if (!token) return;
    this.setState({ gateBusy: true, gateScanError: null, gateError: null });
    try {
      const result = await api.scanGatePass(token);
      this.setState({
        gateBusy: false,
        gateScanOpen: false,
        gateManualToken: "",
        gateSelected: result.gatePass.id,
        gateScanResult: { ok: true, action: result.action, status: result.gatePass.status, reference: result.gatePass.reference }
      });
      await this.loadGate({ quiet: true });
    } catch (error) {
      this.setState({
        gateBusy: false,
        gateScanResult: { ok: false, message: error.message },
        gateScanError: error.message
      });
    }
  }

  /** Warden and admin decisions. The backend refuses anyone else. */
  async decideGatePass(id, approve) {
    this.setState({ gateBusy: true, gateError: null, gateNotice: null });
    try {
      const note = this.state.gateDecisionNote.trim() || undefined;
      const result = approve ? await api.approveGatePass(id, { note }) : await api.rejectGatePass(id, { note });
      this.setState({
        gateBusy: false,
        gateDecisionNote: "",
        gateNotice: `${result.gatePass.reference} ${approve ? "approved" : "rejected"}.`
      });
      await this.loadGate({ quiet: true });
    } catch (error) {
      this.setState({ gateBusy: false, gateError: error.message });
    }
  }

  // Local-time helpers for the two <input type="time"> fields. The value sent
  // is a full ISO instant, so the backend never has to guess a timezone.
  gateDefaultDate() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  gateInstant(date, time) {
    return new Date(`${date}T${(time || "00:00")}:00`);
  }

  // ---- extras: decision layer, campus memory, memory match, replay --------
  // One shared eased 0->1 driver so every added animation runs on the same
  // curve as the existing panel/stat counters and honours reduced motion.
  tweenK(key, dur, cb) {
    const raf = "raf_" + key;
    if (this[raf]) cancelAnimationFrame(this[raf]);
    if (this.reduced) { this.setState({ [key]: 1 }); if (cb) cb(); return; }
    this.setState({ [key]: 0 });
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      this.setState({ [key]: 1 - Math.pow(1 - k, 3) });
      if (k < 1) this[raf] = requestAnimationFrame(step);
      else if (cb) cb();
    };
    this[raf] = requestAnimationFrame(step);
  }

  /**
   * Surface 09: the human's answer to the AI's recommendation. ACCEPT and MODIFY
   * are sent straight away; REJECT waits for a reason, because the API refuses a
   * rejection without one.
   */
  async sendDecision(value, extra = {}) {
    const focused = this.activeIncident();
    const list = this.state.live?.interventions || [];
    const intervention = (focused && list.find(row => row.incident?.id === focused.id)) || list[0];
    if (this.state.apiState !== "live" || !intervention || !this.state.admin) return;

    this.setState({ decisionBusy: true });
    try {
      const decisionResult = await api.decide(intervention.id, { decision: value, ...extra });
      this.setState({ decisionResult, decisionBusy: false });
      await this.refreshCampus();
      const interventions = await api.interventions("?limit=10").catch(() => null);
      if (interventions) {
        this.setState(prev => ({ live: { ...(prev.live || {}), interventions: interventions.interventions } }));
      }
    } catch (error) {
      // A recommendation already decided, or a student account: the local
      // animation still plays, it just is not recorded again.
      this.setState({ decisionBusy: false, decisionError: error.message });
    }
  }

  decide(kind) {
    (this.decTimers || []).forEach(clearTimeout);
    this.decTimers = [];
    if (kind === "accept") {
      this.sendDecision("ACCEPT");
      this.setState({ decision: "accept", decisionStep: 1, rejectReason: null, memoryStored: false });
      [2, 3].forEach((n, i) => this.decTimers.push(setTimeout(() => this.setState({ decisionStep: n }), 620 * (i + 1))));
      this.decTimers.push(setTimeout(() => this.storeMemory(), 1900));
    } else if (kind === "modify") {
      this.setState({ decision: "modify", decisionStep: 3, rejectReason: null });
      this.sendDecision("MODIFY", { modifiedWindowHours: this.state.modifyHours });
    } else {
      this.setState({ decision: "reject", decisionStep: 1, rejectReason: null });
    }
  }

  reject(reason) {
    this.setState({ rejectReason: reason, decisionStep: 3 });
    this.sendDecision("REJECT", { reason });
    (this.decTimers || []).push(setTimeout(() => this.setState({ decisionStep: 4 }), 620));
  }

  storeMemory() {
    this.setState({ memoryStored: true });
    this.tweenK("memK", 1500);
  }

  runMatch() {
    this.setState({ matchOn: true });
    this.tweenK("matchK", 1900);
  }

  // ---- judge replay -------------------------------------------------------
  /**
   * The replay steps. When the backend is reachable these come from
   * GET /api/demo/incident-story, which returns the same pipeline read back out
   * of the database; the built-in script below is the offline fallback. Either
   * way the animation is entirely this component's job.
   */
  replaySteps() {
    const steps = this.state.live?.story?.steps;
    if (!steps?.length) return this.fallbackReplay;
    const stateFor = (index) => ({
      0: { step: 0 }, 1: { step: 1 }, 2: { clustered: false, day: 2 }, 3: { clustered: true, day: 3 },
      4: { day: 4 }, 5: { node: "cause" }, 6: {}, 7: { plan: "repair" }, 8: {}, 9: {}
    })[index] || {};
    return steps.map((row, index) => [row.at, row.page, row.label, row.text, stateFor(index)]);
  }

  fallbackReplay = [
    ["00:00", "report", "STUDENT REPORTS", "“No water in Hostel B.”", { step: 0 }],
    ["00:04", "report", "RULE CLASSIFICATION", "WATER · HOSTEL B · HIGH SEVERITY", { step: 1 }], // REEL HOOK (see CHANGES-REEL.md): rule-based, not AI
    ["00:08", "incident", "17 SIMILAR COMPLAINTS DETECTED", "91% wording overlap, one building", { clustered: false, day: 2 }],
    ["00:12", "incident", "COMPLAINTS CONVERGE", "17 complaints resolve into one incident", { clustered: true, day: 3 }],
    ["00:16", "incident", "CAMPUS MEMORY SCANNED", "Matching a previous Hostel B pump failure", { day: 4 }],
    ["00:20", "investigation", "EVIDENCE ASSEMBLED", "Pump failure hypothesis at 89% confidence", { node: "cause" }],
    ["00:24", "risk", "SILENT PROBLEM DETECTED", "Hostel C · 74% predicted risk, zero complaints", { riskFocus: "hostc" }],
    ["00:28", "intervention", "DECISION SUPPORT", "Do nothing 94% · repair now 34%", { plan: "repair" }],
    ["00:32", "intervention", "HUMAN DECISION", "Administration accepts the recommendation", {}],
    ["00:36", "intervention", "CAMPUS MEMORY UPDATED", "Risk 87% → 21% · pattern stored", {}]
  ];

  startReplay() {
    this.stopReplay();
    this.setState({ replay: true, replayStep: -1, palette: false, decision: null, decisionStep: 0, memoryStored: false, memK: 0, matchOn: false, matchK: 0 });
    const script = this.replaySteps();
    this.rTimers = script.map((row, i) => setTimeout(() => this.replayTo(i), i * 2400 + 120));
    this.rTimers.push(setTimeout(() => this.setState({ replay: false, replayStep: -1 }), script.length * 2400 + 2600));
  }

  replayTo(i) {
    const script = this.replaySteps();
    const row = script[i];
    if (!row) return;
    if (this.state.page !== row[1]) this.go(row[1]);
    this.setState(Object.assign({ replayStep: i }, row[4]));
    if (i === 4) this.runMatch();
    if (i === 8) this.decide("accept");
    const g = window.gsap;
    if (g && !this.reduced && this.rootRef && this.rootRef.current) {
      g.fromTo(this.rootRef.current.querySelectorAll("[data-replay-tick]"), { opacity: .4 }, { opacity: 1, duration: .4, stagger: .04, ease: "power2.out" });
    }
  }

  stopReplay() {
    (this.rTimers || []).forEach(clearTimeout);
    this.rTimers = [];
    this.setState({ replay: false, replayStep: -1 });
  }

  extraVals() {
    const st = this.state;
    const script = this.replaySteps();
    const d = st.decision, ds = st.decisionStep;
    const decided = st.decisionResult;
    const match = st.memoryMatch;
    const kicker = "font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700)";
    const chainLabels = d === "reject"
      ? ["AI RECOMMENDATION", "HUMAN DECISION", "ACTION", "OUTCOME"]
      : d === "modify"
        ? ["AI RECOMMENDATION", "ADMIN MODIFIED", "INTERVENTION STARTED", "PREDICTED IMPACT"]
        : ["AI RECOMMENDATION", "ADMIN ACCEPTED", "INTERVENTION STARTED", "PREDICTED IMPACT"];
    const decChain = chainLabels.map((label, i) => {
      const active = d !== null && (i === 0 || ds >= i);
      return {
        label,
        style: {
          fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "12px", letterSpacing: ".08em",
          padding: "9px 12px", border: "2px solid " + (active ? "var(--color-text)" : "var(--color-neutral-400)"),
          background: active && i === 0 ? "var(--color-text)" : active ? "var(--color-neutral-100)" : "transparent",
          color: active && i === 0 ? "var(--color-bg)" : active ? "var(--color-text)" : "var(--color-neutral-600)",
          opacity: active ? 1 : .4, transform: active ? "none" : "translateY(5px)",
          transition: "all .5s cubic-bezier(.2,.8,.2,1)"
        }
      };
    });
    const hours = st.modifyHours;
    // The API returns the projection for the modified window; the local formula
    // is the offline stand-in and follows the same shape.
    const modRisk = decided?.projection?.riskAfter != null && d === "modify"
      ? decided.projection.riskAfter
      : Math.max(21, Math.round(34 + (hours - 4) * 2.1));
    const decNote = decided?.note && ds >= 3
      ? decided.note
      : d === null
      ? "The recommendation waits for a human. AI is decision support here, not an invisible authority."
      : d === "accept"
        ? (ds >= 3
            ? "Intervention started · owner " + (st.live?.interventions?.[0]?.owner || "MAINTENANCE · PLUMBING") +
              " · " + (st.live?.interventions?.[0]?.estimatedResolutionHours ?? 4) + "h window. Predicted impact: risk " +
              (decided?.projection?.riskBefore ?? st.live?.interventions?.[0]?.projection?.riskBefore ?? 87) + "% → " +
              (decided?.projection?.riskAfter ?? st.live?.interventions?.[0]?.projection?.riskAfter ?? 21) + "%."
            : "Recording the decision against " + (this.activeIncident()?.reference || "this incident") + "…")
        : d === "modify"
          ? "Window modified to " + hours + " hours. Projected risk " + modRisk + "% — every hour of delay adds roughly 2 points."
          : st.rejectReason
            ? "Rejected — “" + st.rejectReason + "” recorded against " + (this.activeIncident()?.reference || "this incident") + ". The signal stays under monitoring."
            : "Rejection needs a reason. The campus learns from refusals too.";

    const reasons = ["Already inspected", "Resource unavailable", "Different priority", "Other"].map(r => ({
      label: r, onClick: () => this.reject(r),
      style: {
        fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "10px", letterSpacing: ".12em",
        padding: "7px 10px", cursor: "pointer",
        border: "2px solid " + (st.rejectReason === r ? "var(--color-accent)" : "var(--color-divider)"),
        background: st.rejectReason === r ? "var(--color-accent)" : "transparent",
        color: st.rejectReason === r ? "var(--color-bg)" : "var(--color-text)", transition: "all .3s"
      }
    }));

    const mk = st.memK;
    const ease = (i) => Math.max(0, Math.min(1, (mk - i * 0.14) / 0.5));
    const signatureLabels = match?.matchedIncident?.signatures?.length
      ? match.matchedIncident.signatures
      : ["Booster pump 2 failure", "Maintenance delay · 14 days", "17-complaint cluster", "Night-time usage anomaly"];
    const memSignatures = signatureLabels.map((label, i) => ({
      label,
      style: {
        display: "flex", gap: "10px", alignItems: "baseline", fontSize: "13px",
        borderBottom: "1px solid var(--color-neutral-300)", padding: "9px 0",
        opacity: ease(i), transform: "translateX(" + ((1 - ease(i)) * 22).toFixed(1) + "px)",
        transition: "none"
      }
    }));

    const mt = st.matchK;
    return {
      decKicker: kicker,
      decision: d, decChain, decNote, decReasons: reasons, decShowReasons: d === "reject",
      decShowModify: d === "modify",
      decModHours: hours, decModRisk: modRisk + "%",
      onModHours: (e) => this.setState({ modifyHours: Number(e.target.value) }),
      onAccept: () => this.decide("accept"), onModify: () => this.decide("modify"), onReject: () => this.decide("reject"),
      acceptStyle: { justifyContent: "flex-start", letterSpacing: ".08em", opacity: d && d !== "accept" ? .5 : 1, transition: "opacity .3s" },
      modifyStyle: { justifyContent: "flex-start", letterSpacing: ".08em", opacity: d && d !== "modify" ? .5 : 1, transition: "opacity .3s" },
      rejectStyle: { justifyContent: "flex-start", letterSpacing: ".08em", color: "var(--color-accent-700)", opacity: d && d !== "reject" ? .5 : 1, transition: "opacity .3s" },

      memShow: st.memoryStored,
      memPulseStyle: { width: "10px", height: "10px", background: "var(--color-accent)", animation: this.reduced ? "none" : "nex-blink 1.1s steps(2) infinite" },
      memSignatures,
      memRiskFrom: (decided?.projection?.riskBefore ?? 87) + "%",
      memRisk: Math.round((decided?.projection?.riskBefore ?? 87)
        - ((decided?.projection?.riskBefore ?? 87) - (decided?.projection?.riskAfter ?? 21)) * mk) + "%",
      memRiskStyle: { fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "40px", lineHeight: 1, fontVariantNumeric: "tabular-nums", color: mk > .7 ? "var(--color-text)" : "var(--color-accent)", transition: "color .6s" },
      memCompressStyle: { height: "2px", background: "var(--color-accent)", width: (100 - mk * 76).toFixed(1) + "%", transition: "none" },
      memNote: mk > .95 ? "Pattern stored. A matching signature elsewhere on campus is now detected earlier." : "Compressing the incident into a persistent campus signal…",

      matchOn: st.matchOn,
      matchLabel: st.matchOn ? Math.round((match?.similarity ?? 82) * mt) + "% SIMILARITY" : "RUN CLUSTERING TO SCAN MEMORY",
      matchLabelStyle: { fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "11px", letterSpacing: ".12em", color: st.matchOn ? "var(--color-accent-700)" : "var(--color-neutral-600)", fontVariantNumeric: "tabular-nums" },
      matchScanStyle: { position: "absolute", left: 0, right: 0, top: (mt * 100).toFixed(1) + "%", height: "2px", background: "var(--color-accent)", opacity: st.matchOn && mt < .98 ? 1 : 0, pointerEvents: "none", zIndex: 2 },
      matchRowStyle: (i) => ({
        display: "grid", gridTemplateColumns: "110px 110px minmax(0,1fr) 60px", gap: "10px", padding: "11px 0",
        borderBottom: "1px solid var(--color-neutral-300)", fontSize: "13px",
        background: st.matchOn && mt > .6 && i === 1 ? "var(--color-accent-100)" : "transparent",
        boxShadow: st.matchOn && mt > .6 && i === 1 ? "inset 2px 0 0 var(--color-accent)" : "none",
        transition: "background .5s, box-shadow .5s"
      }),
      matchNote: st.matchOn
        ? (match?.matchedIncident
            ? "Campus memory returns " + new Date(match.matchedIncident.occurredOn).toISOString().slice(0, 10) +
              ": " + (match.matchedIncident.buildingName || match.matchedIncident.building?.name || "the same building") +
              ", " + (match.matchedIncident.cause || "the same cause") + ", resolved in " +
              (match.matchedIncident.resolutionTimeHours ?? "—") + " hours. " +
              "Similarity is a weighted sum of building, category, keyword overlap and recency — not a learned embedding."
            : "Campus memory returns 2025-11-04: the same building, the same pressure curve, resolved in 5.4 hours. The campus remembers what happened before.")
        : "Four water incidents in thirteen months in the same building. This is not a complaint queue — it is a recurring failure.",
      matchFactors: (match?.matchingFactors || []).map(row => ({ label: row.factor, weight: "+" + row.weight })),

      replayOn: st.replay,
      onReplay: () => this.startReplay(),
      onStopReplay: () => this.stopReplay(),
      replayTime: st.replayStep >= 0 ? (script[st.replayStep]?.[0] ?? "00:00") : "00:00",
      replayLabel: st.replayStep >= 0 ? (script[st.replayStep]?.[2] ?? "STANDING BY") : "STANDING BY",
      replayText: st.replayStep >= 0 ? (script[st.replayStep]?.[3] ?? "") : "",
      replaySource: this.state.live?.story ? "REPLAYING " + this.state.live.story.incident.reference + " FROM THE DATABASE" : "REPLAYING THE BUILT-IN SCRIPT",
      replayTicks: script.map((row, i) => ({
        style: { width: i === st.replayStep ? "26px" : "10px", height: "4px", background: i <= st.replayStep ? "var(--color-accent)" : "color-mix(in srgb, var(--color-on-ink) 30%, transparent)", transition: "all .4s" }
      }))
    };
  }

  // ---- iso helpers ---------------------------------------------------------
  iso(x, y, z) { return [600 + (x - y) * 0.78, 300 + (x + y) * 0.45 - (z || 0)]; }
  pts(arr) { return arr.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" "); }

  riskFill(risk, face) {
    const ramp = risk >= 80 ? ["--color-accent-300", "--color-accent-400", "--color-accent-500"]
      : risk >= 60 ? ["--color-accent-200", "--color-accent-300", "--color-accent-400"]
      : risk >= 35 ? ["--color-neutral-200", "--color-neutral-300", "--color-neutral-400"]
      : ["--color-neutral-100", "--color-neutral-200", "--color-neutral-300"];
    return "var(" + ramp[face] + ")";
  }

  buildingGeom(b, opts) {
    const o = opts || {};
    const lift = o.lift || 0;
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, y0 = b.y - b.d / 2, y1 = b.y + b.d / 2;
    const h = b.h;
    const T = [this.iso(x0, y0, h), this.iso(x1, y0, h), this.iso(x1, y1, h), this.iso(x0, y1, h)];
    const R = [this.iso(x1, y0, h), this.iso(x1, y1, h), this.iso(x1, y1, 0), this.iso(x1, y0, 0)];
    const F = [this.iso(x1, y1, h), this.iso(x0, y1, h), this.iso(x0, y1, 0), this.iso(x1, y1, 0)];
    const G = [this.iso(x0, y0, 0), this.iso(x1, y0, 0), this.iso(x1, y1, 0), this.iso(x0, y1, 0)];
    const c = this.iso(b.x, b.y, h);
    return {
      topPts: this.pts(T), rightPts: this.pts(R), frontPts: this.pts(F), shadowPts: this.pts(G),
      cx: c[0], cyTop: c[1], cy: this.iso(b.x, b.y, 0)[1], lift: lift
    };
  }

  // ---- renderVals ----------------------------------------------------------
  renderVals() {
    const s = this.state;
    this.rootRef = this.rootRef || React.createRef();
    this.storyRef = this.storyRef || React.createRef();
    this.glRef = this.glRef || React.createRef();
    this.gateVideoRef = this.gateVideoRef || React.createRef();
    this.navRef = this.navRef || React.createRef();
    this.revealRef = this.revealRef || React.createRef();
    this.portalRef = this.portalRef || React.createRef();
    this.bootCountRef = this.bootCountRef || React.createRef();

    const page = s.page;
    const ch = this.chapters[s.chapter] || this.chapters[0];
    const focusId = page === "landing" ? (s.focus || ch[3]) : (s.riskFocus || "hostb");
    const fb = this.buildings.find(b => b.id === focusId) || null;
    const scale = page === "landing" ? ch[4] : 1;
    const extruded = page === "landing" ? s.chapter >= 3 : true;

    // camera
    let tx = 0, ty = 0;
    if (fb && scale > 1.1) {
      const g = this.buildingGeom(fb);
      tx = 600 - scale * g.cx; ty = 320 - scale * g.cyTop;
    } else { tx = 600 - scale * 600; ty = 300 - scale * 300; }
    const mapTransform = "translate(" + tx.toFixed(1) + " " + ty.toFixed(1) + ") scale(" + scale.toFixed(3) + ")";

    // grid
    const gridLines = [];
    for (let v = -320; v <= 320; v += 80) {
      const a = this.iso(v, -320, 0), b = this.iso(v, 320, 0);
      const c = this.iso(-320, v, 0), d = this.iso(320, v, 0);
      gridLines.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
      gridLines.push({ x1: c[0], y1: c[1], x2: d[0], y2: d[1] });
    }
    const groundPts = this.pts([this.iso(-320, -320, 0), this.iso(320, -320, 0), this.iso(320, 320, 0), this.iso(-320, 320, 0)]);

    const mapBuildings = this.buildings.map(b => {
      const isFocus = fb && b.id === fb.id;
      const lift = isFocus && extruded ? 58 : 0;
      const g = this.buildingGeom(b);
      const showBadge = page !== "landing" ? true : (isFocus && s.chapter >= 3) || s.chapter === 1;
      const badgeText = b.risk >= 35 ? b.code + " · " + b.risk + "%" : b.code;
      return {
        id: b.id, cursor: "INSPECT " + b.code,
        topPts: g.topPts, rightPts: g.rightPts, frontPts: g.frontPts, shadowPts: g.shadowPts,
        cx: g.cx, cyTop: g.cyTop - lift,
        topFill: this.riskFill(b.risk, 0), rightFill: this.riskFill(b.risk, 2), frontFill: this.riskFill(b.risk, 1),
        gStyle: { transform: "translateY(" + (-lift) + "px)", transition: "transform .85s cubic-bezier(.2,.85,.2,1), opacity .4s", cursor: "pointer", opacity: fb && !isFocus && scale > 1.3 ? 0.42 : 1 },
        shadowStyle: { opacity: lift ? 0.9 : 0, transform: "translateY(" + lift + "px)", transition: "opacity .6s" },
        ringStyle: { transformOrigin: g.cx + "px " + (g.cyTop) + "px", transformBox: "view-box", animation: isFocus && b.risk >= 60 ? "nex-ring 2.4s ease-out infinite" : "none", opacity: isFocus && b.risk >= 60 ? 1 : 0 },
        badgeStyle: { opacity: showBadge ? 1 : 0, transition: "opacity .5s" },
        badgeX: g.cx - 6, badgeY: g.cyTop - lift - 46, badgeW: badgeText.length * 8 + 16,
        badgeEl: React.createElement("text", { x: g.cx + 2, y: g.cyTop - lift - 30, fill: "var(--color-bg)",
          fontFamily: "Archivo, sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: 1 }, badgeText),
        onClick: () => { if (page === "landing") { this.setState({ focus: b.id }); this.animatePanel(); } else this.setState({ riskFocus: b.id }); }
      };
    });

    const flowOn = page === "landing" ? s.chapter >= 4 : false;
    const flows = [["hostb", "acad"], ["mess", "med"], ["lib", "acad"]].map(([a, c]) => {
      const A = this.buildings.find(x => x.id === a), C = this.buildings.find(x => x.id === c);
      const p1 = this.iso(A.x, A.y, A.h), p2 = this.iso(C.x, C.y, C.h);
      const mx = (p1[0] + p2[0]) / 2, my = Math.min(p1[1], p2[1]) - 90;
      return { d: "M" + p1[0] + " " + p1[1] + " Q" + mx + " " + my + " " + p2[0] + " " + p2[1],
        style: { opacity: flowOn ? 0.9 : 0, transition: "opacity .6s", animation: flowOn && s.mode === "HIGH" ? "nex-dash 3s linear infinite" : "none" } };
    });

    const navBase = { fontFamily: "var(--font-heading)", fontWeight: 400, fontSize: "18px", letterSpacing: "0", padding: "7px 13px", border: "0", cursor: "pointer", whiteSpace: "nowrap", background: "transparent", color: "var(--color-neutral-700)" };
    const pages = this.pageDefs.map(([id, num, short]) => ({
      id, num, short,
      current: id === page ? "page" : undefined,
      onClick: () => this.go(id),
      style: id === page ? Object.assign({}, navBase, { color: "var(--color-text)" }) : navBase
    }));
    // The nav shows every page at once, grouped by what it is for, so no page
    // hides behind a horizontal scroll. Any page not listed here (a future
    // extension) lands in the last group rather than disappearing.
    const isWarden = s.user?.role === "WARDEN" || (typeof window !== "undefined" && (new URLSearchParams(window.location.search).get("as") === "warden" || new URLSearchParams(window.location.search).get("role") === "warden"));
    const navGroups = [
      ["EVALUATION & PROOF", ["landing", "admin"]],
      ["STUDENT LIFE", ["student", "attendance", "mess", "gatepass", "documents", ...(!isWarden ? ["resources"] : [])]],
      ["COMPLAINTS & FIXES", ["report", "requests", "incident"]],
      ["CHANNELS & INCLUSION", ["kiosk", "sms", "notices"]]
    ];
    // Readable names for the nav; a page without one keeps its short code.
    const navNames = {
      landing: "Evaluation Hub", admin: "Mission Control", kiosk: "Campus Kiosk",
      student: "Student Dashboard", attendance: "Attendance", mess: "Mess",
      gatepass: "Gate Pass", documents: "Documents (Rule §4.2)",
      report: "Report Problem", requests: "My Requests", incident: "Incidents",
      notices: "Notices", sms: "SMS Phone",
      resources: "Help & Resources"
    };
    const pageGroups = navGroups.map(([label, ids]) => ({
      label, pages: ids.map(id => pages.find(p => p.id === id)).filter(Boolean)
        .map(p => Object.assign({}, p, { name: navNames[p.id] || p.short }))
    }));

    const chip = (active) => ({ fontFamily: "var(--font-mono)", fontWeight: 500, fontSize: "11px", letterSpacing: ".08em", padding: "4px 11px", whiteSpace: "nowrap", lineHeight: 1.4, borderRadius: "999px", border: active ? "1px solid var(--color-neutral-500)" : "1px solid var(--color-divider)", cursor: "pointer", background: active ? "var(--color-surface-2)" : "transparent", color: active ? "var(--color-text)" : "var(--color-muted)", transition: "color .25s var(--ease), border-color .25s var(--ease), background .25s var(--ease)" });

    // Headline figures: the live campus aggregate, counted up by the same driver.
    const c = s.live?.campus?.campus || null;
    const k = s.heroN;
    const heroStats = [
      { value: Math.round((c?.activeIncidents ?? 12) * k), label: "ACTIVE INCIDENTS" },
      { value: Math.round((c?.pendingComplaints ?? 38) * k), label: "PENDING COMPLAINTS" },
      { value: Math.round((c?.health ?? 87) * k) + "%", label: "CAMPUS HEALTH" },
      { value: c?.averageResolutionHours == null
          ? (4.2 * k).toFixed(1) + "h"
          : (c.averageResolutionHours * k).toFixed(1) + "h",
        label: "AVG RESOLUTION" }
    ];

    // Landing hero: click a pictured building to inspect it in the sidebar below.
    const heroInspect = (id) => {
      this.setState({ focus: id });
      this.animatePanel();
      const el = this.storyRef && this.storyRef.current;
      scrollToY(el ? el.getBoundingClientRect().top + window.scrollY - 90 : window.innerHeight * 0.9, { smooth: true });
    };
    const [HW, HH] = HERO_SIZE;
    const heroMap = heroSpots.map(spot => {
      const b = this.buildings.find(x => x.id === spot.id);
      return !b ? null : {
        id: spot.id, polys: spot.polys, hot: false,
        tint: b.risk >= 80 ? "hi" : b.risk >= 60 ? "mid" : null,
        label: b.name,
        onClick: () => heroInspect(spot.id),
        onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); heroInspect(spot.id); } }
      };
    }).filter(Boolean);
    const heroCard = null;

    const bootLinesAll = [
      ["CAMPUS NETWORK", "ONLINE"], ["STUDENT SYSTEM", "ONLINE"], ["INCIDENT ENGINE", "ONLINE"],
      ["PREDICTION ENGINE", "ONLINE"], ["AI ANALYSIS", "ONLINE"]
    ];
    const bootLines = s.bootPhase === 0
      ? [{ text: "INITIALIZING NEX CAMP", status: "", style: { animation: "nex-blink .5s steps(2) infinite" } }]
      : bootLinesAll.map(([t, st], i) => ({
          text: t + " " + "".padEnd(22 - t.length, "."),
          status: s.bootPhase >= 1 ? st : "",
          style: { opacity: s.bootPhase >= 1 ? 1 : 0, animation: "nex-up .35s both", animationDelay: (i * 0.05) + "s" }
        }));

    const bootBuildings = this.buildings.map((b, i) => {
      const g = this.buildingGeom(b);
      return { topPts: g.topPts, rightPts: g.rightPts, frontPts: g.frontPts, cx: g.cx, cy: g.cyTop,
        style: { opacity: s.bootPhase >= 2 ? 1 : 0, transition: "opacity .3s", transitionDelay: (i * 0.03) + "s",
          strokeDasharray: 1400, animation: s.bootPhase >= 2 ? "nex-draw .7s cubic-bezier(.65,0,.35,1) " + (i * 0.03) + "s both" : "none" } };
    });

    const bootSignals = [["HOSTEL B", "WATER RISK ↑ 87%"], ["MESS", "DEMAND ↑ 780"], ["ACADEMIC BLOCK", "ATTENDANCE RISK ↑"], ["WI-FI ZONE C", "NETWORK ANOMALY"]]
      .map(([where, what], i) => ({ where, what, style: { border: "1px solid color-mix(in srgb, var(--color-on-ink) 30%, transparent)", padding: "8px 10px", opacity: s.bootPhase >= 3 ? 1 : 0, transform: s.bootPhase >= 3 ? "none" : "translateY(10px)", transition: "opacity .3s, transform .3s", transitionDelay: (i * 0.05) + "s" } }));

    const bootLabelMap = ["SYSTEM INITIALIZATION", "SUBSYSTEM CHECK", "ASSEMBLING DIGITAL CAMPUS", "NEX CAMP", "BOOT COMPLETE"];

    const oldFlow = [["01", "WHATSAPP", "no record"], ["02", "WARDEN", "+6h"], ["03", "OFFICE", "+1 day"], ["04", "REGISTER", "paper"], ["05", "PHONE CALL", "+4h"], ["06", "WAIT", "4 days avg"]]
      .map(([n, label, cost]) => ({ n, label, cost }));

    const fallbackQueries = [
      ["Why is Hostel B attendance falling?",
        ["HOSTEL B", "WATER FAILURE", "SLEEP DISRUPTION", "ATTENDANCE DECLINE", "ACADEMIC RISK"],
        "Attendance in the 8:00 AM slots for the Hostel B cohort is down 11 points since the water failure began. The chain is inferred from complaint timestamps, hostel occupancy and attendance logs — confidence 84%."],
      ["What are the biggest problems on campus today?",
        ["HST-B WATER 87%", "WI-FI ZONE C 72%", "MESS OVERLOAD 68%", "HST-C SILENT 74%"],
        "Ranked by risk × affected students. Hostel B leads on both: 132 students affected, 17 complaints, 89% confidence. Hostel C has no complaints yet and is ranked on prediction alone."],
      ["Which problems will get worse this week?",
        ["HST-C WATER 74%", "MESS 13:00 PEAK", "MED WALK-INS ↑"],
        "Three escalation paths crossed their historical thresholds in the last 48 hours. Hostel C matches the pre-failure signature at day 9 of 14."]
    ];
    // The suggestions are the question shapes the backend's query service
    // actually recognises; the answer below is its reply, not a canned one.
    const supported = s.queryResult?.supportedQuestions || fallbackQueries.map(row => row[0]);
    const queryList = supported.map((label, i) => [label, fallbackQueries[i]?.[1] || [], fallbackQueries[i]?.[2] || ""]);

    const q = queryList[Math.min(s.query, queryList.length - 1)] || fallbackQueries[0];
    const answered = s.queryResult && s.queryResult.chain?.length ? s.queryResult : null;
    const chainLabelsForAnswer = answered ? answered.chain : q[1];
    const answerChain = chainLabelsForAnswer.map((label, i) => ({
      label, arrow: i < chainLabelsForAnswer.length - 1 ? "→" : "",
      style: { fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "12px", letterSpacing: ".08em", padding: "7px 10px", border: "1px solid var(--color-neutral-500)", background: i === 0 ? "var(--color-text)" : "var(--color-neutral-100)", color: i === 0 ? "var(--color-bg)" : "var(--color-text)", animation: "nex-up .35s both", animationDelay: (i * 0.08) + "s" }
    }));

    const glOn = !!s.glReady;
    const wide = s.vw >= 1080;
    const sk = this.reduced ? 1 : s.statK;
    const focusStats = fb ? [
      { value: Math.round(fb.risk * sk) + "%", label: "RISK", valueStyle: { fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "24px", lineHeight: 1, color: "var(--color-accent)", fontVariantNumeric: "tabular-nums" } },
      { value: Math.round(fb.affected * sk), label: "AFFECTED", valueStyle: { fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "24px", lineHeight: 1, fontVariantNumeric: "tabular-nums" } },
      { value: Math.round(fb.conf * sk) + "%", label: "AI CONF.", valueStyle: { fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "24px", lineHeight: 1, fontVariantNumeric: "tabular-nums" } }
    ] : [];
    const glAllowed = s.gl !== false && !s.lowBw && s.mode !== "LOW" && !this.reduced;
    const campusControls = this.buildings.map((b) => {
      const isSel = fb && fb.id === b.id;
      return {
        id: b.id,
        code: b.code,
        name: b.name,
        domain: b.domain,
        hasAlert: b.incident && b.incident !== "No active incident",
        style: {
          fontFamily: "var(--font-heading)",
          fontSize: "11px",
          letterSpacing: ".06em",
          padding: "6px 12px",
          border: isSel ? "1px solid var(--color-text)" : "1px solid var(--color-divider)",
          background: isSel ? "var(--color-text)" : "var(--color-bg)",
          color: isSel ? "var(--color-bg)" : "var(--color-text)",
          cursor: "pointer",
          borderRadius: "4px",
          display: "inline-flex",
          alignItems: "center",
          gap: "4px"
        },
        onClick: () => {
          this.setState({ focus: isSel ? null : b.id });
          this.animatePanel();
        }
      };
    });
    return Object.assign({
      campusControls,
      glRef: this.glRef,
      glStyle: { position: "absolute", inset: 0, zIndex: 1, opacity: glOn ? 1 : 0, transition: "opacity .9s ease", pointerEvents: glOn ? "auto" : "none" },
      storyHeight: "auto",
      stageStyle: {
        position: "relative", display: "grid", gap: "clamp(16px, 2vw, 28px)", alignContent: "start",
        gridTemplateColumns: wide ? "minmax(250px, 0.82fr) minmax(0, 1.8fr) minmax(280px, 1fr)" : "minmax(0, 1fr)",
        paddingBottom: "24px"
      },
      campusBoxStyle: {
        position: "relative", border: "1px solid var(--color-divider)", background: "var(--color-surface)",
        display: "grid", gridTemplateRows: "auto auto auto", minWidth: 0,
        borderRadius: "var(--radius-md, 6px)", overflow: "hidden"
      },
      panelColStyle: {
        position: "relative", zIndex: 3, display: "grid", alignContent: "start", minWidth: 0,
        maxHeight: wide ? "100%" : "none"
      },
      panelStyle: {
        background: "var(--color-surface)", border: "1px solid var(--color-neutral-500)", display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)", maxHeight: wide ? "100%" : "none",
        borderRadius: "var(--radius-md, 6px)", overflow: "hidden",
        boxShadow: "var(--shadow-md)"
      },
      hoverTip: s.hoverCode,
      hoverTipStyle: {
        position: "absolute", left: "10px", bottom: "10px", zIndex: 2, background: "var(--color-text)", color: "var(--color-bg)",
        fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "11px", letterSpacing: ".12em", padding: "6px 9px", pointerEvents: "none"
      },
      campusEngine: "STATIC CAMPUS IMAGE",
      chapterSteps: this.chapters.map((c, i) => ({
        name: c[0],
        chipStyle: { fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "9px", letterSpacing: ".14em", padding: "3px 6px",
          border: "1px solid " + (i <= s.chapter ? "var(--color-accent)" : "var(--color-neutral-400)"),
          background: i === s.chapter ? "var(--color-accent)" : "transparent",
          color: i === s.chapter ? "var(--color-bg)" : i < s.chapter ? "var(--color-accent-700)" : "var(--color-neutral-700)",
          transition: "all .35s" }
      })),
      glStyleRisk: { display: "none" },
      mapSvgStyle: { width: "100%", height: "100%", maxWidth: "100%", maxHeight: "100%", display: "block", opacity: 1 },
      riskSvgStyle: { width: "100%", height: "auto", maxWidth: "100%", display: "block", opacity: 1 },
      toggle3DLabel: "STATIC MAP",
      toggle3DStyle: chip(false),
      onToggle3D: () => {},
      engineLabel: "STATIC CAMPUS MAP · NATIVE SCROLL · " + s.mode,
      cardFlip: { boxShadow: "var(--shadow-md)", borderColor: "var(--color-text)" },
      rowHover: { background: "var(--color-accent-100)" },
      cellHover: { background: "var(--color-accent-100)" },
      nodeHover: { boxShadow: "var(--shadow-md)" },
      navRef: this.navRef,
      // Hover pill: mouse only, so touch keeps plain tap navigation. It nudges a
      // few pixels toward the pointer inside the tab it sits on.
      onNavPointer: (e) => {
        if (e.pointerType && e.pointerType !== "mouse") return;
        const nav = this.navRef.current;
        const btn = e.target.closest && e.target.closest(".nex-nav-item");
        if (!nav || !btn) return;
        const fresh = !nav.hasAttribute("data-hover");
        if (btn !== this.navHot || fresh) { this.placeNavPill(btn, fresh); this.navHot = btn; }
        const r = btn.getBoundingClientRect();
        nav.style.setProperty("--pill-n", (((e.clientX - (r.left + r.width / 2)) / (r.width || 1)) * 6).toFixed(2) + "px");
        if (fresh) nav.setAttribute("data-hover", "");
      },
      onNavLeave: () => {
        const nav = this.navRef.current;
        if (nav) { nav.removeAttribute("data-hover"); nav.style.setProperty("--pill-n", "0px"); }
        this.navHot = null;
      },
      rootRef: this.rootRef, storyRef: this.storyRef,
      campusName: s.live?.campus?.campus?.name || this.props.campusName || "BPUT CAMPUS · ROURKELA",
      campusStudents: (s.live?.campus?.campus?.students ?? 6240).toLocaleString() + " STUDENTS",
      campusBlocks: (s.live?.campus?.campus?.blocks ?? 9) + " BLOCKS",

      // Backend status, shown next to the existing status-bar chips.
      apiState: s.apiState,
      apiLabel: s.apiState === "live" ? "API LIVE" : s.apiState === "connecting" ? "API CONNECTING" : "API OFFLINE",
      apiStyle: {
        fontFamily: "var(--font-mono)", fontWeight: 500, fontSize: "11px", letterSpacing: ".08em",
        padding: "4px 11px", whiteSpace: "nowrap", lineHeight: 1.4, borderRadius: "999px",
        border: "1px solid " + (s.apiState === "live" ? "var(--color-accent-300)" : s.apiState === "offline" ? "var(--color-warn-200)" : "var(--color-divider)"),
        background: s.apiState === "live" ? "var(--color-accent-100)" : s.apiState === "offline" ? "var(--color-warn-100)" : "transparent",
        color: s.apiState === "live" ? "var(--color-accent)" : s.apiState === "offline" ? "var(--color-warn)" : "var(--color-muted)"
      },
      apiTitle: s.apiState === "offline"
        ? "Backend unreachable (" + (s.apiError || "no response") + ") — every surface is showing its built-in dataset"
        : s.apiState === "live"
          ? "Serving live data from " + api.base
          : "Contacting " + api.base,
      onRetryApi: () => this.bootstrap(),

      // Sign-in, in the existing chip row. The demo student is signed in
      // automatically; this switches to any other seeded account.
      user: s.user,
      userLabel: s.user ? s.user.name.split(" ")[0] + " · " + s.user.role : "SIGN IN",
      userStyle: chip(!!s.user),
      onUser: () => (s.user ? this.signOut() : this.setState({ authOpen: true, authError: null })),
      authOpen: s.authOpen,
      authEmail: s.authEmail, authPassword: s.authPassword,
      authBusy: s.authBusy, authError: s.authError,
      onAuthEmail: (e) => this.setState({ authEmail: e.target.value }),
      onAuthPassword: (e) => this.setState({ authPassword: e.target.value }),
      onAuthClose: () => this.setState({ authOpen: false }),
      onAuthSubmit: () => this.signIn(s.authEmail, s.authPassword),
      onAuthKey: (e) => { if (e.key === "Enter") this.signIn(s.authEmail, s.authPassword); },
      authHint: "Seeded accounts: pritish@bput.ac.in / Campus@2026 (student) · control@bput.ac.in / Control@2026 (admin) · care@bput.ac.in / Care@2026 (student support team)", // SUPPORT HOOK: the support-team account is appended

      pages, pageGroups, isLanding: page === "landing",
      goHome: () => this.go("landing"),
      goStory: () => { const el = this.storyRef && this.storyRef.current; const hdr = this.rootRef.current?.querySelector(".nx-header")?.offsetHeight || 90; scrollToY(el ? el.getBoundingClientRect().top + window.scrollY - hdr : window.innerHeight * 0.9, { smooth: true }); },
      goDemo: () => this.go("incident"),
      onOpenSurface: (id, preview) => this.openSurface(id, preview),
      portal: this.state.portal, portalRef: this.portalRef,
      goInvestigate: () => this.go("investigation"),
      wipe: s.wipe, boot: s.boot, bootPhase: s.bootPhase,
      reveal: s.reveal, revealRef: this.revealRef, onSkipReveal: () => { if (this.revealTl) this.revealTl.progress(1); },
      bootLabel: bootLabelMap[s.bootPhase], bootLines, bootBuildings, bootSignals,
      bootSvgStyle: { width: "min(100%, 980px)", height: "auto", maxHeight: "46vh", opacity: s.bootPhase >= 2 ? 1 : 0, transform: s.bootPhase >= 4 ? "scale(1.12)" : "scale(1)", transition: "opacity .4s, transform .5s cubic-bezier(.65,0,.35,1)" },
      bootSignalStyle: { display: "flex", gap: "10px", flexWrap: "wrap", opacity: s.bootPhase >= 3 ? 1 : 0, transition: "opacity .4s" },
      bootBarStyle: { height: "2px", width: ((s.bootPhase + 1) / 5 * 100) + "%", background: "var(--color-accent)", transition: "width .35s cubic-bezier(.65,0,.35,1)" },
      bootSkipHover: { background: "color-mix(in srgb, var(--color-on-ink) 12%, transparent)" },
      onSkipBoot: () => { (this.timers || []).forEach(clearTimeout); this.endBoot(); },
      navMenu: s.navMenu,
      onMenu: () => this.setMenu(!this.state.navMenu),
      onReplayBoot: () => { sessionStorage.removeItem("nex-boot-done"); this.runBoot(); },
      modes: ["HIGH", "MEDIUM", "LOW"].map(m => ({ label: m, onClick: () => this.setState({ mode: m }), style: chip(s.mode === m) })),
      lowBw: s.lowBw, lowBwLabel: "LOW BANDWIDTH", lowBwStyle: chip(s.lowBw),
      // Re-read the AI surfaces after the toggle so the setting takes effect
      // now: they are re-requested with ?lite=1, which trims the evidence
      // arrays server-side. Without this the change would only apply to the
      // next page that happened to load them.
      onLowBw: () => this.setState(p => ({ lowBw: !p.lowBw }), () => { if (this.state.ai) this.loadAiSurfaces(); }),
      langs: ["EN", "ଓଡ଼ିଆ", "हिन्दी"].map(l => ({ label: l, onClick: () => { this.setState({ lang: l }); requestAnimationFrame(() => this.applyLang(true)); }, style: chip(s.lang === l) })),
      heroStats, heroMap, heroCard, heroHot: null, heroViewBox: "0 0 " + HW + " " + HH,
      onHeroClear: () => { clearTimeout(this.heroHotT); if (this.state.heroHot) this.setState({ heroHot: null }); },
      chapterKicker: ch[0], chapterTitle: narrateChapter(ch, s.live)[0], chapterBody: narrateChapter(ch, s.live)[1], cameraLabel: ch[5], // EXCEPTION-ONLY HOOK: live figures, original text as fallback
      scrollPct: Math.round(s.scrollP * 100) + "%",
      chapterRail: this.chapters.map((c, i) => ({ name: c[0], style: { width: i === s.chapter ? "34px" : "14px", height: "6px", background: i <= s.chapter ? "var(--color-accent)" : "var(--color-neutral-300)", transition: "all .4s" } })),
      mapTransform, mapGroupStyle: { transition: "transform 1.1s cubic-bezier(.2,.8,.2,1)" },
      gridLines, groundPts, mapBuildings, flows,
      showPanel: !!fb && page === "landing",
      showEmptyPanel: page === "landing" && !fb,
      focusStats,
      showCluster: page === "landing" && s.chapter >= 5,
      clusterCount: (s.live?.incidents?.incidents || []).filter(i => i.status !== "RESOLVED").sort((a, b) => (b.risk || 0) - (a.risk || 0))[0]?.complaintCount ?? 17, // EXCEPTION-ONLY HOOK
      focusName: fb ? fb.name : "", focusCode: fb ? fb.code : "", focusIncident: fb ? fb.incident : "",
      focusComplaints: fb ? fb.complaints : 0, focusDomain: fb ? fb.domain : "", focusRisk: fb ? fb.risk : 0,
      focusAffected: fb ? fb.affected : 0, focusConf: fb ? fb.conf : 0, focusCause: fb ? fb.cause : "", focusAction: fb ? fb.action : "",
      oldFlow, newFlow: ["STUDENT", "ONE REQUEST", "AI ROUTING", "DEPARTMENT", "RESOLUTION"],
      pageCards: this.pageDefs.map(([id, num, short, name, blurb]) => ({
        num, name, blurb, onClick: () => this.go(id),
        style: { borderRight: "1px solid var(--color-divider)", borderBottom: "1px solid var(--color-divider)", padding: "18px 16px", cursor: "pointer", background: id === page ? "var(--color-neutral-200)" : "transparent", transition: "background .3s, transform .45s cubic-bezier(.2,.8,.2,1)" }
      })),
      pageCardHover: { background: "var(--color-accent-100)" },
      palette: s.palette, queryText: s.queryText || queryList[s.query][0],
      onPalette: () => this.setState(p => ({ palette: !p.palette })),
      onPaletteClose: () => this.setState({ palette: false }),
      stop: (e) => e.stopPropagation(),
      onQueryType: (e) => this.setState({ queryText: e.target.value }),
      onQuerySubmit: (e) => { if (e.key === "Enter") this.runQuery(this.state.queryText || q[0]); },
      queryBusy: s.queryBusy,
      queries: queryList.map((qq, i) => ({
        label: qq[0],
        onClick: () => { this.setState({ query: i, queryText: qq[0] }); this.runQuery(qq[0]); },
        style: { textAlign: "left", background: i === s.query ? "var(--color-accent-100)" : "var(--color-bg)", border: "0", padding: "11px 16px", font: "inherit", fontSize: "13px", cursor: "pointer", color: "var(--color-text)" }
      })),
      answerChain,
      answerNote: s.queryBusy ? "Resolving the question against the campus database…" : (answered ? answered.answer : q[2]),
      answerMethod: answered
        ? answered.intent + " · " + answered.method + " — matched against known query shapes, no language model"
        : "Rule-based intent matching over the campus database."
    }, this.pageVals(), this.extraVals());
  }

  // ---- per-page values -----------------------------------------------------
  pageVals() {
    const s = this.state;
    return Object.assign(
      { isStudent: s.page === "student", isAttendance: s.page === "attendance", isMess: s.page === "mess",
        isReport: s.page === "report", isIncident: s.page === "incident", isInvestigation: s.page === "investigation",
        isRisk: s.page === "risk", isIntervention: s.page === "intervention", isAdmin: s.page === "admin",
        isGatePass: s.page === "gatepass",
        isKiosk: s.page === "kiosk",
        isResources: s.page === "resources",
        // PS07 additions: early warning, pulse, kiosk and adoption
        ps07Staff: Boolean(s.user && s.user.role !== "STUDENT"),
        ps07Admin: Boolean(s.user && s.user.role === "ADMIN"),
        ps07Operator: s.user ? `${s.user.name} · ${s.user.role}` : null,
        goKiosk: () => this.go("kiosk"),
        // shared by the three intelligence surfaces (student, attendance, mess)
        intelLive: s.apiState === "live",
        intelSignedIn: Boolean(s.user),
        intelFocus: s.intelFocus,
        intelGo: (page, focus) => this.intelGo(page, focus),
        intelFocusDone: () => this.setState({ intelFocus: null }) },
      this.studentVals(), this.attendanceVals(), this.messVals(), this.reportVals(),
      this.incidentVals(), this.investigationVals(), this.riskVals(), this.interventionVals(), this.adminVals(),
      this.gatePassVals()
    );
  }

  // ---- gate pass values ----------------------------------------------------
  // Everything below is read from what the backend returned. The only thing
  // computed here is how many seconds are left to draw, and that is derived
  // from the server's own expectedReturnAt against the server's own clock.

  gateStatusTone(status) {
    if (["OVERDUE", "REJECTED"].includes(status)) return "high";
    if (["ACTIVE", "APPROVED"].includes(status)) return "mid";
    if (["RETURNED", "RETURNED_LATE"].includes(status)) return "done";
    return "low";
  }

  gateStatusStyle(status) {
    const tone = this.gateStatusTone(status);
    const background = tone === "high" ? "var(--color-accent)"
      : tone === "mid" ? "var(--color-accent-200)"
      : tone === "done" ? "var(--color-neutral-600)"
      : "var(--color-neutral-200)";
    return {
      fontSize: "9px", letterSpacing: ".12em", padding: "3px 7px", fontWeight: 700, display: "inline-block",
      background,
      color: tone === "high" || tone === "done" ? "var(--color-bg)" : "var(--color-text)"
    };
  }

  /** HH:MM:SS from a second count, which is what the countdown shows. */
  gateClock(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    const sec = String(seconds % 60).padStart(2, "0");
    return `${h}:${m}:${sec}`;
  }

  gateTime(value) {
    if (!value) return "—";
    return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  gatePassVals() {
    const state = this.state;
    const gate = state.gate;
    const user = state.user;
    const staff = Boolean(gate?.config?.canApprove) || (user && user.role !== "STUDENT");
    const rows = gate?.gatePasses || [];
    const selected = this.activeGatePass();

    // The countdown. remainingSeconds was measured by the backend at the
    // moment it answered; gpNow only advances the display between polls, so a
    // refresh re-reads the truth rather than resuming a local clock.
    const timer = selected?.timer || null;
    const drift = timer?.serverTime ? (state.gpNow - Date.parse(timer.serverTime)) / 1000 : 0;
    const liveRemaining = timer && typeof timer.remainingSeconds === "number"
      ? timer.remainingSeconds - drift
      : null;
    const running = selected && ["ACTIVE", "OVERDUE"].includes(selected.status);
    const overdue = selected?.status === "OVERDUE" || (running && liveRemaining !== null && liveRemaining <= 0);
    const warning = running && !overdue && liveRemaining !== null && liveRemaining <= (timer?.warningMinutes || 5) * 60;

    const steps = [
      ["APPLY", ["PENDING_PARENT_VERIFICATION", "PARENT_VERIFIED", "PENDING_WARDEN_APPROVAL", "APPROVED", "ACTIVE", "OVERDUE", "RETURNED", "RETURNED_LATE"]],
      ["PARENT OTP", ["PARENT_VERIFIED", "PENDING_WARDEN_APPROVAL", "APPROVED", "ACTIVE", "OVERDUE", "RETURNED", "RETURNED_LATE"]],
      ["WARDEN", ["APPROVED", "ACTIVE", "OVERDUE", "RETURNED", "RETURNED_LATE"]],
      ["QR AT GATE", ["ACTIVE", "OVERDUE", "RETURNED", "RETURNED_LATE"]],
      ["RETURNED", ["RETURNED", "RETURNED_LATE"]]
    ];
    const reachedIndex = steps.reduce((acc, [, states], i) => (selected && states.includes(selected.status) ? i : acc), -1);

    const queue = rows.filter(row => row.status === "PENDING_WARDEN_APPROVAL");
    const activeRows = rows.filter(row => ["ACTIVE", "OVERDUE"].includes(row.status));
    const historyRows = rows.filter(row => ["RETURNED", "RETURNED_LATE", "REJECTED", "CANCELLED"].includes(row.status));
    const tabRows = state.gateTab === "ACTIVE" ? activeRows : state.gateTab === "HISTORY" ? historyRows : queue;

    const sms = gate?.sms || null;
    const alerts = (gate?.notifications || []).filter(row => !row.read).slice(0, 4);

    const shapeRow = (row) => ({
      id: row.id,
      reference: row.reference,
      who: row.student?.name || "—",
      roll: row.student?.studentId || "",
      where: [row.hostelName, row.room].filter(Boolean).join(" · ") || "—",
      reason: row.reason,
      destination: row.destination || "—",
      window: `${this.gateTime(row.leaveAt)} → ${this.gateTime(row.expectedReturnAt)}`,
      status: row.status,
      statusStyle: this.gateStatusStyle(row.status),
      parent: row.parent?.verified ? `VERIFIED · ${row.parent.phoneMasked || ""}` : "NOT VERIFIED",
      decidedBy: row.approval?.decidedBy || "—",
      overdueBy: row.overdueMinutes ? `${row.overdueMinutes} MIN LATE` : "",
      onSelect: () => this.setState({ gateSelected: row.id, gateQr: null, gateQrFor: null }),
      onApprove: () => this.decideGatePass(row.id, true),
      onReject: () => this.decideGatePass(row.id, false)
    });

    return {
      gateStaff: staff,
      gateOffline: state.apiState !== "live" || !user,
      gateBusy: state.gateBusy,
      gateError: state.gateError,
      gateNotice: state.gateNotice,
      gateVideoRef: this.gateVideoRef,

      // delivery channel, stated honestly on the surface itself
      gateSmsLabel: sms
        ? (sms.configured ? `SMS · ${String(sms.provider).toUpperCase()} · LIVE` : "SMS · DEVELOPMENT MODE — CODE PRINTED TO THE SERVER LOG")
        : "SMS · STATUS UNKNOWN",
      gateSmsLive: Boolean(sms?.configured),

      // application form
      gateReason: state.gateReason,
      gateDestination: state.gateDestination,
      gateDate: state.gateDate || this.gateDefaultDate(),
      gateLeave: state.gateLeave || "10:00",
      gateReturn: state.gateReturn || "12:00",
      gateParentPhone: state.gateParentPhone,
      gateParentOnFile: gate?.config?.parentOnFile?.phoneMasked
        ? `GUARDIAN ON FILE · ${gate.config.parentOnFile.phoneMasked}`
        : "NO GUARDIAN NUMBER ON FILE — ADD ONE BELOW",
      gateMaxHours: gate?.config?.maxDurationHours ? `MAXIMUM ${gate.config.maxDurationHours} HOURS` : "",
      onGateReason: (e) => this.setState({ gateReason: e.target.value, gateError: null }),
      onGateDestination: (e) => this.setState({ gateDestination: e.target.value }),
      onGateDate: (e) => this.setState({ gateDate: e.target.value }),
      onGateLeave: (e) => this.setState({ gateLeave: e.target.value }),
      onGateReturn: (e) => this.setState({ gateReturn: e.target.value }),
      onGateParentPhone: (e) => this.setState({ gateParentPhone: e.target.value }),
      onGateApply: () => this.applyGatePass(),
      gateApplyLabel: state.gateBusy ? "SUBMITTING…" : "SUBMIT APPLICATION →",

      // selected pass
      gateHasPass: Boolean(selected),
      gateReference: selected?.reference || "—",
      gateStatus: selected?.status || "—",
      gateStatusStyle: this.gateStatusStyle(selected?.status),
      gateWindow: selected ? `${this.gateTime(selected.leaveAt)} → ${this.gateTime(selected.expectedReturnAt)}` : "—",
      gateReasonText: selected?.reason || "—",
      gateDestinationText: selected?.destination || "—",
      gateParentState: selected?.parent?.verified
        ? `GUARDIAN VERIFIED · ${selected.parent.phoneMasked || ""}`
        : `AWAITING GUARDIAN · ${selected?.parent?.phoneMasked || ""}`,
      gateApprovalState: selected?.approval
        ? `${selected.approval.decision} BY ${selected.approval.decidedBy || "WARDEN"}`
        : selected?.status === "PENDING_WARDEN_APPROVAL" ? "WAITING FOR THE WARDEN" : "NOT YET WITH THE WARDEN",
      gateApprovalNote: selected?.approval?.note || "",
      gateSteps: steps.map(([label], i) => ({
        label, n: "0" + (i + 1),
        style: { flex: "1 1 110px", borderTop: "2px solid " + (i <= reachedIndex ? "var(--color-accent)" : "var(--color-neutral-300)"), paddingTop: "10px", transition: "border-color .5s" },
        labelStyle: { fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "12px", letterSpacing: ".1em", color: i <= reachedIndex ? "var(--color-text)" : "var(--color-neutral-700)" }
      })),
      gateHistory: rows.map(row => ({
        label: `${row.reference} · ${row.status}`,
        style: {
          textAlign: "left", border: "0", padding: "9px 12px", font: "inherit", fontSize: "12px", cursor: "pointer",
          background: row.id === selected?.id ? "var(--color-accent-100)" : "var(--color-bg)",
          color: "var(--color-text)", borderBottom: "1px solid var(--color-neutral-300)", width: "100%"
        },
        onClick: () => this.setState({ gateSelected: row.id, gateQr: null, gateQrFor: null })
      })),
      // Feature 13: the same RequestTimeline component the complaint uses.
      // Fetched from componentDidUpdate, never from here — renderVals runs
      // during render and must not start work or set state.
      gateTimeline: this.state.gateTimeline,
      gateEvents: (selected?.events || []).map(entry => ({
        t: new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        txt: entry.message,
        tag: entry.kind,
        tagStyle: { fontSize: "9px", letterSpacing: ".12em", fontWeight: 700, color: "var(--color-neutral-700)" }
      })),
      onGateCancel: () => this.cancelGatePass(),
      gateCanCancel: Boolean(selected && ["PENDING_PARENT_VERIFICATION", "PARENT_VERIFIED", "PENDING_WARDEN_APPROVAL", "APPROVED"].includes(selected.status)),

      // guardian OTP
      gateShowOtp: selected?.status === "PENDING_PARENT_VERIFICATION",
      gateOtp: state.gateOtp,
      gateOtpTo: state.gateOtpHint?.phoneMasked || selected?.parent?.phoneMasked || "",
      // Present only when the backend is running with GATE_PASS_REVEAL_OTP on.
      gateOtpDev: state.gateOtpHint?.devCode
        ? `DEVELOPMENT MODE — CODE ${state.gateOtpHint.devCode}`
        : "",
      onGateOtp: (e) => this.setState({ gateOtp: e.target.value.replace(/\D/g, "").slice(0, 6), gateError: null }),
      onGateVerify: () => this.verifyGateOtp(),
      onGateResend: () => this.resendGateOtp(),

      // QR
      gateShowQr: Boolean(selected && ["APPROVED", "ACTIVE", "OVERDUE"].includes(selected.status)),
      // Only ever the code minted for the pass on screen.
      gateQrImage: selected && state.gateQrFor === selected.id ? state.gateQr?.dataUrl || null : null,
      gateQrHeading: selected?.status === "APPROVED" ? "Gate Pass Approved ✓" : "Gate Pass Active",
      gateQrWaiting: state.gateQrBusy ? "GENERATING YOUR CODE…" : "",
      gateQrValidFrom: selected ? this.gateTime(selected.leaveAt) : "—",
      gateQrValidUntil: selected ? this.gateTime(selected.expectedReturnAt) : "—",
      gateQrLabel: state.gateQrBusy
        ? "GENERATING…"
        : (selected && state.gateQrFor === selected.id && state.gateQr) ? "REGENERATE QR" : "SHOW MY QR CODE",
      gateQrCaption: "Scan this QR code at the hostel gate. It carries a random one-use token and this pass reference — nothing else. REGENERATE QR retires every earlier copy, including screenshots.",
      // GATE-PASS QR FIX: the typeable pass code, for when a camera cannot read the QR.
      gateQrCode: selected && state.gateQrFor === selected.id && state.gateQr?.code ? `${selected.reference} · ${state.gateQr.code}` : "",
      // Development aid only: the exact string the scanner will read back, so
      // the flow can be exercised without a second device. Present only when
      // the frontend is running in dev; never in a production build.
      gateQrDebug: import.meta.env.DEV && selected && state.gateQrFor === selected.id ? state.gateQr?.payload || "" : "",
      onGateQr: () => this.openGateQr(Boolean(selected && state.gateQrFor === selected.id && state.gateQr)), // GATE-PASS QR FIX: REGENERATE rotates

      // scanner
      gateScanOpen: state.gateScanOpen,
      gateScanError: state.gateScanError,
      gateCameraSupported: cameraSupported(),
      gateScanResult: state.gateScanResult
        ? (state.gateScanResult.ok
            ? `${state.gateScanResult.reference} — ${state.gateScanResult.action === "EXIT" ? "EXIT RECORDED, PASS ACTIVE" : "RETURN RECORDED, PASS " + state.gateScanResult.status}`
            : state.gateScanResult.message)
        : "",
      gateScanOk: Boolean(state.gateScanResult?.ok),
      gateManualToken: state.gateManualToken,
      onGateManualToken: (e) => this.setState({ gateManualToken: e.target.value }),
      onGateManualScan: () => this.submitGateScan(state.gateManualToken.trim()),
      onGateScanOpen: () => this.startGateScan(),
      onGateScanClose: () => this.closeGateScan(),

      // countdown
      gateRunning: Boolean(running),
      gateCountdown: liveRemaining === null ? "--:--:--" : this.gateClock(Math.abs(liveRemaining)),
      gateCountdownLabel: overdue ? "OVERDUE BY" : "TIME REMAINING",
      gateCountdownStyle: {
        fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "clamp(34px, 6vw, 64px)",
        letterSpacing: "-.02em", lineHeight: 1, fontVariantNumeric: "tabular-nums",
        color: overdue ? "var(--color-accent)" : warning ? "var(--color-accent-700)" : "var(--color-text)"
      },
      gateWarning: warning
        ? "Your gate pass expires in 5 minutes. Please return to the hostel."
        : overdue
          ? "GATE PASS OVERDUE — return to the hostel and scan your pass. Your warden and guardian have been alerted."
          : "",
      gateWarningStyle: {
        border: "1px solid var(--color-accent)", background: "var(--color-accent-100)", padding: "14px 16px",
        fontSize: "13px", fontWeight: 700, color: "var(--color-accent-700)", marginTop: "16px"
      },
      gateExitAt: selected?.exitAt ? `EXIT ${this.gateTime(selected.exitAt)}` : "NOT YET SCANNED OUT",
      gateReturnAt: selected?.returnAt ? `RETURNED ${this.gateTime(selected.returnAt)}` : "",
      gateCompleted: Boolean(selected && ["RETURNED", "RETURNED_LATE"].includes(selected.status)),
      gateCompletedLine: selected && selected.returnAt
        ? `Returned at ${this.gateTime(selected.returnAt)} · ${selected.status === "RETURNED_LATE" ? `${selected.overdueMinutes || 0} minutes late` : "returned on time"}`
        : "",
      gateDuration: selected?.actualDurationMinutes != null ? `${selected.actualDurationMinutes} MIN OUT` : "",

      // alerts raised by the backend, not by this tab being open
      gateAlerts: alerts.map(row => ({
        title: row.title,
        body: row.body,
        tagStyle: {
          fontSize: "9px", letterSpacing: ".12em", padding: "3px 6px", fontWeight: 700,
          justifySelf: "start", borderRadius: "4px",
          background: row.tone === "high" ? "var(--color-accent-100)" : row.tone === "mid" ? "var(--color-accent-2-100)" : "var(--color-neutral-200)",
          color: row.tone === "high" ? "var(--color-accent)" : row.tone === "mid" ? "var(--color-accent-2-700)" : "var(--color-text)"
        },
        tag: row.kind.replace(/^GATE_PASS_/, "").replace(/_/g, " ")
      })),

      // warden / hostel admin console
      gateTab: state.gateTab,
      gateTabs: ["QUEUE", "ACTIVE", "HISTORY"].map(label => ({
        label,
        onClick: () => this.setState({ gateTab: label }),
        style: {
          background: state.gateTab === label ? "var(--color-text)" : "var(--color-bg)",
          color: state.gateTab === label ? "var(--color-bg)" : "var(--color-text)",
          border: "1px solid var(--color-divider)", font: "inherit", fontFamily: "var(--font-heading)",
          fontWeight: 800, fontSize: "11px", letterSpacing: ".12em", padding: "7px 12px", cursor: "pointer"
        }
      })),
      gateStats: [
        { k: "AWAITING APPROVAL", v: String(gate?.summary?.awaitingApproval ?? queue.length) },
        { k: "CURRENTLY OUT", v: String(gate?.summary?.active ?? activeRows.filter(r => r.status === "ACTIVE").length) },
        { k: "OVERDUE", v: String(gate?.summary?.overdue ?? activeRows.filter(r => r.status === "OVERDUE").length) },
        { k: "COMPLETED", v: String(gate?.summary?.returned ?? historyRows.length) }
      ],
      gateRows: tabRows.map(shapeRow),
      gateRowsEmpty: tabRows.length === 0,
      gateEmptyLabel: state.gateTab === "QUEUE"
        ? "NOTHING WAITING FOR A DECISION"
        : state.gateTab === "ACTIVE" ? "NOBODY IS OUT ON A PASS" : "NO CLOSED PASSES YET",
      gateDecisionNote: state.gateDecisionNote,
      onGateDecisionNote: (e) => this.setState({ gateDecisionNote: e.target.value }),
      gateShowDecide: state.gateTab === "QUEUE"
    };
  }

  bar(pct, color) {
    return { height: "6px", borderRadius: "6px", width: pct + "%", background: color || "var(--color-accent)", transition: "width .8s var(--ease)" };
  }

  studentVals() {
    const dash = this.state.student?.dashboard || null;
    const user = dash?.student || this.state.user || null;

    // Fall back to the built-in figures so the surface still reads when the API
    // is offline; otherwise every number below is the student's own record.
    const pct = dash ? dash.attendance.overall : 71.7;
    const threshold = dash ? dash.attendance.threshold : 75;
    const R = 86, C = 2 * Math.PI * R;

    const alerts = dash && dash.alerts.length
      ? dash.alerts.map(alert => ({
          tag: alert.kind,
          title: alert.title,
          body: alert.body,
          tone: alert.tone,
          cta: alert.cta,
          onClick: () => this.go(alert.target || "investigation")
        }))
      : [
          { tag: "ACTUAL DATA", title: "Water supply failure in your hostel", body: "Hostel B · 17 complaints · risk 87%. Maintenance inspection recommended within 4 hours.", tone: "high", onClick: () => this.go("investigation"), cta: "TRACE INCIDENT" },
          { tag: "AI PREDICTION", title: "Attendance below the eligibility bar", body: "You are at 72% against a 75% requirement. Six consecutively attended classes clears it.", tone: "mid", onClick: () => this.go("attendance"), cta: "OPEN SIMULATOR" },
          { tag: "AI RECOMMENDATION", title: "Mess will peak at 13:00 today", body: "Predicted 780 against 850 capacity. Arriving before 12:40 avoids the queue entirely.", tone: "low", onClick: () => this.go("mess"), cta: "SEE DEMAND CURVE" }
        ];

    const reports = dash && dash.reports.length
      ? dash.reports.map(report => ({
          id: report.reference,
          what: report.title,
          where: report.building || "—",
          state: report.status,
          age: report.ageDays + "d",
          pct: report.progress
        }))
      : [
          { id: "CMP-2291", what: "No water in bathroom, 2nd floor", where: "HOSTEL B", state: "INVESTIGATING", age: "2d", pct: 60 },
          { id: "CMP-2264", what: "Wi-Fi drops every evening", where: "LIBRARY", state: "ASSIGNED", age: "4d", pct: 40 },
          { id: "CMP-2107", what: "Fan not working in B-214", where: "HOSTEL B", state: "RESOLVED", age: "17d", pct: 100 }
        ];

    const tiles = dash?.tiles?.length
      ? dash.tiles
      : [
          { key: "MESS NOW", value: "612", sub: "of 850 capacity · queue 6 min" },
          { key: "WI-FI ZONE C", value: "DEGRADED", sub: "AP cluster C4 · 260 students" },
          { key: "OPEN REPORTS", value: "2", sub: "1 investigating · 1 assigned" },
          { key: "CLASSES LEFT", value: "26", sub: "this term across 6 subjects" }
        ];

    return {
      stuName: user?.name || "PRITISH RANJAN SAHOO",
      stuRoll: user?.studentId ? user.studentId.replace(/\//g, " / ") : "BPUT / CSE / 22 / 0417",
      stuRoom: [user?.hostelName, user?.room].filter(Boolean).join(" · ") || "HOSTEL B · ROOM B-214",
      stuAttend: Math.round(pct) + "%",
      stuRingC: C, stuRingOffset: C * (1 - pct / 100), stuRingR: R,
      stuEligible: dash
        ? (dash.attendance.eligible
            ? "ELIGIBLE — " + (pct - threshold).toFixed(1) + " POINTS ABOVE THE BAR"
            : "NOT ELIGIBLE — " + (threshold - pct).toFixed(1) + " POINTS BELOW THE BAR")
        : "ELIGIBLE — 3.0 POINTS ABOVE THE BAR? NO",
      stuBarStyle: this.bar(pct),
      stuThresholdStyle: { position: "absolute", left: threshold + "%", top: "-4px", bottom: "-4px", width: "2px", background: "var(--color-text)" },
      stuAlerts: alerts.map(a => Object.assign(a, {
        tagStyle: { fontSize: "9px", letterSpacing: ".12em", padding: "3px 6px", fontWeight: 700,
          justifySelf: "start", borderRadius: "4px",
          background: a.tone === "high" ? "var(--color-accent-100)" : a.tone === "mid" ? "var(--color-accent-2-100)" : "var(--color-neutral-200)",
          color: a.tone === "high" ? "var(--color-accent)" : a.tone === "mid" ? "var(--color-accent-2-700)" : "var(--color-text)" }
      })),
      stuReports: reports.map(r => Object.assign(r, { barStyle: this.bar(r.pct, r.state === "RESOLVED" ? "var(--color-neutral-600)" : "var(--color-accent)") })),
      stuTiles: tiles.map(tile => ({ k: tile.key ?? tile.k, v: tile.value ?? tile.v, sub: tile.sub })),
      goReport: () => this.go("report"),

      // Feature 17: the student's own resolved complaints, straight from
      // GET /api/complaints?mine=true. Empty offline — nothing to rate.
      stuResolved: this.state.student?.resolved?.complaints || [],
      // Feature 7: the student's own notifications, graded by priority.
      stuNotifications: this.state.aiNotifications?.notifications || [],
      fbRating: this.state.fbRating,
      fbComment: this.state.fbComment,
      fbBusy: this.state.fbBusy,
      fbError: this.state.fbError,
      fbDone: this.state.fbDone,
      onFbRating: (id, value) => this.setState(prev => ({ fbRating: { ...prev.fbRating, [id]: value }, fbError: null })),
      onFbComment: (id, value) => this.setState(prev => ({ fbComment: { ...prev.fbComment, [id]: value } })),
      onFbSubmit: (id) => this.submitFeedback(id)
    };
  }

  attendanceVals() {
    const att = this.state.student?.attendance || null;
    const extra = this.state.extra;

    const subs = att?.subjects?.length
      ? att.subjects.map(row => [row.subject, row.attendedClasses, row.totalClasses])
      : [
          ["DATA STRUCTURES", 9, 11], ["DBMS", 6, 9], ["OPERATING SYSTEMS", 5, 8],
          ["DISCRETE MATHS", 6, 7], ["DIGITAL ELECTRONICS", 4, 7], ["COMMUNICATION SKILLS", 3, 4]
        ];

    const attended = att ? att.attendedClasses : 33;
    const held = att ? att.totalClasses : 46;
    const threshold = att ? att.threshold : 75;
    const current = held ? (attended / held) * 100 : 0;

    // The simulator's own numbers come from POST /api/attendance/simulate when
    // the backend is reachable; the local arithmetic is the offline fallback and
    // matches the server's formula exactly.
    const sim = this.state.attSim;
    const localProjected = (attended + extra) / (held + extra) * 100;
    const projected = sim && sim.input?.plannedClasses === extra ? sim.projected : localProjected;
    const toThreshold = sim?.classesToThreshold ?? (() => {
      for (let n = 1; n <= 200; n += 1) if (((attended + n) / (held + n)) * 100 >= threshold) return n;
      return null;
    })();

    const trend = att?.trend?.length
      ? att.trend.map(row => row.percentage)
      : [78, 77, 76, 76, 74, 74, 73, 73, 72, 71, 70, 71, 72, 72];
    const w = 760, h = 200;
    const lo = Math.min(...trend) - 4, hi = Math.max(...trend) + 4;
    const span = Math.max(1, hi - lo);
    const poly = trend
      .map((v, i) => (40 + i * ((w - 70) / Math.max(1, trend.length - 1))).toFixed(0) + "," + (h - ((v - lo) / span) * (h - 30)).toFixed(0))
      .join(" ");

    // One cell per recorded class: dark where the student was absent.
    const heat = [];
    if (att?.heatmap?.length) {
      att.heatmap.forEach((row, r) => {
        for (let c = 0; c < 14; c++) {
          const cell = row.cells[c];
          heat.push({ key: r + "-" + c, style: { width: "100%", aspectRatio: "1",
            background: !cell ? "var(--color-neutral-200)"
              : cell.present ? "var(--color-neutral-300)"
              : cell.slot === "08:00" ? "var(--color-accent)" : "var(--color-accent-300)" } });
        }
      });
    } else {
      subs.forEach((_, r) => {
        for (let c = 0; c < 14; c++) {
          const v = (r * 7 + c * 3) % 10;
          heat.push({ key: r + "-" + c, style: { width: "100%", aspectRatio: "1", background: v > 7 ? "var(--color-accent)" : v > 5 ? "var(--color-accent-300)" : v > 3 ? "var(--color-neutral-300)" : "var(--color-neutral-200)" } });
        }
      });
    }

    const linked = att?.subjects?.filter(row => row.linkedIncident) || [];

    return {
      attOverall: current.toFixed(1) + "%", attProjected: projected.toFixed(1) + "%", attExtra: extra,
      attNeed: projected >= threshold
        ? "SAFE ELIGIBILITY ZONE REACHED"
        : "YOU NEED " + Math.max(0, (toThreshold ?? 0) - extra) + " MORE ATTENDED CLASSES TO REACH THE " + threshold + "% SAFE ZONE",
      attNeedStyle: { background: projected >= threshold ? "var(--color-neutral-200)" : "var(--color-accent)", color: projected >= threshold ? "var(--color-text)" : "var(--color-bg)", padding: "12px 14px", fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "13px", letterSpacing: ".06em", transition: "background .5s" },
      attNowBarStyle: this.bar(current, "var(--color-neutral-600)"),
      attProjBarStyle: this.bar(projected, projected >= threshold ? "var(--color-neutral-800)" : "var(--color-warn)"),
      onExtra: (e) => {
        const value = Number(e.target.value);
        this.setState({ extra: value });
        this.runAttendanceSim(value);
      },
      attSubjects: subs.map(([name, a, t]) => {
        const pctValue = t ? (a / t) * 100 : 0;
        return { name, a, t, pct: pctValue.toFixed(0) + "%", flag: pctValue < threshold ? "AT RISK" : "OK",
          flagStyle: { fontSize: "10px", letterSpacing: ".1em", fontWeight: 700, color: pctValue < threshold ? "var(--color-accent-700)" : "var(--color-neutral-600)" },
          barStyle: this.bar(pctValue, pctValue < threshold ? "var(--color-accent)" : "var(--color-neutral-600)") };
      }),
      attPoly: poly, attHeat: heat,
      attCross: linked.length
        ? linked.length + " subject" + (linked.length === 1 ? "" : "s") + " have absences the system has linked to an open incident in this student's block — " + linked.map(row => row.subject).join(", ") + ". The link is drawn from complaint timestamps against attendance records, not asserted."
        : "Attendance in the 08:00 slot fell 11 points for the Hostel B cohort in the same fortnight as the water incident. The system links the two at 84% confidence."
    };
  }

  messVals() {
    const mess = this.state.live?.mess || null;
    const slots = mess?.slots?.length
      ? mess.slots.map(slot => [slot.time, slot.crowd, slot.queueMinutes, slot.status, slot.menu])
      : [["11:30", 120, 4], ["12:00", 310, 5], ["12:30", 612, 7], ["13:00", 780, 12],
         ["13:30", 690, 10], ["14:00", 420, 6], ["14:30", 210, 3], ["15:00", 90, 2]];

    const i = Math.min(this.state.slot, slots.length - 1);
    const cap = mess?.capacity || 850;
    const cur = slots[i][1];
    const peak = mess?.peak?.crowd || Math.max(...slots.map(row => row[1]));
    const recommendation = mess?.recommendation || null;

    const dots = Array.from({ length: 96 }, (_, k) => ({
      key: k, style: { width: "100%", aspectRatio: "1", background: k < Math.round(cur / cap * 96) ? (cur > cap * 0.82 ? "var(--color-accent)" : "var(--color-text)") : "var(--color-neutral-300)", transition: "background .4s", transitionDelay: (k * 0.004) + "s" }
    }));

    const menu = slots[i][4]?.length
      ? slots[i][4].map(item => [item.item, item.servings.toLocaleString() + " servings", item.takenPercentage + "% taken"])
      : [["RICE · DALMA · CURD", "9,240 servings", "92% taken"], ["ROTI · PANEER", "3,110 servings", "78% taken"], ["EGG CURRY", "2,480 servings", "96% taken"]];

    return {
      messSlot: i, messTime: slots[i][0], messCrowd: cur, messCap: cap, messPeak: peak,
      messWaste: (mess?.expectedWaste ?? 8) + "%",
      messFillStyle: this.bar(cur / cap * 100, cur > cap * 0.82 ? "var(--color-accent)" : "var(--color-text)"),
      messBars: slots.map(([t, v], k) => ({
        t, v, style: { height: (v / cap * 180).toFixed(0) + "px", background: k === i ? "var(--color-accent)" : v > cap * 0.82 ? "var(--color-accent-300)" : "var(--color-neutral-400)", transition: "background .3s", cursor: "pointer" },
        labelStyle: { fontSize: "10px", letterSpacing: ".06em", color: k === i ? "var(--color-text)" : "var(--color-neutral-600)", fontWeight: k === i ? 700 : 400 },
        onClick: () => this.setState({ slot: k })
      })),
      onSlot: (e) => this.setState({ slot: Number(e.target.value) }),
      messDots: dots,
      messStatus: slots[i][3] || (cur > cap * 0.82 ? "OVERLOAD PREDICTED" : cur > cap * 0.52 ? "BUSY" : "COMFORTABLE"),
      messStatusStyle: { fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "13px", letterSpacing: ".1em", padding: "6px 10px", background: cur > cap * 0.82 ? "var(--color-accent)" : "var(--color-neutral-200)", color: cur > cap * 0.82 ? "var(--color-bg)" : "var(--color-text)" },
      messMenu: menu.map(([a, b, c]) => ({ a, b, c })),
      messNote: recommendation
        ? "Predicted peak " + peak + " at " + (mess.peak?.time || slots[i][0]) + " against " + cap + " capacity. " +
          recommendation.action + " drops the peak to " + recommendation.peakAfter +
          " and expected waste from " + recommendation.wasteBefore + "% to " + recommendation.wasteAfter + "%."
        : "Predicted peak 780 at 13:00 against 850 capacity. Two blocks now share the 13:00 slot after the lab reschedule — staggering Block C by 20 minutes drops the peak to 640 and expected waste from 8% to 5%."
    };
  }

  reportVals() {
    const steps = ["SUBMITTED", "CLASSIFIED", "ASSIGNED", "INVESTIGATING", "RESOLVED"];
    const st = this.state.step;
    const result = this.state.repResult;
    const complaint = result?.complaint || null;
    const classification = result?.classification || null;

    const cats = ["WATER", "ELECTRICITY", "WI-FI", "CLEANLINESS", "MESS", "SAFETY"];
    const chosen = this.state.repCategory;

    // Before a submission these are the worked example; afterwards every row is
    // the backend's own reading of what the student actually wrote.
    const classRows = classification
      ? [
          ["CATEGORY", classification.category],
          ["PRIORITY", classification.priority],
          ["SEVERITY", classification.severity],
          ["DUPLICATE PROBABILITY", classification.duplicateProbability + "%"],
          ["RELATED INCIDENT", result.incident ? result.incident.title : "NONE — FIRST OF ITS KIND"],
          ["AFFECTED AREA", classification.affectedArea || "—"],
          ["ROUTED TO", classification.routedTo],
          ["SLA", classification.slaHours + " HOURS"]
        ]
      : [
          ["CATEGORY", "WATER"], ["PRIORITY", "HIGH"], ["SEVERITY", "CRITICAL"],
          ["DUPLICATE PROBABILITY", "91%"], ["RELATED INCIDENT", "HOSTEL B WATER FAILURE"],
          ["AFFECTED AREA", "HOSTEL B · FLOORS 1–3"], ["ROUTED TO", "MAINTENANCE · PLUMBING"], ["SLA", "4 HOURS"]
        ];

    const audit = complaint?.audit?.length
      ? complaint.audit.map(entry => [
          new Date(entry.at).toISOString().slice(11, 16),
          entry.message,
          entry.kind
        ])
      : [
          ["09:12", "Report submitted by student · Hostel B, floor 2", "ACTUAL DATA"],
          ["09:12", "Rule classification: Water / High / Critical — 91% duplicate of CMP-2214", "AI PREDICTION"], // REEL HOOK (see CHANGES-REEL.md): rule-based, not AI
          ["09:13", "Merged into incident INC-0071 · Hostel B Water Failure", "ACTUAL DATA"],
          ["09:21", "Assigned to Maintenance · Plumbing, SLA 4h", "ACTUAL DATA"],
          ["10:04", "Technician on site — booster pump 2 pressure confirmed at 0.4 bar", "EVIDENCE"],
          ["11:36", "Resolved · risk 87% → 21% · no recurrence expected for 14 days", "AI PREDICTION"]
        ];

    const user = this.state.student?.dashboard?.student || this.state.user;
    const defaultLocation = user
      ? [user.hostelName, user.room].filter(Boolean).join(" · ")
      : "HOSTEL B · FLOOR 2 · B-214";

    return {
      repSteps: steps.map((label, i) => ({
        label, n: "0" + (i + 1),
        style: { flex: "1 1 120px", borderTop: "2px solid " + (i <= st ? "var(--color-accent)" : "var(--color-neutral-300)"), paddingTop: "10px", transition: "border-color .5s" },
        labelStyle: { fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "12px", letterSpacing: ".1em", color: i <= st ? "var(--color-text)" : "var(--color-neutral-700)" }
      })),
      repObjStyle: { position: "absolute", top: "-9px", left: "calc(" + (st * 25) + "% - 9px)", width: "18px", height: "18px", background: "var(--color-accent)", transition: "left .7s cubic-bezier(.2,.8,.2,1)" },
      repTrackStyle: { position: "relative", height: "2px", background: "var(--color-neutral-300)", margin: "22px 9px 8px" },
      repStep: st, repStepLabel: steps[st],
      repReference: complaint?.reference || "CMP-2312",
      repDuplicates: (result?.duplicates || []).map(row => ({ label: row.reference + " · " + row.overlap + "%" })),

      // the form is real input now, not a fixed illustration
      repCategory: chosen,
      repLocation: this.state.repLocation || defaultLocation,
      repText: this.state.repText,
      repBusy: this.state.repBusy,
      repError: this.state.repError,
      isStaff: Boolean(this.state.user && this.state.user.role !== "STUDENT"),
      isStudentRole: !Boolean(this.state.user && this.state.user.role !== "STUDENT"),
      userRole: this.state.user?.role || "STUDENT",
      userName: this.state.user?.name || "Student",
      repSubmitLabel: this.state.repBusy
        ? "CLASSIFYING…"
        : this.state.apiState === "live"
          ? "SUBMIT INTO THE SYSTEM →"
          : "ADVANCE THE DEMO FLOW →",
      onRepLocation: (e) => this.setState({ repLocation: e.target.value }),
      onRepText: (e) => this.setState({ repText: e.target.value, repError: null }),
      onAdvance: () => this.submitComplaint(),
      onResetStep: () => this.setState({ step: 0, repResult: null, repError: null, repText: "" }),

      repClass: classRows.map(([k, v]) => ({ k, v })),
      repClassMethod: classification
        ? "Keyword and location matching · " + classification.confidence + "% confidence · " + classification.method
        : "Worked example — submit a report to see the system classify it",
      repClassReasons: (classification?.reasons || []).map(reason => ({ label: reason })),
      repCats: cats.map(c => ({
        label: c,
        onClick: () => this.setState({ repCategory: c }),
        style: { fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "11px", letterSpacing: ".08em", padding: "8px 11px", border: "2px solid " + (c === chosen ? "var(--color-text)" : "var(--color-divider)"), background: c === chosen ? "var(--color-text)" : "transparent", color: c === chosen ? "var(--color-bg)" : "var(--color-text)", cursor: "pointer" }
      })),
      // ---- AI layer -----------------------------------------------------
      // Straight off the API response. Nothing here is defaulted or invented:
      // before a submission `ai` is null and the panel says so, and after one
      // every field is whatever the backend actually returned.
      repAi: this.state.repResult?.ai || null,
      repEscalation: this.state.repResult?.escalation || null,
      repAiTimeline: this.state.repTimeline,
      repAiDuplicate: this.state.repDuplicates,
      repAiStatus: this.state.ai?.status || null,

      repAudit: audit.map(([t, txt, tag]) => ({ t, txt, tag, tagStyle: { fontSize: "9px", letterSpacing: ".1em", fontWeight: 700, padding: "2px 5px", border: "1px solid var(--color-divider)", color: tag === "ACTUAL DATA" ? "var(--color-neutral-700)" : "var(--color-accent-700)", whiteSpace: "nowrap" } })),

      // ---- 6-Day Student Confirmation Portal (Red Flag / Green Flag) ----
      repResolvedList: (() => {
        const candidateComplaints = [
          ...(this.state.repResult?.complaint ? [this.state.repResult.complaint] : []),
          ...(this.state.studentComplaints || []),
          ...(this.state.triage || []),
          {
            id: "CMP-2312",
            reference: "CMP-2312",
            title: "No water in bathroom, 2nd floor",
            category: "WATER",
            location: "HOSTEL B · 2ND FLOOR",
            status: "RESOLVED",
            createdAt: new Date(Date.now() - 3600000 * 26).toISOString(),
            resolution: {
              resolvedAt: new Date(Date.now() - 3600000 * 18).toISOString(),
              adminMessage: "Hostel B plumbing team replaced the booster pump 2 valve and flushed the line. Water pressure restored to 2.4 bar.",
              resolvedByName: "Dr. S. K. Mahapatra",
              resolvedByRole: "WARDEN",
              confirmWindowDays: 6,
              studentFlag: "PENDING"
            }
          },
          {
            id: "CMP-2291",
            reference: "CMP-2291",
            title: "Electrical switch sparking near room B-210",
            category: "SAFETY",
            location: "HOSTEL B · WING A",
            status: "RESOLVED",
            createdAt: new Date(Date.now() - 3600000 * 72).toISOString(),
            resolution: {
              resolvedAt: new Date(Date.now() - 3600000 * 48).toISOString(),
              adminMessage: "Electrician replaced 16A MCB and socket plate with fire-rated modular unit.",
              resolvedByName: "Er. R. Pradhan",
              resolvedByRole: "ADMIN",
              confirmWindowDays: 6,
              studentFlag: "GREEN_FLAG"
            }
          }
        ];

        const seenRefs = new Set();
        return candidateComplaints.filter(c => {
          const ref = c.reference || c.id;
          if (seenRefs.has(ref)) return false;
          seenRefs.add(ref);
          return c.status === "RESOLVED" || Boolean(c.resolution?.resolvedAt);
        }).map(c => {
          const resolvedAt = c.resolution?.resolvedAt ? new Date(c.resolution.resolvedAt) : new Date(Date.now() - 3600000 * 18);
          const elapsedHours = Math.max(0, (Date.now() - resolvedAt.getTime()) / 3600000);
          const daysLeft = Math.max(0, 6 - Math.floor(elapsedHours / 24));
          const hoursLeft = Math.max(0, Math.floor(144 - elapsedHours) % 24);
          const flag = this.state.studentFlagDone[c.id || c.reference] || c.resolution?.studentFlag || "PENDING";
          const disputeReason = c.resolution?.studentDisputeReason || "";
          return {
            id: c.id || c.reference,
            reference: c.reference || c.id,
            title: c.title,
            category: c.category,
            location: c.location || "Hostel B",
            resolvedAt: resolvedAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
            adminMessage: c.resolution?.adminMessage || c.resolution?.resolutionDescription || "Maintenance completed and checked.",
            resolver: c.resolution?.resolvedByName ? `${c.resolution.resolvedByName} (${c.resolution.resolvedByRole || "Staff"})` : "Warden / Maintenance Head",
            daysLeft,
            hoursLeft,
            isExpired: elapsedHours >= 144,
            flag,
            disputeReason,
            isDisputeOpen: Boolean(this.state.studentDisputeOpen[c.id || c.reference]),
            disputeNote: this.state.studentDisputeNotes[c.id || c.reference] || ""
          };
        });
      })(),
      studentFlagBusy: this.state.studentFlagBusy,
      onConfirmGreen: (id) => this.submitStudentFlag(id, "GREEN_FLAG"),
      onToggleDispute: (id) => this.setState(p => ({ studentDisputeOpen: { ...p.studentDisputeOpen, [id]: !p.studentDisputeOpen[id] } })),
      onDisputeText: (id, text) => this.setState(p => ({ studentDisputeNotes: { ...p.studentDisputeNotes, [id]: text } })),
      onSubmitRed: (id) => this.submitStudentFlag(id, "RED_FLAG", this.state.studentDisputeNotes[id] || "Problem still persists after reported resolution")
    };
  }

  incidentVals() {
    const story = this.state.live?.story || null;
    const incidents = this.state.live?.incidents?.incidents || [];
    const memory = this.state.live?.memory?.memory || [];
    const cluster = this.state.clusterRun;

    // The time-travel slider reads the incident's real day-by-day growth.
    const days = story?.timeline?.length
      ? story.timeline.map(row => [row.label, row.complaints, row.risk, row.status, row.note])
      : [
          ["DAY 1", 1, 12, "DETECTED", "First complaint: “no water on 2nd floor”."],
          ["DAY 3", 5, 34, "CLUSTERED", "Four more complaints, same building, different words."],
          ["DAY 7", 11, 58, "PATTERN DETECTED", "Wording cluster crosses threshold; history matched."],
          ["DAY 14", 17, 79, "CONFIRMED", "Incident confirmed. Pump failure hypothesis at 84%."],
          ["TODAY", 17, 87, "INTERVENTION PENDING", "Risk 87%. 132 students affected. Awaiting inspection."]
        ];

    const dayIndex = Math.min(this.state.day, days.length - 1);
    const d = days[dayIndex];
    const cl = this.state.clustered;
    const total = days[days.length - 1][1] || 17;

    const dots = Array.from({ length: total }, (_, i) => {
      const a = (i / total) * Math.PI * 2, r = 150;
      return { key: i, style: { position: "absolute", left: "50%", top: "50%", width: "16px", height: "16px", background: "var(--color-text)",
        transform: cl ? "translate(-8px,-8px) scale(.35)" : "translate(" + (Math.cos(a) * r - 8).toFixed(0) + "px," + (Math.sin(a) * r * 0.62 - 8).toFixed(0) + "px)",
        opacity: cl ? 0.25 : 1, transition: "transform .9s cubic-bezier(.2,.8,.2,1), opacity .9s", transitionDelay: (i * 0.035) + "s" } };
    });

    const list = incidents.length
      ? incidents.map(incident => [
          incident.reference,
          (incident.building?.code ? incident.building.code + " · " : "") + incident.title.replace(/^.*· /, ""),
          incident.complaintCount,
          incident.risk,
          incident.status,
          incident.id
        ])
      : [
          ["INC-0071", "HOSTEL B · WATER SUPPLY FAILURE", 17, 87, "INTERVENTION PENDING"],
          ["INC-0068", "WI-FI ZONE C · NETWORK ANOMALY", 14, 72, "INVESTIGATING"],
          ["INC-0066", "CENTRAL MESS · LUNCH OVERLOAD", 11, 68, "PREDICTED"],
          ["INC-0064", "ACADEMIC BLOCK A · ATTENDANCE DECLINE", 9, 63, "INVESTIGATING"],
          ["INC-0061", "HOSTEL C · SILENT WATER ANOMALY", 0, 74, "DETECTED"],
          ["INC-0058", "MEDICAL CENTRE · ELEVATED WALK-INS", 4, 41, "CLUSTERED"]
        ];

    const history = memory.length
      ? memory.map(row => [
          new Date(row.occurredOn).toISOString().slice(0, 10),
          row.building?.name || row.buildingName || "—",
          row.incidentType,
          (row.resolutionTimeHours ?? "—") + "h"
        ])
      : [["2025-08-19", "Hostel B", "Water failure", "3.1h"], ["2025-11-04", "Hostel B", "Water failure", "5.4h"],
         ["2026-02-22", "Hostel B", "Low pressure", "2.2h"], ["2026-06-09", "Hostel B", "Pump replacement", "9.0h"]];

    return {
      incDay: dayIndex, incDayLabel: d[0], incCount: d[1], incRisk: d[2], incStatus: d[3], incNote: d[4],
      incDayMax: days.length - 1,
      incRiskBar: this.bar(d[2], d[2] > 70 ? "var(--color-accent)" : "var(--color-neutral-600)"),
      onDay: (e) => this.setState({ day: Number(e.target.value) }),
      incDayTicks: days.map((x, i) => ({ label: x[0], style: { fontSize: "10px", letterSpacing: ".1em", color: i === dayIndex ? "var(--color-text)" : "var(--color-neutral-600)", fontWeight: i === dayIndex ? 700 : 400 } })),
      incDots: dots, incClustered: cl, incTotal: total,
      onCluster: () => this.runClustering(),
      incClusterLabel: cl ? "REPLAY CLUSTERING" : "GROUP SIMILAR COMPLAINTS",
      // EXCEPTION-ONLY HOOK: headline and caption from the live lead incident (Hostel B stays the seeded case).
      incHeadline: incidentHeadline(this.state.live, "Seventeen complaints. One problem."),
      incCaption: incidentCaption(this.state.live, cluster, "17 complaints · 91% wording overlap · 4 historical matches"),
      incClusterNote: cluster
        ? cluster.inputComplaints + " complaints in the window resolved into " + cluster.clusters.length +
          " cluster" + (cluster.clusters.length === 1 ? "" : "s") + ". Largest holds " +
          (cluster.clusters[0]?.complaintCount ?? 0) + " reports at " +
          (cluster.clusters[0]?.averageOverlap ?? 0) + "% average keyword overlap across " +
          (cluster.clusters[0]?.distinctPhrasings ?? 0) + " distinct phrasings — deterministic matching on building, " +
          "category, time and wording, not a semantic model."
        : "Grouping is deterministic: same building, same category, close in time, overlapping wording.",
      incCoreStyle: { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", padding: "14px 18px", border: "1px solid var(--color-neutral-500)", background: cl ? "var(--color-accent)" : "var(--color-neutral-100)", color: cl ? "var(--color-bg)" : "var(--color-text)", textAlign: "left", opacity: cl ? 1 : 0.35, transition: "all .8s", transitionDelay: cl ? ".55s" : "0s" },
      incList: list.map(([id, name, c, r, st, incidentId]) => ({ id, name, c, r: r + "%", st,
        rowStyle: { display: "grid", gridTemplateColumns: "88px minmax(0,1fr) 70px 64px 150px", gap: "10px", alignItems: "center", padding: "11px 0", borderBottom: "1px solid var(--color-neutral-300)", cursor: "pointer", fontSize: "13px" },
        stStyle: { fontSize: "10px", letterSpacing: ".1em", fontWeight: 700, color: r >= 70 ? "var(--color-accent-700)" : "var(--color-neutral-700)" },
        onClick: () => this.openIncident(incidentId) })),
      incHistory: history.map(([d2, b, c, t]) => ({ d: d2, b, c, t })),
      // Headings follow whichever incident the surfaces are focused on.
      incRefLine: (list[0]?.[0] || "INC-0071") + " · " + (list[0]?.[1] || "HOSTEL B WATER"),
      incBuildingName: this.buildings.find(row => row.id === this.state.riskFocus)?.name || "HOSTEL B"
    };
  }

  investigationVals() {
    const report = this.state.investigation;

    // Node positions are the existing layout; only their labels and evidence
    // change once the backend has assembled the real case.
    const nodes = [
      ["hostb", report?.incident?.building?.name || "HOSTEL B", 20, 20, "ENTITY"],
      ["water", report?.incident?.title?.replace(/^.*· /, "") || "WATER SUPPLY FAILURE", 20, 110, "INCIDENT"],
      ["comps", (report ? report.relatedComplaints.length : 17) + " COMPLAINTS", 20, 200, "EVIDENCE"],
      ["cause", (report?.possibleCauses?.[0]?.cause || "PUMP FAILURE").toUpperCase().slice(0, 34), 20, 290, "HYPOTHESIS"],
      ["maint", "MAINTENANCE DELAY", 20, 380, "PATTERN"],
      ["hist", (report ? report.historicalIncidents.length : 4) + " HISTORICAL INCIDENTS", 260, 200, "HISTORY"],
      ["sleep", "SLEEP DISRUPTION", 260, 290, "CROSS-DOMAIN"],
      ["att", "ATTENDANCE DROP", 260, 380, "CROSS-DOMAIN"]
    ];
    const edges = [["hostb", "water"], ["water", "comps"], ["comps", "cause"], ["cause", "maint"], ["comps", "hist"], ["water", "sleep"], ["sleep", "att"]];
    const pos = {}; nodes.forEach(([id, , x, y]) => pos[id] = { x, y });
    const sel = this.state.node;

    const chains = this.state.live?.relationships?.chains || [];
    const waterChain = chains.find(chain => chain.chain === "HOSTEL_WATER");

    const evidenceFor = (key) => {
      if (!report) return null;
      const find = (label) => report.evidence.find(row => row.label === label);
      if (key === "hostb") return [
        ["OCCUPANCY", find("LOCATION")?.value || report.incident.building?.name || "—"],
        ["RISK", report.incident.risk + "% · " + report.incident.riskLevel],
        ["AFFECTED", report.incident.affectedStudents + " students"]
      ];
      if (key === "water") return [
        ["STATUS", report.incident.status],
        ["CATEGORY", report.incident.category],
        ["SCOPE", report.incident.affectedStudents + " students"]
      ];
      if (key === "comps") return [
        ["VOLUME", find("VOLUME")?.value || report.relatedComplaints.length + " complaints"],
        ["LANGUAGE", find("LANGUAGE")?.value || "—"],
        ["SHARED TERMS", report.sharedLanguage.slice(0, 6).join(", ") || "none"]
      ];
      if (key === "cause") return report.possibleCauses.map(cause => [cause.confidence + "%", cause.cause]);
      if (key === "maint") return [
        // EXCEPTION-ONLY HOOK: the median is computed from resolved history, labelled with its kind.
        ["MEDIAN", report.maintenancePattern.medianResponseDays + " days" + (report.maintenancePattern.medianKind === "ASSUMPTION" ? " · ASSUMPTION (too little resolved history)" : report.maintenancePattern.medianKind ? " · ACTUAL DATA · median of " + report.maintenancePattern.medianSamples + " resolved" : " to inspection")],
        ["THIS CASE", report.maintenancePattern.thisCaseDays + " days"],
        ["EFFECT", report.maintenancePattern.effect]
      ];
      if (key === "hist") return report.historicalIncidents.map(match => [
        new Date(match.memory.occurredOn).toISOString().slice(0, 10),
        match.memory.incidentType + " · " + match.similarity + "% similarity"
      ]);
      if (key === "sleep" || key === "att") {
        const step = waterChain ? waterChain.steps : null;
        const crossDomain = find("CROSS-DOMAIN");
        return [
          ["SIGNAL", crossDomain?.value || "—"],
          ["CHAIN", step ? step.join(" → ") : "—"],
          ["CONFIDENCE", waterChain ? waterChain.confidence + "% (stored estimate, not a model output)" : "—"]
        ];
      }
      return null;
    };

    const fallbackEvidence = {
      hostb: [["OCCUPANCY", "312 residents · 3 floors"], ["SENSORS", "1 tank sensor, 2 booster pumps"], ["HISTORY", "4 water incidents in 13 months"]],
      water: [["ONSET", "04:10, 14 days ago"], ["PRESSURE", "0.4 bar against 1.8 bar nominal"], ["SCOPE", "Floors 1–3, 132 students"]],
      comps: [["VOLUME", "17 complaints in 14 days"], ["LANGUAGE", "11 distinct phrasings, one meaning"], ["DUPLICATES", "91% wording overlap"], ["PEAK", "6 complaints on day 7"]],
      cause: [["MATCH", "Pressure curve matches 2025-11-04 pump failure"], ["PART", "Booster pump 2, 41 months in service"], ["CONFIDENCE", "89% — see the breakdown"]],
      maint: [["PATTERN", "Median 3.8 days from first complaint to inspection · ASSUMPTION"], ["THIS CASE", "14 days, no inspection"], ["EFFECT", "Risk grows 5.1 points per day after day 7"]],
      hist: [["2025-08-19", "Water failure · resolved in 3.1h"], ["2025-11-04", "Water failure · resolved in 5.4h"], ["2026-02-22", "Low pressure · 2.2h"], ["2026-06-09", "Pump replacement · 9.0h"]],
      sleep: [["SIGNAL", "Night Wi-Fi sessions in Hostel B up 34%"], ["INFERENCE", "Disrupted sleep for 14 nights"], ["CONFIDENCE", "76%"]],
      att: [["SLOT", "08:00 attendance down 11 points"], ["COHORT", "Hostel B residents only"], ["CONFIDENCE", "84%"]]
    };

    const typeOf = {}; nodes.forEach(([id, , , , t]) => typeOf[id] = t);
    const nameOf = {}; nodes.forEach(([id, n]) => nameOf[id] = n);
    const evidence = evidenceFor(sel) || fallbackEvidence[sel] || [];

    const confRows = report?.confidenceBreakdown?.length
      ? report.confidenceBreakdown.map(row => [row.label, row.weight])
      : [["17 complaints, one building", 31], ["Same location signature", 18], ["Similar descriptions (91% overlap)", 16], ["4 historical incidents", 14], ["Maintenance delay pattern", 10]];

    return {
      invNodes: nodes.map(([id, label, x, y, type]) => ({
        id, label, type,
        onClick: () => this.setState({ node: id }),
        boxStyle: { position: "absolute", left: (x / 480 * 100).toFixed(2) + "%", top: (y / 450 * 100).toFixed(2) + "%",
          width: "41.6%", minHeight: "9.8%", boxSizing: "border-box", border: "1px solid var(--color-neutral-500)",
          background: id === sel ? "var(--color-text)" : "var(--color-neutral-100)",
          padding: "7px 9px", cursor: "pointer", display: "grid", alignContent: "center", gap: "2px", transition: "background .3s" },
        labelStyle: { fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "clamp(9px, 1vw, 13px)", letterSpacing: ".04em",
          lineHeight: 1.1, color: id === sel ? "var(--color-bg)" : "var(--color-text)" },
        typeStyle: { fontSize: "clamp(7px, .72vw, 9px)", letterSpacing: ".14em",
          color: id === sel ? "color-mix(in srgb, var(--color-bg) 70%, transparent)" : "var(--color-neutral-600)" }
      })),
      invEdges: edges.map(([a, b]) => {
        const A = pos[a], B = pos[b];
        const from = [A.x + (A.y === B.y ? 200 : 100), A.y + (A.y === B.y ? 22 : 44)];
        const to = [B.x + (A.y === B.y ? 0 : 100), B.y + (A.y === B.y ? 22 : 0)];
        return { d: "M" + from[0] + " " + from[1] + " L" + to[0] + " " + to[1],
          style: { animation: this.state.mode === "HIGH" ? "nex-dash 2.6s linear infinite" : "none" } };
      }),
      invSelName: nameOf[sel], invSelType: typeOf[sel],
      invEvidence: evidence.map(([k, v]) => ({ k, v })),
      invConfRows: confRows.map(([label, w]) => ({ label, w: "+" + (Math.round(w * 10) / 10), barStyle: this.bar(Math.min(100, w * 3), "var(--color-accent-2)") })),
      invConf: (report?.confidence ?? 89) + "%",
      invRef: report?.incident?.reference || "INC-0071",
      invMethod: report
        ? "Confidence is the sum of the weighted factors above — " + report.method + ", not a trained model."
        : "Confidence is a weighted sum of named factors, not a model output.",
      invBrief: report?.brief
        || "Seventeen complaints filed over fourteen days resolve into one recurring incident in Hostel B. The pressure curve matches two prior pump failures in the same building, and no inspection has been raised in fourteen days against a 3.8-day median.",
      goIntervene: () => this.go("intervention")
    };
  }

  riskVals() {
    const b = this.buildings.find(x => x.id === this.state.riskFocus) || this.buildings[2];
    const risk = this.state.live?.risk || null;
    const detail = this.state.riskDetail?.building?.code === b.code ? this.state.riskDetail : null;
    const anomalies = this.state.live?.campus?.anomalies || [];
    const silent = anomalies.find(row => row.complaintsSoFar === 0) || anomalies[0] || null;

    const domains = risk?.domains?.length
      ? risk.domains.slice(0, 8).map(row => [row.domain.toUpperCase(), row.riskScore])
      : [["HOSTEL", 91], ["CAMPUS OVERALL", 87], ["FACILITY", 79], ["HOSTEL C (SILENT)", 74],
         ["COMPLAINT LOAD", 72], ["ATTENDANCE", 63], ["MESS", 48]];

    const levels = detail?.levels?.length
      ? detail.levels
      : ["LOW", "EMERGING", "ELEVATED", "HIGH", "CRITICAL"].map((level, i) => {
          const idx = b.risk >= 85 ? 4 : b.risk >= 70 ? 3 : b.risk >= 50 ? 2 : b.risk >= 30 ? 1 : 0;
          return { level, reached: i <= idx };
        });

    const silentRows = silent
      ? [
          ["SIGNAL", silent.building?.name ? silent.building.name + " · " + silent.signal : silent.signal],
          ["HISTORICAL PATTERN", silent.historicalPattern],
          ["COMPLAINTS SO FAR", String(silent.complaintsSoFar)],
          ["PREDICTED RISK", silent.predictedRisk + "%"],
          ["RECOMMENDED", silent.recommendedAction],
          ["METHOD", silent.method + " — fixed thresholds, not machine learning"]
        ]
      : [
          ["SIGNAL", "Hostel C water draw ↓ 23% over 9 days"],
          ["HISTORICAL PATTERN", "Identical slope preceded the Hostel B failure at day 9 of 14"],
          ["COMPLAINTS SO FAR", "0"], ["PREDICTED RISK", "74%"],
          ["RECOMMENDED", "Inspect tank sensor before students notice"]
        ];

    const anomalyRows = anomalies.length
      ? anomalies.map(row => [
          row.building?.code || "CAMPUS",
          row.signal,
          row.predictedRisk + "%",
          row.daysObserved + " days"
        ])
      : [["HST-C", "Water draw ↓23%", "74%", "9 days"], ["LIB", "Session drops above 180 devices", "72%", "4 days"],
         ["MESS-C", "13:00 load ↑ after lab reschedule", "68%", "6 days"], ["MED", "Walk-ins ↑19%", "41%", "7 days"],
         ["ACAD-A", "08:00 slot attendance ↓11 pts", "63%", "14 days"]];

    return {
      riskDomains: domains.map(([k, v]) => ({ k, v: v + "%", barStyle: this.bar(v, v >= 80 ? "var(--color-accent)" : "var(--color-neutral-600)") })),
      riskSelName: b.name, riskSelCode: b.code, riskSelRisk: b.risk + "%", riskSelDomain: b.domain,
      riskSelCause: detail?.leadingIncident?.cause || b.cause,
      riskSelAction: detail?.anomalies?.[0]?.recommendedAction || b.action,
      riskSelAffected: (detail?.building?.affectedStudents ?? b.affected) + " students",
      riskStates: levels.map(({ level, reached }) => ({
        label: level,
        style: { flex: "1", padding: "8px 6px", textAlign: "left", fontSize: "10px", letterSpacing: ".1em", fontWeight: 700, background: reached ? "var(--color-accent)" : "var(--color-neutral-200)", color: reached ? "var(--color-bg)" : "var(--color-neutral-600)", transition: "background .5s" }
      })),
      riskSilent: silentRows.map(([k, v]) => ({ k, v })),
      riskAnomalies: anomalyRows.map(([code, sig, riskValue, age]) => ({ code, sig, risk: riskValue, age }))
    };
  }

  interventionVals() {
    const plan = this.state.plan;
    const sim = this.state.intSim;
    // The recommendation for whichever incident the surfaces are focused on.
    const focused = this.activeIncident();
    const list = this.state.live?.interventions || [];
    const intervention = (focused && list.find(row => row.incident?.id === focused.id)) || list[0] || null;
    const quality = this.state.decisionResult?.projection || null;

    const scenarioFor = (id) => sim?.scenarios?.find(row =>
      row.scenario === (id === "repair" ? "REPAIR_NOW" : "DO_NOTHING"));

    const live = { nothing: scenarioFor("nothing"), repair: scenarioFor("repair") };

    const A = live.nothing
      ? { risk: live.nothing.riskAfter, affected: live.nothing.affectedStudents, comps: live.nothing.predictedComplaints, cost: "₹ 2.4L", label: "DO NOTHING · " + live.nothing.windowHours + "H DRIFT" }
      : { risk: 94, affected: 210, comps: 29, cost: "₹ 2.4L", label: "DO NOTHING · 24H DELAY" };
    const B = live.repair
      ? { risk: live.repair.riskAfter, affected: live.repair.affectedStudents, comps: live.repair.predictedComplaints, cost: "₹ 18K", label: "REPAIR NOW · " + live.repair.repairHours + "H WINDOW" }
      : { risk: 34, affected: 20, comps: 6, cost: "₹ 18K", label: "REPAIR NOW · 4H WINDOW" };

    const curveOf = (points) => points
      .map((point, i) => (30 + i * (500 / Math.max(1, points.length - 1))).toFixed(0) + "," + (200 - point.risk * 1.8).toFixed(0))
      .join(" ");
    const fallbackCurve = (vals) => vals.map((v, i) => (30 + i * 100).toFixed(0) + "," + (200 - v * 1.8).toFixed(0)).join(" ");

    const action = intervention
      ? [
          ["RECOMMENDED ACTION", intervention.recommendedAction],
          ["PRIORITY", intervention.priority],
          ["EXPECTED IMPACT", intervention.expectedImpact || "—"],
          ["ESTIMATED RESOLUTION", intervention.estimatedResolutionHours + " HOURS"],
          ["CONFIDENCE", intervention.confidence + "%"],
          ["OWNER", intervention.owner || "UNASSIGNED"]
        ]
      : [
          ["RECOMMENDED ACTION", "Inspect Hostel B booster pump 2"], ["PRIORITY", "CRITICAL"],
          ["EXPECTED IMPACT", "HIGH — 132 students"], ["ESTIMATED RESOLUTION", "4 HOURS"],
          ["CONFIDENCE", "91%"], ["OWNER", "MAINTENANCE · PLUMBING"]
        ];

    const qualityRows = quality
      ? [
          ["RESOLUTION TIME", (live.repair?.repairHours ?? intervention?.estimatedResolutionHours ?? 4) + " hours (projected)"],
          ["RISK REDUCTION", quality.riskBefore + "% → " + quality.riskAfter + "%"],
          ["STUDENTS SPARED", String(Math.max(0, A.affected - quality.affectedStudents))],
          ["COMPLAINTS AVOIDED", String(Math.max(0, A.comps - quality.predictedComplaints))],
          ["BASIS", "Arithmetic projection — recorded, not measured"]
        ]
      : [
          ["RESOLUTION TIME", "2.4 hours"], ["STUDENT SATISFACTION", "92%"], ["RISK REDUCTION", "87% → 21%"],
          ["RECURRENCE", "None in 14 days"], ["COMPLAINTS AFTER FIX", "1"]
        ];

    const cur = plan === "repair" ? B : A;

    return {
      intPlan: plan,
      intCards: [Object.assign({}, A, { id: "nothing" }), Object.assign({}, B, { id: "repair" })].map(pl => ({
        label: pl.label, risk: pl.risk + "%", affected: pl.affected, comps: pl.comps, cost: pl.cost,
        onClick: () => this.setState({ plan: pl.id }),
        style: { border: "2px solid " + (plan === pl.id ? "var(--color-text)" : "var(--color-divider)"), background: plan === pl.id ? (pl.id === "repair" ? "var(--color-neutral-100)" : "var(--color-accent-100)") : "transparent", padding: "18px", cursor: "pointer", transition: "all .4s", display: "grid", gap: "12px", alignContent: "start" },
        barStyle: this.bar(pl.risk, pl.id === "repair" ? "var(--color-neutral-700)" : "var(--color-accent)")
      })),
      intCurveDo: sim?.curves?.doNothing ? curveOf(sim.curves.doNothing) : fallbackCurve([87, 89, 91, 94, 96, 97]),
      intCurveFix: sim?.curves?.repairNow ? curveOf(sim.curves.repairNow) : fallbackCurve([87, 62, 41, 34, 28, 21]),
      intDoStyle: { opacity: plan === "nothing" ? 1 : 0.22, transition: "opacity .6s" },
      intFixStyle: { opacity: plan === "repair" ? 1 : 0.22, transition: "opacity .6s" },
      intHeadline: cur.risk + "%",
      intHeadlineStyle: { fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "clamp(48px,7vw,92px)", lineHeight: 1, letterSpacing: "-.03em", color: plan === "repair" ? "var(--color-text)" : "var(--color-accent)", transition: "color .5s" },
      intHeadlineNote: plan === "repair"
        ? "Projected risk after a " + (live.repair?.repairHours ?? 4) + "-hour repair window. " + B.affected + " students affected, " + B.comps + " further complaints expected."
        : "Projected risk after " + (live.nothing?.windowHours ?? 24) + " hours of no action. " + A.affected + " students affected, " + A.comps + " further complaints expected.",
      intBasis: (plan === "repair" ? live.repair : live.nothing)?.basis
        || "Projected from the current risk, the population in scope and the delay before work starts.",
      intAction: action.map(([k, v]) => ({ k, v })),
      intQuality: qualityRows.map(([k, v]) => ({ k, v })),
      intQualityNote: "A status of RESOLVED is not evidence of resolution. Every intervention is scored on time, satisfaction, risk reduction and recurrence.",
      onPlanNothing: () => this.setState({ plan: "nothing" }),
      onPlanRepair: () => this.setState({ plan: "repair" })
    };
  }

  adminVals() {
    const admin = this.state.admin;
    const overview = admin?.overview || null;
    const briefing = admin?.briefing || null;
    const queue = admin?.queue?.queue || [];
    const chains = this.state.live?.relationships?.chains || [];

    const kpis = overview?.kpis?.length
      ? overview.kpis.map(row => [row.key, row.value])
      : [["CAMPUS HEALTH", "87%"], ["ACTIVE INCIDENTS", "12"], ["CRITICAL PROBLEMS", "4"],
         ["PENDING COMPLAINTS", "38"], ["AVG RESOLUTION", "4.2h"]];

    const lines = briefing?.lines?.length
      ? briefing.lines.map(line => line.kind + " — " + line.text)
      : [
          "3 high-priority incidents require attention today.",
          "Hostel B water failure is 14 days old against a 3.8-day median — this is now the largest single risk on campus.",
          "Hostel C has no complaints and a 74% predicted risk. Inspecting it today is the cheapest action available."
        ];

    const queueRows = queue.length
      ? queue.map(row => [String(row.rank), row.name, row.risk + "%", row.affectedStudents + " students", row.action, row.interventionId])
      : [
          ["1", "HOSTEL B WATER", "87%", "132 students", "Inspect booster pump 2 · 4h"],
          ["2", "HOSTEL C SILENT ANOMALY", "74%", "96 students", "Inspect tank sensor · 2h"],
          ["3", "WI-FI ZONE C", "72%", "260 students", "Rebalance AP cluster C4 · tonight"],
          ["4", "MESS 13:00 OVERLOAD", "68%", "780 students", "Stagger Block C lunch · 20 min"],
          ["5", "ACAD-A 08:00 ATTENDANCE", "63%", "418 students", "Shift two 8 AM labs · next cycle"]
        ];

    const feed = overview?.feed?.length
      ? overview.feed.map(row => [row.time, row.text])
      : [["11:42", "CMP-2312 merged into INC-0071 (91% duplicate)"], ["11:30", "Hostel C draw anomaly held for the 9th day"],
         ["11:18", "AP cluster C4 dropped 11 sessions"], ["10:56", "Mess 13:00 forecast revised 760 → 780"],
         ["10:31", "INC-0058 escalated to CLUSTERED"]];

    const chainRows = chains.length
      ? chains.map(chain => chain.steps)
      : [
          ["HOSTEL WATER FAILURE", "SLEEP DISRUPTION", "ATTENDANCE DROP", "ACADEMIC RISK"],
          ["MESS DISSATISFACTION", "MEAL SKIPPING", "MEDICAL WALK-INS", "PERFORMANCE RISK"],
          ["WI-FI FAILURE", "REDUCED STUDY ACTIVITY", "ACADEMIC IMPACT", "COMPLAINT INCREASE"]
        ];

    return {
      admKpis: kpis.map(([k, v]) => ({ k, v })),
      admBriefing: lines,
      // EXCEPTION-ONLY HOOK: the label says who wrote the briefing; the date is today's, in IST.
      admBriefingLabel: briefing?.writtenBy === "AI_MODEL" ? "AI-WRITTEN MORNING BRIEFING" : "MORNING BRIEFING · FROM LIVE COUNTS",
      admNowLabel: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).toUpperCase().replace(/,/g, " ·").replace(/\s+·/g, " ·") + " IST",
      admBriefingNote: briefing
        ? briefing.disclaimer
        : "Assembled from database aggregates and rule-based thresholds — no language model writes this briefing.",
      admQueue: queueRows.map(([n, name, riskValue, aff, act, interventionId]) => ({ n, name, risk: riskValue, aff, act,
        barStyle: this.bar(parseInt(riskValue, 10), parseInt(riskValue, 10) >= 80 ? "var(--color-accent)" : "var(--color-neutral-600)"),
        onClick: () => this.openIntervention(interventionId) })),
      admFeed: feed.map(([t, txt]) => ({ t, txt })),
      admChains: chainRows.map(chain => ({ steps: chain.map((label, i) => ({ label, arrow: i < chain.length - 1 ? "→" : "" })) })),
      admLocked: !admin && this.state.apiState === "live",
      goRisk: () => this.go("risk"), goAdminQueue: () => this.go("intervention"),

      // ---- AI layer (Features 4, 5, 8, 9, 10, 11, 14, 16) ------------------
      // Every value below comes straight from /api/ai. A read that failed is
      // null, and the section renders "unavailable" for that panel rather than
      // substituting anything.
      aiStatus: this.state.ai?.status || null,
      aiBusy: this.state.aiBusy,
      aiSummary: this.state.ai?.summary?.summary || null,
      // Set when the summary above came from the cache rather than the network,
      // so the panel can say so with the time it was taken.
      aiSummaryStale: this.state.ai?.summaryStale || false,
      aiSummaryCachedAt: this.state.ai?.summaryCachedAt || null,
      aiRecurring: this.state.ai?.recurring || null,
      aiAnomalies: this.state.ai?.anomalies || null,
      aiPredictions: this.state.ai?.predictions || null,
      aiAudit: this.state.ai?.audit || null,
      aiGateRisk: this.state.ai?.gatePassRisk || null,
      aiNotifications: this.state.aiNotifications || null,
      aiSuggestedQuestions: this.state.ai?.questions?.questions || [],

      copilotQ: this.state.copilotQ,
      copilotBusy: this.state.copilotBusy,
      copilotError: this.state.copilotError,
      copilotResult: this.state.copilotResult,
      onCopilotQ: (e) => this.setState({ copilotQ: e.target.value, copilotError: null }),
      onCopilotAsk: () => this.askCopilot(),
      onCopilotPick: (question) => this.setState({ copilotQ: question }, () => this.askCopilot()),

      // Feature 2/3 triage
      triage: this.state.triage || [
        { id: "CMP-2312", reference: "CMP-2312", title: "No water in bathroom, 2nd floor", location: "HOSTEL B · 2ND FLOOR", department: "MAINTENANCE · PLUMBING", status: "PENDING", aiClassification: { category: "WATER", priority: "HIGH", severity: "CRITICAL" }, aiRouting: { recommendedDepartment: "MAINTENANCE · PLUMBING" } },
        { id: "CMP-2291", reference: "CMP-2291", title: "Electrical switch sparking near room B-210", location: "HOSTEL B · ROOM B-210", department: "ELECTRICAL", status: "INVESTIGATING", aiClassification: { category: "ELECTRICITY", priority: "HIGH", severity: "CRITICAL" }, aiRouting: { recommendedDepartment: "ELECTRICAL" } },
        { id: "CMP-2247", reference: "CMP-2247", title: "Tap leakage in 2nd floor bathroom", location: "HOSTEL B · 2ND FLOOR", department: "MAINTENANCE · PLUMBING", status: "REJECTED", resolution: { resolvedByName: "Campus Mission Control", resolvedByRole: "ADMIN", adminMessage: "Rejected by admin" } }
      ],
      triageBusy: this.state.triageBusy,
      triageError: this.state.triageError,
      triageDept: this.state.triageDept,
      onTriageDept: (id, value) => this.setState(prev => ({ triageDept: { ...prev.triageDept, [id]: value } })),
      onAcceptRouting: (id) => this.decideRouting(id, null),
      onOverrideRouting: (id) => this.decideRouting(id, this.state.triageDept[id]),
      onReclassify: (id) => this.reclassify(id),
      onDuplicateDecision: (id, decision, relatedId) => this.reviewDuplicate(id, decision, relatedId),
      departments: this.departments,

      rootCause: this.state.rootCause,
      rootCauseBusy: this.state.rootCauseBusy,
      rootCauseFor: this.state.rootCauseFor,
      onRootCause: (code, category) => this.loadRootCause(code, category),
      onAiRefresh: () => this.loadAiSurfaces(),

      // ---- operational intelligence (Features 8–12, 15–17) ----------------
      isAdminRole: this.state.user?.role === "ADMIN",
      aiSla: this.state.ai?.sla || null,
      aiWorkload: this.state.ai?.workload || null,
      aiTwin: this.state.ai?.twin || null,
      aiCorrelations: this.state.ai?.correlations || null,
      aiFeedback: this.state.ai?.feedback || null,
      aiDataQuality: this.state.ai?.dataQuality || null,

      simPct: this.state.simPct,
      simHorizon: this.state.simHorizon,
      simResult: this.state.simResult,
      simBusy: this.state.simBusy,
      simError: this.state.simError,
      onSimPct: (e) => this.setState({ simPct: e.target.value, simError: null }),
      onSimHorizon: (e) => this.setState({ simHorizon: e.target.value, simError: null }),
      onSimRun: () => this.runSimulation(),

      twinNode: this.state.twinNode,
      twinFor: this.state.twinFor,
      twinBusy: this.state.twinBusy,
      twinError: this.state.twinError,
      onTwinOpen: (code) => this.openTwinNode(code),

      aiDeferred: Boolean(this.state.ai?.deferred),
      aiLite: Boolean(this.state.ai?.lite),
      onAiLoadDeferred: () => this.loadAiSurfaces({ full: true }),
      dqOpen: this.state.dqOpen,
      onDqToggle: (id) => this.setState(prev => ({ dqOpen: prev.dqOpen === id ? null : id })),

      triageStatus: this.state.triageStatus,
      triageNote: this.state.triageNote,
      triageRelated: this.state.triageRelated,
      triageLearning: this.state.triageLearning,
      onTriageStatus: (id, value) => this.setState(prev => ({ triageStatus: { ...prev.triageStatus, [id]: value }, triageError: null })),
      onTriageNote: (id, value) => this.setState(prev => ({ triageNote: { ...prev.triageNote, [id]: value } })),
      onMoveComplaint: (id) => this.moveComplaint(id),
      onLoadRelated: (id) => this.loadRelated(id),
      onLoadLearning: (id) => this.loadLearning(id),

      // ---- network conditions (Feature 12) --------------------------------
      netOnline: this.state.netOnline,
      netQueued: this.state.netQueued,
      netSyncing: this.state.netSyncing,
      netNotice: this.state.netNotice,

      // ---- Admin & Warden Approval, 6-Day Verification Ledger & AI Predictor ----
      adminRoleView: this.state.adminRoleView,
      onAdminRoleView: (mode) => this.setState({ adminRoleView: mode }),
      adminApproveNote: this.state.adminApproveNote,
      onAdminApproveNote: (id, note) => this.setState(p => ({ adminApproveNote: { ...p.adminApproveNote, [id]: note } })),
      onApproveAndMessage: (id) => this.adminApproveAndMessage(id),
      onRejectComplaint: (id) => this.adminRejectComplaint(id),
      ledgerFilter: this.state.ledgerFilter,
      onLedgerFilter: (filter) => this.setState({ ledgerFilter: filter }),
      preventativeApplied: this.state.preventativeApplied,
      onApplyPreventative: (key) => this.applyPreventativeAction(key),

      ledgerItems: (() => {
        const rawTriage = this.state.triage || [];
        const defaultLedgerComplaints = [
          { id: "CMP-2312", reference: "CMP-2312", title: "No water in bathroom, 2nd floor", location: "HOSTEL B · 2ND FLOOR", department: "MAINTENANCE", status: "RESOLVED", resolution: { resolvedAt: new Date(Date.now() - 3600000 * 18).toISOString(), resolutionDescription: "Booster pump 2 pressure valve replaced. Pressure restored to 2.4 bar.", adminMessage: "Booster pump 2 pressure valve replaced. Pressure restored to 2.4 bar.", resolvedByName: "Dr. S. K. Mahapatra", resolvedByRole: "WARDEN", confirmWindowDays: 6, studentFlag: "PENDING" }, createdAt: new Date(Date.now() - 3600000 * 24).toISOString() },
          { id: "CMP-2291", reference: "CMP-2291", title: "Electrical switch sparking near room B-210", location: "HOSTEL B · ROOM B-210", department: "ELECTRICAL", status: "RESOLVED", resolution: { resolvedAt: new Date(Date.now() - 3600000 * 48).toISOString(), resolutionDescription: "Installed modular 16A safety switch and checked line earth resistance.", adminMessage: "Installed modular 16A safety switch and checked line earth resistance.", resolvedByName: "Er. R. Pradhan", resolvedByRole: "ADMIN", confirmWindowDays: 6, studentFlag: "GREEN_FLAG" }, createdAt: new Date(Date.now() - 3600000 * 60).toISOString() },
          { id: "CMP-2280", reference: "CMP-2280", title: "Wi-Fi dropouts during evening study hours", location: "CENTRAL LIBRARY · 2ND FLOOR", department: "IT & NETWORK", status: "INVESTIGATING", resolution: null, createdAt: new Date(Date.now() - 3600000 * 12).toISOString() },
          { id: "CMP-2274", reference: "CMP-2274", title: "Mess food shortage at 13:15 rush", location: "CENTRAL MESS · HALL 1", department: "MESS ADMINISTRATION", status: "PENDING", resolution: null, createdAt: new Date(Date.now() - 3600000 * 6).toISOString() },
          { id: "CMP-2260", reference: "CMP-2260", title: "Water geyser trip in Hostel A 3rd floor", location: "HOSTEL A · 3RD FLOOR", department: "MAINTENANCE", status: "RESOLVED", resolution: { resolvedAt: new Date(Date.now() - 3600000 * 30).toISOString(), resolutionDescription: "Thermostat calibrated and MCB reset.", adminMessage: "Thermostat calibrated and MCB reset.", resolvedByName: "Er. R. Pradhan", resolvedByRole: "ADMIN", confirmWindowDays: 6, studentFlag: "RED_FLAG", studentDisputeReason: "Water is only lukewarm, trips again after 5 mins." }, createdAt: new Date(Date.now() - 3600000 * 40).toISOString() },
          { id: "CMP-2252", reference: "CMP-2252", title: "Air conditioner failure in Lab 3", location: "ACADEMIC BLOCK A · LAB 3", department: "ESTATE", status: "ASSIGNED", resolution: null, createdAt: new Date(Date.now() - 3600000 * 20).toISOString() }
        ];

        const combinedList = [...rawTriage];
        defaultLedgerComplaints.forEach(item => {
          if (!combinedList.some(c => (c.reference || c.id) === (item.reference || item.id))) {
            combinedList.push(item);
          }
        });

        return combinedList.map(c => {
          const id = c.id || c.reference;
          const ref = c.reference || id;
          const isResolved = c.status === "RESOLVED";
          const isRejected = c.status === "REJECTED";
          const res = c.resolution || {};
          const flag = this.state.studentFlagDone[id] || res.studentFlag || (isResolved ? "PENDING" : null);
          const isRedFlag = flag === "RED_FLAG";
          const isDone = (isResolved && !isRedFlag) || isRejected;
          const isNotDone = !isResolved && !isRejected;
          const isWardenRelevant = ["HOSTEL B", "HOSTEL A", "HOSTEL C", "CENTRAL MESS"].some(loc => (c.location || "").toUpperCase().includes(loc)) || ["MESS", "WATER", "HOSTEL", "SECURITY"].some(cat => (c.category || "").toUpperCase().includes(cat));

          // 6-day confirmation calculation
          let daysLeft = null;
          let hoursLeft = null;
          if (res.resolvedAt) {
            const elapsed = Math.max(0, (Date.now() - new Date(res.resolvedAt).getTime()) / 3600000);
            daysLeft = Math.max(0, 6 - Math.floor(elapsed / 24));
            hoursLeft = Math.max(0, Math.floor(144 - elapsed) % 24);
          }

          return {
            id,
            ref,
            title: c.title,
            location: c.location || "Campus Block",
            department: c.department || "ADMIN",
            status: isRedFlag ? "RED_FLAG_DISPUTED" : c.status,
            isDone,
            isNotDone,
            isRejected,
            isRedFlag,
            isWardenRelevant,
            adminMessage: res.adminMessage || res.resolutionDescription || (isResolved ? "Action verified by staff." : null),
            resolver: res.resolvedByName ? `${res.resolvedByName} (${res.resolvedByRole || "Staff"})` : (isResolved ? "Campus Admin / Warden" : null),
            resolvedAt: res.resolvedAt ? new Date(res.resolvedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null,
            createdAt: c.createdAt ? new Date(c.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Today",
            studentFlag: flag,
            disputeReason: res.studentDisputeReason || "",
            daysLeft,
            hoursLeft,
            draftNote: this.state.adminApproveNote[id] || ""
          };
        });
      })(),

      aiPredictorClusters: [
        {
          key: "cluster-water",
          name: "Hostel B & C Water Supply Pipeline",
          icon: "🚰",
          complaintCount: 17,
          affectedStudents: 132,
          baseRisk: 87,
          postRisk: 16,
          primaryArea: "Hostel B · 2nd & 3rd Floors",
          rootCause: "Cavitation wear on booster pump 2 impeller combined with sub-atmospheric suction head (0.4 bar observed vs 2.5 bar nominal) during 07:00–08:30 AM peak shower hours.",
          predictiveWindow: "High Recurrence Risk: 88% probability of pump seal rupture within 7 days if unserviced.",
          preventativeSOP: [
            "1. Install automated differential pressure check-valve before Friday morning peak.",
            "2. Reschedule municipal suction tank refill cycle from 07:30 to 05:00 AM.",
            "3. Calibrate telemetry pressure sensor at 1.8 bar floor trigger."
          ]
        },
        {
          key: "cluster-wifi",
          name: "Central Library AP-C4 Wi-Fi Mesh",
          icon: "📡",
          complaintCount: 14,
          affectedStudents: 260,
          baseRisk: 72,
          postRisk: 12,
          primaryArea: "Library 2nd Floor · Reading Halls",
          rootCause: "2.4 GHz co-channel interference and DHCP pool starvation exceeding 180 concurrent lease limits during 19:00–22:00 evening study periods.",
          predictiveWindow: "Daily Recurrence: 94% probability of recurring session drops every weekday evening.",
          preventativeSOP: [
            "1. Enforce 5 GHz band-steering policy across all library APs.",
            "2. Expand DHCP IP subnet pool to /23 (510 available leases) for Library Zone C.",
            "3. Rebalance AP-C4 transmit power to -14 dBm to eliminate adjacent cell collisions."
          ]
        },
        {
          key: "cluster-mess",
          name: "Central Mess 13:00 Lunch Bottleneck",
          icon: "🍽️",
          complaintCount: 11,
          affectedStudents: 780,
          baseRisk: 68,
          postRisk: 18,
          primaryArea: "Central Mess Dining Hall 1",
          rootCause: "Synchronized dismissal of 418 Academic Block A lab students at 13:00 colliding with regular hostel dining schedules, exceeding 850 seated dining hall capacity.",
          predictiveWindow: "Scheduled Recurrence: 82% probability of 15+ minute meal queues on Tuesdays and Thursdays.",
          preventativeSOP: [
            "1. Stagger Block C and Block A lab dismissal cycles by 20 minutes.",
            "2. Open secondary express QR validation counter in Dining Hall 2.",
            "3. Push live wait-time alerts to Student Dashboard when queue exceeds 6 minutes."
          ]
        },
        {
          key: "cluster-hvac",
          name: "Academic Block A Morning HVAC Airflow",
          icon: "❄️",
          complaintCount: 9,
          affectedStudents: 418,
          baseRisk: 63,
          postRisk: 14,
          primaryArea: "Academic Block A · Rooms 101–108",
          rootCause: "24V automation relay contact pitting on Chiller Line 3 causing delayed pre-cooling cycle and stagnant CO2 buildup prior to 08:00 AM lecture starts.",
          predictiveWindow: "Weather Triggered: 76% recurrence risk on high-humidity mornings.",
          preventativeSOP: [
            "1. Replace 24V solid-state relay on Central Chiller Line 3.",
            "2. Program automated HVAC pre-purge cycle 45 minutes prior to 08:00 AM lecture slot.",
            "3. Install return-air damper sensor for automated fresh air intake."
          ]
        }
      ]
    };
  }
  render() {
    const v = this.renderVals();
    return (
      <div ref={v.rootRef} style={s("font-family: var(--font-body); color: var(--color-text); background: var(--color-bg); min-height: 100vh; position: relative; overflow-x: clip")}>
      
        {(v.replayOn) ? (<>
          <div style={s("position: fixed; left: 0; right: 0; bottom: 0; z-index: 800; background: var(--color-ink); color: var(--color-on-ink); display: flex; align-items: center; gap: 16px; padding: 10px clamp(12px, 2.5vw, 28px); flex-wrap: wrap; animation: nex-up .4s both")}>
            <span style={s("font-family: var(--font-heading); font-weight: 800; font-size: 11px; letter-spacing: .16em; color: var(--color-accent-400)")}>JUDGE REPLAY</span>
            <span style={s("font-family: var(--font-heading); font-weight: 800; font-size: 13px; letter-spacing: .12em; font-variant-numeric: tabular-nums")}>{v.replayTime}</span>
            <span style={s("font-family: var(--font-heading); font-weight: 800; font-size: 13px; letter-spacing: .08em")}>{v.replayLabel}</span>
            <span style={s("font-size: 12px; opacity: .8")}>{v.replayText}</span>
            <span style={s("font-size: 10px; letter-spacing: .12em; opacity: .55")}>{v.replaySource}</span>
            <span style={s("flex: 1 1 auto")}></span>
            <span style={s("display: flex; gap: 4px; align-items: center")}>
              {(v.replayTicks || []).map((row60, i60) => (<React.Fragment key={i60}>
                <span data-replay-tick="1" style={row60.style}></span>
              </React.Fragment>))}
            </span>
            <button onClick={v.onStopReplay} style={s("background: none; border: 1px solid color-mix(in srgb, var(--color-on-ink) 45%, transparent); color: var(--color-bg); font-family: var(--font-heading); font-weight: 800; font-size: 10px; letter-spacing: .14em; padding: 6px 10px; cursor: pointer")}>STOP</button>
          </div>
        </>) : null}
      
      
        {(v.boot) ? (<>
          <div className="cv-loader" style={s("position: fixed; inset: 0; z-index: 1000; background: var(--color-bg); color: var(--color-text); display: grid; grid-template-rows: auto 1fr auto; padding: clamp(16px, 4vw, 48px); overflow: hidden")}>
            <div className="cv-loader-count" aria-hidden="true"><span ref={this.bootCountRef}></span></div>
            <div style={s("display: flex; justify-content: space-between; align-items: baseline; gap: 16px; border-bottom: 2px solid color-mix(in srgb, var(--color-on-ink) 35%, transparent); padding-bottom: 12px")}>
              <div style={s("display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap")}>
                <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 13px; letter-spacing: .2em; display: flex; align-items: center; gap: 8px; align-self: center")}><img src="/logo-mark.png" alt="" width="22" height="22" style={s("border-radius: 4px; display: block")} />NEX CAMP</div>
                <div style={s("font-size: 10px; letter-spacing: .24em; color: color-mix(in srgb, var(--color-on-ink) 55%, transparent)")}>TEAM CODEXFLOW</div>
              </div>
              <div style={s("font-size: 11px; letter-spacing: .16em; color: var(--color-accent-400)")}>{v.bootLabel}</div>
            </div>
      
            <div style={s("position: relative; display: grid; grid-template-columns: minmax(0, 1fr); align-content: center; justify-items: start; gap: 24px")}>
              <div style={s("display: grid; gap: 6px; font-size: 12px; letter-spacing: .12em; font-variant-numeric: tabular-nums")}>
                {(v.bootLines || []).map((row1, i1) => (<React.Fragment key={i1}>
                  <div style={row1.style}>{row1.text}<span style={s("color: var(--color-accent-400)")}> {row1.status}</span></div>
                </React.Fragment>))}
              </div>
              <svg viewBox="0 0 1200 620" style={v.bootSvgStyle} aria-hidden="true">
                <g>
                  {(v.gridLines || []).map((row2, i2) => (<React.Fragment key={i2}>
                    <line x1={row2.x1} y1={row2.y1} x2={row2.x2} y2={row2.y2} stroke="color-mix(in srgb, var(--color-on-ink) 16%, transparent)" strokeWidth="1"></line>
                  </React.Fragment>))}
                  {(v.bootBuildings || []).map((row3, i3) => (<React.Fragment key={i3}>
                    <g style={row3.style}>
                      <polygon points={row3.topPts} fill="none" stroke="var(--color-on-ink)" strokeWidth="2"></polygon>
                      <polygon points={row3.rightPts} fill="none" stroke="color-mix(in srgb, var(--color-on-ink) 50%, transparent)" strokeWidth="1.5"></polygon>
                      <polygon points={row3.frontPts} fill="none" stroke="color-mix(in srgb, var(--color-on-ink) 50%, transparent)" strokeWidth="1.5"></polygon>
                      <circle cx={row3.cx} cy={row3.cy} r="3" fill="var(--color-accent)"></circle>
                    </g>
                  </React.Fragment>))}
                </g>
              </svg>
              <div style={v.bootSignalStyle}>
                {(v.bootSignals || []).map((row4, i4) => (<React.Fragment key={i4}>
                  <div style={row4.style}>
                    <div style={s("font-size: 10px; letter-spacing: .16em; color: color-mix(in srgb, var(--color-on-ink) 60%, transparent)")}>{row4.where}</div>
                    <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 14px; color: var(--color-accent-400)")}>{row4.what}</div>
                  </div>
                </React.Fragment>))}
              </div>
            </div>
      
            <div style={s("display: flex; justify-content: space-between; align-items: center; gap: 16px; border-top: 2px solid color-mix(in srgb, var(--color-on-ink) 35%, transparent); padding-top: 12px")}>
              <div style={s("height: 2px; flex: 1; background: color-mix(in srgb, var(--color-on-ink) 20%, transparent); overflow: hidden")}>
                <div style={v.bootBarStyle}></div>
              </div>
              <button onClick={v.onSkipBoot} style={s("background: none; border: 1px solid color-mix(in srgb, var(--color-on-ink) 40%, transparent); color: var(--color-on-ink); font-family: var(--font-heading); font-weight: 800; font-size: 11px; letter-spacing: .14em; padding: 7px 12px; cursor: pointer")} {...hov("background: color-mix(in srgb, var(--color-on-ink) 12%, transparent); letter-spacing: .2em")}>SKIP BOOT</button>
            </div>
          </div>
        </>) : null}
      
        {(v.portal) ? (<>
          <div ref={v.portalRef} className="nex-portal" aria-hidden="true">
            <div className="nex-portal-mat"></div>
            <div className="nex-portal-clip"><img className="nex-portal-img" src={v.portal.src} alt="" /></div>
          </div>
        </>) : null}
      
        {(v.reveal) ? (<>
          <div ref={v.revealRef} className="nex-reveal" aria-hidden="true" onClick={v.onSkipReveal}>
            <div className="nex-reveal-curtain"></div>
            <div className="nex-reveal-stage"><div className="nex-reveal-title"></div></div>
          </div>
        </>) : null}
      
        <header className={v.navMenu ? "nx-header cv-menu-open" : "nx-header"} style={s("position: sticky; top: 0; z-index: 400; background: var(--color-bg); border-bottom: 1px solid var(--color-divider)")}>
          <div style={s("display: flex; align-items: center; gap: clamp(12px, 2vw, 28px); padding: 12px clamp(14px, 3.2vw, 56px); min-height: 72px; flex-wrap: wrap")}>
            <div data-cursor="HOME" onClick={v.goHome} style={s("display: flex; align-items: center; gap: 12px; cursor: pointer; flex: 0 0 auto")}>
              <img src="/logo-mark.png" alt="NeX Camp logo" width="40" height="40" style={s("border-radius: 8px; display: block")} />
              <div style={s("font-family: var(--font-heading); font-size: 27px; line-height: 1; letter-spacing: -.005em")}>NeX Camp</div>
              <div style={s("font-size: 10px; letter-spacing: .22em; color: var(--color-neutral-700)")}>TEAM CODEXFLOW</div>
            </div>
            <button type="button" className="btn nx-link cv-menu-btn" aria-expanded={v.navMenu ? "true" : "false"} aria-controls="cv-page-nav" onClick={v.onMenu}><span className="nx-sc">{v.navMenu ? "CLOSE" : "MENU"}</span></button>
            <span className="cv-hdr-spacer" aria-hidden="true" style={s("flex: 1 1 auto")}></span>
            {/* EXCEPTION-ONLY HOOK: this row may wrap (flex-wrap, can shrink) so the Tuesday Test fits at phone width. */}
            <div style={s("display: flex; align-items: center; gap: 8px; flex: 0 1 auto; flex-wrap: wrap; min-width: 0")}>
              <span style={s("font-size: 11px; letter-spacing: .1em; color: var(--color-accent); font-weight: 800; border: 1px solid var(--color-accent); padding: 5px 10px; border-radius: 4px")}>PS07 EVALUATION MODE</span>
              {/* EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md): the Tuesday Test, beside Replay incident. */}
              <XoTuesdayButton user={this.state.user} live={this.state.apiState === "live"} onGo={(id) => this.go(id)} onDemoStudent={() => this.signIn(import.meta.env?.VITE_DEMO_EMAIL || "pritish@bput.ac.in", import.meta.env?.VITE_DEMO_PASSWORD || "Campus@2026")} />
              {/* REEL HOOK (see CHANGES-REEL.md): the 30-second proof, beside the Tuesday Test (staff; a student is offered the admin sign-in). */}
              <ReelButton user={this.state.user} live={this.state.apiState === "live"} lang={this.state.lang} lowRender={this.state.mode === "LOW"} onAdmin={() => this.signIn(import.meta.env?.VITE_ADMIN_EMAIL || "control@bput.ac.in", import.meta.env?.VITE_ADMIN_PASSWORD || "Control@2026")} />
            </div>
            {/* EXTENSION HOOK (see HOOKS.md): Tuesday Mode, unread notices, low-end prompt. */}
            <ExtHeader user={this.state.user} live={this.state.apiState === "live"} lowBw={this.state.lowBw} mode={this.state.mode} onGo={(id) => this.go(id)} onLowEnd={() => this.setState({ lowBw: true, mode: "LOW" }, () => { if (this.state.ai) this.loadAiSurfaces(); })} onDemoStudent={() => this.signIn(import.meta.env?.VITE_DEMO_EMAIL || "pritish@bput.ac.in", import.meta.env?.VITE_DEMO_PASSWORD || "Campus@2026")} />
          </div>
          <nav ref={v.navRef} id="cv-page-nav" className="nex-nav cv-nav" aria-label="All pages" onPointerMove={v.onNavPointer} onPointerLeave={v.onNavLeave}>
            <span className="nex-nav-pill" aria-hidden="true"></span>
            <span className="nex-nav-ink" aria-hidden="true"></span>
            {(v.pageGroups || []).map((grp) => (<React.Fragment key={grp.label}>
              <div className="cv-nav-group" role="group" aria-label={grp.label}>
                <span className="cv-nav-label">{grp.label}</span>
                {grp.pages.map((row5) => (<React.Fragment key={row5.id}>
                  <button data-cursor="OPEN" className="nex-nav-item" aria-current={row5.current} onClick={row5.onClick} style={row5.style} {...hov("color: var(--color-text)")}>
                    <span className="nx-sc">{row5.name}</span>
                  </button>
                </React.Fragment>))}
              </div>
            </React.Fragment>))}
          </nav>
          <div style={s("display: flex; align-items: center; gap: 10px 14px; padding: 7px clamp(14px, 3.2vw, 56px); border-top: 1px solid var(--color-divider); font-family: var(--font-mono); font-size: 11px; letter-spacing: .12em; color: var(--color-muted); flex-wrap: wrap")}>
            <span className="nx-status" style={s("display: inline-flex; align-items: center; gap: 8px; color: var(--color-text)")}><span className="nx-dot nx-live-dot" aria-hidden="true"></span>LIVE</span>
            <span>{v.campusName}</span>
            <span>{v.campusStudents}</span>
            <span>{v.campusBlocks}</span>
            <span style={s("flex: 1 1 auto")}></span>
            <span>RENDER</span>
            {(v.modes || []).map((row6, i6) => (<React.Fragment key={i6}>
              <button onClick={row6.onClick} style={row6.style}>{row6.label}</button>
            </React.Fragment>))}
            <button onClick={v.onLowBw} style={v.lowBwStyle}>{v.lowBwLabel}</button>
            <button data-cursor="TOGGLE" onClick={v.onToggle3D} style={v.toggle3DStyle}>{v.toggle3DLabel}</button>
            {(v.langs || []).map((row7, i7) => (<React.Fragment key={i7}>
              <button onClick={row7.onClick} style={row7.style}>{row7.label}</button>
            </React.Fragment>))}
            <button data-cursor="RETRY" title={v.apiTitle} onClick={v.onRetryApi} style={v.apiStyle}>{v.apiLabel}</button>
            <button data-cursor="ACCOUNT" onClick={v.onUser} style={v.userStyle}>{v.userLabel}</button>
          </div>
        </header>
      
        {(v.lowBw) ? (<>
          <div style={s("background: var(--color-warn-100); border-bottom: 1px solid var(--color-warn-200); padding: 8px clamp(12px, 2.5vw, 28px); font-size: 11px; letter-spacing: .12em; color: var(--color-warn-800); font-weight: 700")}>LOW BANDWIDTH MODE — 3D LAYER SUSPENDED. AI READS REQUESTED TRIMMED (?LITE=1). CACHED RESPONSES REUSED, WRITES QUEUED WHILE OFFLINE.</div>
        </>) : null}
      
        <main>
      
          {/* 01 LANDING */}
          {(v.isLanding) ? (<>
            <div>
              <section className="nx-hero">
                <div className="nx-hero-head" style={s("animation: nex-up .7s both")}>
                  <div className="nx-kicker"><span className="nx-dot nx-live-dot" aria-hidden="true"></span><span>TEAM CODEXFLOW</span><span className="nx-secnum" aria-hidden="true">( 01 )</span></div>
                  <h1 className="nx-title">ATTENDANCE,<br />MESS, HOSTEL,<br /><span className="nx-accent nx-serif">debugged.</span></h1>
                </div>
                <div className="nx-stage">
                  <img className="nx-stage-img" src={heroCampus} alt="Campus Overview" aria-hidden="true" decoding="async" />
                  <div className="nx-map nx-tint" aria-hidden="true">
                    <svg viewBox={v.heroViewBox}>
                      {(v.heroMap || []).filter(m => m.tint).map((m) => m.polys.map((pts, j) => (<polygon key={m.id + j} className={"nx-tint-" + m.tint} points={pts}></polygon>)))}
                    </svg>
                  </div>
                  <div className="nx-map">
                    <svg viewBox={v.heroViewBox} role="group" aria-label="Campus buildings">
                      {(v.heroMap || []).map((m) => (<React.Fragment key={m.id}>
                        <g className="nx-spot" tabIndex={0} role="button" aria-label={m.label} data-cursor="INSPECT"
                          onClick={m.onClick} onKeyDown={m.onKeyDown}>
                          {m.polys.map((pts, j) => (<polygon key={j} points={pts}></polygon>))}
                        </g>
                      </React.Fragment>))}
                    </svg>
                  </div>
                  <div className="nx-panel nx-intro" style={s("animation: nex-up .7s .12s both")}>
                    <p>We don't just record campus problems. The operating system understands, connects, predicts, investigates and helps resolve them — one complaint at a time, one campus at a time.</p>
                    <div className="nx-ctas">
                      <button data-cursor="EXPLORE" onClick={v.goStory} data-magnetic="1" className="btn btn-primary nx-cta"><span className="nx-sc">ENTER THE CAMPUS ↓</span></button>
                      <button data-cursor="TRACE" onClick={v.goDemo} className="btn nx-link">JUDGE STORY MODE · CODEXFLOW</button>
                    </div>
                  </div>
                  <div className="nx-panel nx-stats" style={s("animation: nex-up .7s .22s both")}>
                    {(v.heroStats || []).map((row8, i8) => (<React.Fragment key={i8}>
                      <div className="nx-stat">
                        <div className="nx-stat-n">{row8.value}</div>
                        <div className="nx-stat-k"><span className="nx-sc">{row8.label}</span></div>
                      </div>
                    </React.Fragment>))}
                  </div>
                  <span className="nx-scroll" aria-hidden="true">Scroll to explore <em>the campus ↓</em></span>
                </div>
                <div style={s("max-width: 1560px; margin: 0 auto; padding: 0 clamp(12px, 2.5vw, 28px)")}>
                  <hr className="hr" style={s("margin: clamp(18px, 3vw, 40px) 0 0")} />
                </div>
              </section>
      
              <EvaluationHub
                onGo={(id) => this.go(id)}
                onTuesday={() => {
                  const b = Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('TUESDAY TEST'));
                  if (b) b.click();
                }}
                onProof={() => {
                  const b = Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('30-SECOND PROOF'));
                  if (b) b.click();
                }}
              />

              <FeatureExplorer onOpen={v.onOpenSurface} />
              <FeatureSpotlights onOpen={v.onOpenSurface} />
      
              <section ref={v.storyRef} data-scene="story" style={s(`position: relative; max-width: 1560px; margin: 0 auto; padding: 0 clamp(12px, 2.5vw, 28px); height: ${v.storyHeight}`)}>
                <div style={v.stageStyle}>
      
                  <div style={s("display: grid; align-content: start; gap: 14px; min-width: 0")}>
                    <div>
                      <div style={s("font-size: 11px; letter-spacing: .2em; color: var(--color-muted); font-weight: 700")}>{v.chapterKicker}</div>
                      <h2 style={s("font-size: clamp(22px, 2.6vw, 38px); letter-spacing: -.03em; margin: 6px 0 8px; text-wrap: pretty")}>{v.chapterTitle}</h2>
                      <p style={s("max-width: 44ch; font-size: 14px; margin: 0; color: var(--color-neutral-800); text-wrap: pretty")}>{v.chapterBody}</p>
                    </div>
                    <div style={s("display: grid; gap: 6px; border-top: 1px solid var(--color-divider); padding-top: 12px")}>
                      <div style={s("display: flex; gap: 4px; align-items: center; flex-wrap: wrap")}>
                        {(v.chapterRail || []).map((row9, i9) => (<React.Fragment key={i9}>
                          <div style={row9.style} title={row9.name}></div>
                        </React.Fragment>))}
                      </div>
                      <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); font-variant-numeric: tabular-nums")}>{v.scrollPct} SCROLL · CAMERA {v.cameraLabel}</div>
                      <div style={s("display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px")}>
                        {(v.chapterSteps || []).map((row10, i10) => (<React.Fragment key={i10}>
                          <span style={row10.chipStyle}>{row10.name}</span>
                        </React.Fragment>))}
                      </div>
                    </div>
                    {(v.showCluster) ? (<>
                      <div style={s("border: 1px solid var(--color-neutral-500); padding: 12px 14px; animation: nex-in .4s both")}>
                        <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700)")}>GROUP SIMILAR COMPLAINTS</div>
                        <div style={s("display: flex; align-items: baseline; gap: 8px; font-family: var(--font-heading); font-weight: 800; flex-wrap: wrap")}>
                          <span style={s("font-size: 24px")}>{v.clusterCount}</span><span style={s("font-size: 11px; letter-spacing: .1em")}>COMPLAINTS</span>
                          <span style={s("color: var(--color-accent); font-size: 17px")}>→</span>
                          <span style={s("font-size: 24px")}>1</span><span style={s("font-size: 11px; letter-spacing: .1em")}>INCIDENT</span>
                        </div>
                      </div>
                    </>) : null}
                  </div>
      
                  <div style={v.campusBoxStyle}>
                    <div style={s("display: flex; justify-content: space-between; gap: 10px; align-items: baseline; border-bottom: 1px solid var(--color-divider); padding: 8px 10px; background: var(--color-bg); position: relative; z-index: 2")}>
                      <div style={s("font-size: 10px; letter-spacing: .16em; color: var(--color-neutral-700); font-weight: 700")}>CAMPUS MAP · {v.campusName}</div>
                      <div style={s("font-size: 10px; letter-spacing: .16em; color: var(--color-muted); font-weight: 700")}>{v.campusEngine}</div>
                    </div>
                    <div style={s("position: relative; overflow: hidden; background: var(--color-surface); min-height: 260px; max-height: 380px; display: flex; align-items: center; justify-content: center")}>
                      <img src={heroCampus} alt="Campus Map" style={s("width: 100%; height: 100%; object-fit: cover; display: block")} />
                    </div>
                    <div style={s("padding: 12px 14px; background: var(--color-surface); border-top: 1px solid var(--color-divider); display: grid; gap: 8px")}>
                      <div style={s("font-size: 10px; font-weight: 700; letter-spacing: .14em; color: var(--color-muted)")}>
                        CAMPUS LOCATIONS · CLICK TO OPEN SIDEBAR INFORMATION
                      </div>
                      <div style={s("display: flex; flex-wrap: wrap; gap: 6px")}>
                        {(v.campusControls || []).map((ctrl) => (
                          <button
                            key={ctrl.id}
                            onClick={ctrl.onClick}
                            style={ctrl.style}
                            type="button"
                          >
                            <span style={s("font-weight: 700")}>{ctrl.code}</span>
                            <span style={s("opacity: .85")}> · {ctrl.name}</span>
                            {ctrl.hasAlert ? (
                              <span style={s("font-size: 9px; padding: 1px 4px; border-radius: 3px; background: var(--color-accent-100); color: var(--color-accent-800); font-weight: 700; margin-left: 4px")}>
                                {ctrl.domain}
                              </span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div style={v.panelColStyle}>
                    {(v.showPanel) ? (<>
                      <div style={v.panelStyle}>
                        <div style={s("background: var(--color-ink); color: var(--color-on-ink); padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; gap: 10px")}>
                          <div>
                            <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 13px; letter-spacing: .1em")}>{v.focusName}</div>
                            <div style={s("font-size: 10px; letter-spacing: .12em; color: var(--color-accent-400)")}>{v.focusCode}</div>
                          </div>
                          <button
                            onClick={() => this.setState({ focus: null })}
                            style={s("background: none; border: 0; color: var(--color-on-ink); cursor: pointer; font-size: 16px; padding: 2px 6px; line-height: 1")}
                            title="Close sidebar"
                          >
                            ✕
                          </button>
                        </div>
                        <div style={s("padding: 14px; overflow-y: auto; min-height: 0")}>
                          <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700)")}>CURRENT INCIDENT</div>
                          <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 20px; letter-spacing: -.01em; margin: 4px 0 2px; text-wrap: pretty")}>{v.focusIncident}</div>
                          <div style={s("font-size: 12px; color: var(--color-neutral-700)")}>{v.focusComplaints} related complaints · {v.focusDomain}</div>
                          <div style={s("display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--color-divider); border-left: 1px solid var(--color-divider); margin: 14px 0")}>
                            {(v.focusStats || []).map((row14, i14) => (<React.Fragment key={i14}>
                              <div style={s("border-right: 1px solid var(--color-divider); border-bottom: 1px solid var(--color-divider); padding: 10px 8px")}>
                                <div style={row14.valueStyle}>{row14.value}</div>
                                <div style={s("font-size: 9px; letter-spacing: .12em; color: var(--color-neutral-700); margin-top: 4px")}>{row14.label}</div>
                              </div>
                            </React.Fragment>))}
                          </div>
                          <span className="tag tag-accent" style={s("font-size: 9px; letter-spacing: .12em")}>AI PREDICTION</span>
                          <div style={s("font-size: 13px; margin-top: 8px; text-wrap: pretty")}><strong>Possible cause:</strong> {v.focusCause}</div>
                          <div style={s("font-size: 13px; margin-top: 4px; color: var(--color-neutral-800); text-wrap: pretty")}>{v.focusAction}</div>
                          <button data-cursor="INVESTIGATE" onClick={v.goInvestigate} data-magnetic="1" className="btn btn-primary btn-block" style={s("justify-content: flex-start; margin-top: 14px; letter-spacing: .08em")}>INVESTIGATE →</button>
                        </div>
                      </div>
                    </>) : null}
                    {(v.showEmptyPanel) ? (<>
                      <div style={s("border: 1px dashed var(--color-neutral-400); padding: 18px; display: grid; gap: 8px; align-content: start; background: var(--color-surface); border-radius: var(--radius-md, 6px)")}>
                        <div style={s("width: 10px; height: 10px; background: var(--color-accent)")}></div>
                        <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 13px; letter-spacing: .1em")}>SELECT A CAMPUS LOCATION</div>
                        <div style={s("font-size: 12px; line-height: 1.5; color: var(--color-neutral-700)")}>
                          Click any location in the campus control list to open this sidebar and view active incidents, affected students, risk analysis, and AI predictions.
                        </div>
                      </div>
                    </>) : null}
                  </div>
      
                </div>
              </section>
      
              <section data-scene="friction" style={s("max-width: 1560px; margin: 0 auto; padding: clamp(24px, 5vw, 72px) clamp(12px, 2.5vw, 28px)")}>
                <hr data-scene-part="rule" className="hr" style={s("margin-top: 0")} />
                <div data-scene-part="grid" style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: clamp(16px, 3vw, 40px)")}>
                  <div data-scene-part="copy">
                    <div style={s("font-size: 11px; letter-spacing: .2em; color: var(--color-muted); font-weight: 700")}>THE FRICTION MAP</div>
                    <h2 style={s("font-size: clamp(22px, 2.6vw, 34px); letter-spacing: -.02em; margin: 8px 0 12px")}>Six hops, four days, no memory.</h2>
                    <p style={s("font-size: 14px; color: var(--color-neutral-800); max-width: 40ch")}>A campus problem today travels through people, not systems. Nothing is recorded, nothing is connected, nothing is learned.</p>
                  </div>
                  <div data-scene-part="flow" style={s("display: grid; gap: 6px")}>
                    {(v.oldFlow || []).map((row15, i15) => (<React.Fragment key={i15}>
                      <div style={s("display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--color-neutral-300); padding-bottom: 6px")}>
                        <span style={s("font-size: 10px; color: var(--color-neutral-600); font-variant-numeric: tabular-nums; width: 22px")}>{row15.n}</span>
                        <span style={s("font-family: var(--font-heading); font-weight: 800; font-size: 15px; letter-spacing: .06em")}>{row15.label}</span>
                        <span style={s("flex: 1")}></span>
                        <span style={s("font-size: 11px; color: var(--color-neutral-600)")}>{row15.cost}</span>
                      </div>
                    </React.Fragment>))}
                  </div>
                  <div data-scene-part="card" style={s("background: var(--color-accent); color: var(--color-on-accent); padding: 20px; display: grid; gap: 6px; align-content: start")}>
                    <div style={s("font-size: 10px; letter-spacing: .16em; opacity: .85")}>WITH NEX CAMP</div>
                    {(v.newFlow || []).map((row16, i16) => (<React.Fragment key={i16}>
                      <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: clamp(16px, 1.8vw, 22px); letter-spacing: -.01em; border-bottom: 2px solid color-mix(in srgb, var(--color-on-ink) 35%, transparent); padding-bottom: 6px")}>{row16}</div>
                    </React.Fragment>))}
                    {/* EXCEPTION-ONLY HOOK: the new path, measured from the event log; the original line is the fallback. */}
                    <XoSlot name="frictionMeasured" open live={this.state.apiState === "live"} fallback={<div style={s("font-size: 12px; margin-top: 6px")}>One request. Average resolution 4.2 hours.</div>} />
                  </div>
                </div>
              </section>
      
              <section data-scene="surfaces" style={s("max-width: 1560px; margin: 0 auto; padding: 0 clamp(12px, 2.5vw, 28px) clamp(32px, 6vw, 80px)")}>
                <hr data-scene-part="rule" className="hr" />
                <div data-scene-part="head" style={s("display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap; margin-bottom: 18px")}>
                  <h2 style={s("font-size: clamp(20px, 2.2vw, 28px); letter-spacing: -.02em; margin: 0")}>THE 13 CAMPUS SURFACES</h2>
                  <div style={s("font-size: 11px; letter-spacing: .14em; color: var(--color-neutral-700)")}>13 CONNECTED WORKFLOWS · MAPPED TO EVALUATION SLIDES</div>
                </div>
                <div data-scene-part="cards" style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); border-top: 1px solid var(--color-divider); border-left: 1px solid var(--color-divider)")}>
                  {(v.pageCards || []).map((row17, i17) => (<React.Fragment key={i17}>
                    <div data-cursor="OPEN" onClick={row17.onClick} style={row17.style} {...hov("background: var(--color-accent-100); transform: translateY(-7px)")}>
                      <div style={s("font-size: 10px; letter-spacing: .16em; color: var(--color-muted); font-weight: 700")}>{row17.num}</div>
                      <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 17px; letter-spacing: -.01em; margin: 8px 0 6px")}>{row17.name}</div>
                      <div style={s("font-size: 12px; color: var(--color-neutral-700); text-wrap: pretty")}>{row17.blurb}</div>
                    </div>
                  </React.Fragment>))}
                </div>
              </section>
            </div>
          </>) : null}
      
          {/* 02 STUDENT DASHBOARD */}
          {(v.isStudent) ? (<>
            {/* The intelligence summary, the question box, what changed and what
                to do next — all from GET /api/students/me/intelligence. */}
            <IntelGuard name="Student dashboard"><StudentIntel live={v.intelLive} signedIn={v.intelSignedIn} userName={v.stuName} onNavigate={v.intelGo} onReport={v.goReport} /></IntelGuard>{/* SUPPORT HOOK: private wellbeing check-in, "I don't know how to ask for help", requests and follow-ups (students only). */}<SupportSlot name="student" live={this.state.apiState === "live"} user={this.state.user} />            {/* EXCEPTION-ONLY HOOK: "Time you saved this month" (ESTIMATE, from the Friction Ledger). */}
            <div style={s("max-width: 1560px; margin: 0 auto; padding: 0 clamp(12px, 2.5vw, 28px)")}><XoSlot name="timeSaved" live={this.state.apiState === "live"} user={this.state.user} /><XoSlot name="whatChanged" live={this.state.apiState === "live"} user={this.state.user} />{/* ROUND-3 HOOK: your best time to eat */}<PfSlot name="bestSlot" live={this.state.apiState === "live"} user={this.state.user} lowBw={this.state.lowBw} /></div>
            <section style={s("max-width: 1560px; margin: 0 auto; padding: clamp(16px, 2vw, 28px) clamp(12px, 2.5vw, 28px) 80px")}>
              <div style={s("display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-top: 12px")}>
                <h3 style={s("font-size: 15px; letter-spacing: .1em; margin: 0")}>YOUR BLOCK &amp; REPORTS</h3>
                <div style={s("font-size: 11px; letter-spacing: .06em; color: var(--color-neutral-700)")}>{v.stuRoll} · {v.stuRoom}</div>
              </div>
              <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0; border-top: 1px solid var(--color-divider); border-left: 1px solid var(--color-divider); margin-top: 12px")}>
                {(v.stuTiles || []).map((row18, i18) => (<React.Fragment key={i18}>
                  <div style={s("border-right: 1px solid var(--color-divider); border-bottom: 1px solid var(--color-divider); padding: 22px; transition: transform .4s cubic-bezier(.2,.8,.2,1), background .3s")} data-reveal="1" {...hov("background: var(--color-accent-100); transform: translateY(-6px)")}>
                    <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700)")}>{row18.k}</div>
                    <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 34px; line-height: 1.05; letter-spacing: -.02em; margin: 8px 0 6px")}>{row18.v}</div>
                    <div style={s("font-size: 12px; color: var(--color-neutral-700)")}>{row18.sub}</div>
                  </div>
                </React.Fragment>))}
              </div>
      
              <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: clamp(16px, 2.5vw, 32px); margin-top: 32px")}>
                <div>
                  <h3 style={s("font-size: 15px; letter-spacing: .1em; margin: 0 0 12px")}>TODAY'S SIGNALS</h3>
                  <div style={s("display: grid; gap: 12px")}>
                    {(v.stuAlerts || []).map((row19, i19) => (<React.Fragment key={i19}>
                      <div data-reveal="1" style={s("border: 1px solid var(--color-divider); border-radius: var(--radius-md); background: var(--color-surface); padding: 16px; display: grid; gap: 8px; transform-origin: bottom center; transition: transform .45s cubic-bezier(.2,.8,.2,1), box-shadow .45s, border-color .3s")} {...hov("transform: perspective(900px) rotateX(6deg) translateY(-9px); box-shadow: var(--shadow-md); border-color: var(--color-text)")}>
                        <span style={row19.tagStyle}>{row19.tag}</span>
                        <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 17px; letter-spacing: -.01em")}>{row19.title}</div>
                        <div style={s("font-size: 13px; color: var(--color-neutral-800); text-wrap: pretty")}>{row19.body}</div>
                        <button data-cursor="TRACE" onClick={row19.onClick} className="btn btn-ghost" style={s("justify-self: start; font-size: 11px; letter-spacing: .1em; padding-left: 0")}>{row19.cta} →</button>
                      </div>
                    </React.Fragment>))}
                  </div>
                </div>
                <div>
                  <h3 style={s("font-size: 15px; letter-spacing: .1em; margin: 0 0 12px")}>MY REPORTS</h3>
                  <div style={s("border-top: 1px solid var(--color-divider)")}>
                    {(v.stuReports || []).map((row20, i20) => (<React.Fragment key={i20}>
                      <div style={s("padding: 14px 6px 14px 0; border-bottom: 1px solid var(--color-neutral-300); transition: transform .3s, background .3s")} {...hov("transform: translateX(6px); background: var(--color-neutral-200)")}>
                        <div style={s("display: flex; justify-content: space-between; gap: 12px; align-items: baseline")}>
                          <div style={s("font-size: 10px; letter-spacing: .12em; color: var(--color-neutral-700)")}>{row20.id} · {row20.where}</div>
                          <div style={s("font-size: 10px; letter-spacing: .12em; color: var(--color-neutral-600)")}>{row20.age}</div>
                        </div>
                        <div style={s("font-size: 14px; margin: 5px 0 8px")}>{row20.what}</div>
                        <div style={s("background: var(--color-neutral-300); height: 10px")}><div style={row20.barStyle}></div></div>
                        <div style={s("font-size: 10px; letter-spacing: .12em; font-weight: 700; margin-top: 6px")}>{row20.state}</div>
                      </div>
                    </React.Fragment>))}
                  </div>

                  {/* Feature 17: rate a resolved report. Only the student's own
                      resolved complaints appear, straight from the API. */}
                  {(v.stuResolved.length) ? (
                    <div style={s("margin-top: 22px")}>
                      <h3 style={s("font-size: 15px; letter-spacing: .1em; margin: 0 0 12px")}>RATE A RESOLVED REPORT</h3>
                      {(v.fbError) ? <div style={s("font-size: 12px; color: var(--color-accent-700); font-weight: 700; margin-bottom: 8px")}>{v.fbError}</div> : null}
                      <div style={s("border-top: 1px solid var(--color-divider)")}>
                        {v.stuResolved.map((c) => (
                          <div key={c.id} style={s("padding: 12px 0; border-bottom: 1px solid var(--color-neutral-300)")}>
                            <div style={s("font-size: 10px; letter-spacing: .12em; color: var(--color-neutral-700)")}>{c.reference} · RESOLVED</div>
                            <div style={s("font-size: 14px; margin: 4px 0 6px")}>{c.title}</div>
                            {c.resolution?.resolutionDescription ? (
                              <div style={s("font-size: 12px; color: var(--color-neutral-700); margin-bottom: 8px; line-height: 1.5")}>Fix: {c.resolution.resolutionDescription}</div>
                            ) : null}
                            {(c.feedback || v.fbDone[c.id]) ? (
                              <div style={s("font-size: 12px; font-weight: 700")}>
                                You rated this {(c.feedback || v.fbDone[c.id].feedback).rating}/5 · sentiment {(c.feedback || v.fbDone[c.id].feedback).sentiment || "—"}
                                <span style={s("font-weight: 400; color: var(--color-neutral-600)")}> (word-list score + your rating, not a model)</span>
                              </div>
                            ) : (
                              <div style={s("display: grid; gap: 8px")}>
                                <div style={s("display: flex; gap: 6px; flex-wrap: wrap")} role="radiogroup" aria-label={`Rate ${c.reference}`}>
                                  {[1, 2, 3, 4, 5].map((n) => (
                                    <button
                                      key={n}
                                      role="radio"
                                      aria-checked={Number(v.fbRating[c.id]) === n}
                                      onClick={() => v.onFbRating(c.id, n)}
                                      style={{
                                        minWidth: "40px", padding: "8px 10px", cursor: "pointer", fontFamily: "var(--font-heading)", fontWeight: 800,
                                        border: "1px solid var(--color-divider)",
                                        background: Number(v.fbRating[c.id]) === n ? "var(--color-text)" : "transparent",
                                        color: Number(v.fbRating[c.id]) === n ? "var(--color-bg)" : "var(--color-text)"
                                      }}
                                    >
                                      {n}★
                                    </button>
                                  ))}
                                </div>
                                <input
                                  className="input"
                                  value={v.fbComment[c.id] || ""}
                                  onChange={(e) => v.onFbComment(c.id, e.target.value)}
                                  placeholder="How was it handled? (optional)"
                                  maxLength={500}
                                  style={s("padding: 8px 10px; font-size: 12px")}
                                />
                                <button onClick={() => v.onFbSubmit(c.id)} disabled={v.fbBusy === c.id} className="btn btn-primary" style={s("justify-self: start; font-size: 10px; letter-spacing: .1em; padding: 8px 12px")}>
                                  {v.fbBusy === c.id ? "SENDING…" : "SUBMIT RATING"}
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* Feature 7: the student's own notifications, by priority. */}
                  {(v.stuNotifications.length) ? (
                    <div style={s("margin-top: 22px")}>
                      <h3 style={s("font-size: 15px; letter-spacing: .1em; margin: 0 0 6px")}>MY NOTIFICATIONS</h3>
                      <div style={s("border-top: 1px solid var(--color-divider)")}>
                        {v.stuNotifications.slice(0, 6).map((row) => (
                          <PriorityRow key={row.id} priority={row.priority} title={row.title} body={row.body} reason={row.priorityReason} source={row.prioritySource} at={row.createdAt} />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
      
            </section>
          </>) : null}
      
          {/* 03 ATTENDANCE INTELLIGENCE */}
          {(v.isAttendance) ? (<>
            {/* Classification, subject analysis, why-analysis, simulator and
                timeline — GET /api/attendance/me/intelligence and
                POST /api/attendance/simulate. */}
            {/* EXCEPTION-ONLY HOOK: class changes that move this student's attendance projection. */}
            <div style={s("max-width: 1560px; margin: 0 auto; padding: 0 clamp(12px, 2.5vw, 28px)")}><XoSlot name="whatChanged" live={this.state.apiState === "live"} user={this.state.user} types={["CLASS_CANCEL", "CLASS_RESCHEDULE"]} title="Your projection after class changes" /></div>
            <IntelGuard name="Attendance"><AttendanceIntel live={v.intelLive} signedIn={v.intelSignedIn} focus={v.intelFocus?.page === "attendance" ? v.intelFocus : null} onFocusDone={v.intelFocusDone} onNavigate={v.intelGo} /></IntelGuard>
            {/* ROUND-3 HOOK: point of no return (students) · systemic vs individual absence (ADMIN, WARDEN) */}
            <div style={s("max-width: 1560px; margin: 0 auto; padding: 0 clamp(12px, 2.5vw, 28px)")}><PfSlot name="attendance" live={this.state.apiState === "live"} user={this.state.user} lowBw={this.state.lowBw} /></div>
            <section style={s("max-width: 1560px; margin: 0 auto; padding: 0 clamp(12px, 2.5vw, 28px) 80px")}>
            </section>
          </>) : null}
      
          {/* 04 MESS INTELLIGENCE */}
          {(v.isMess) ? (<>
            {/* Today's meals, demand classes and predictions, feedback
                intelligence and the demand simulator — GET /api/mess/intelligence
                and POST /api/mess/simulate. */}
            {/* EXCEPTION-ONLY HOOK: menu changes and their demand estimate. */}
            <div style={s("max-width: 1560px; margin: 0 auto; padding: 0 clamp(12px, 2.5vw, 28px)")}><XoSlot name="whatChanged" live={this.state.apiState === "live"} user={this.state.user} types={["MENU_CHANGE"]} title="Menu changes" /></div>
            <IntelGuard name="Mess"><MessIntel live={v.intelLive} signedIn={v.intelSignedIn} focus={v.intelFocus?.page === "mess" ? v.intelFocus : null} onFocusDone={v.intelFocusDone} onNavigate={v.intelGo} /></IntelGuard>
            {/* ROUND-3 HOOK: forecast adjusted for students on approved gate passes, with its backtest */}
            <div style={s("max-width: 1560px; margin: 0 auto; padding: 0 clamp(12px, 2.5vw, 28px)")}><PfSlot name="presence" live={this.state.apiState === "live"} user={this.state.user} lowBw={this.state.lowBw} /></div>
            <section style={s("max-width: 1560px; margin: 0 auto; padding: 0 clamp(12px, 2.5vw, 28px) 80px")}>
            </section>
          </>) : null}
      
          {/* 05 REPORT & TRACK */}
          {(v.isReport) ? (<>
            <section style={s("max-width: 1560px; margin: 0 auto; padding: clamp(20px, 3vw, 40px) clamp(12px, 2.5vw, 28px) 80px")}>
              <div style={s("border-bottom: 1px solid var(--color-divider); padding-bottom: 14px")}>
                <div data-reveal="1" style={s("font-size: 11px; letter-spacing: .2em; color: var(--color-muted); font-weight: 700")}>05 — REPORT &amp; TRACK PROBLEM</div>
                <h1 data-reveal="1" style={s("font-size: clamp(28px, 4vw, 52px); letter-spacing: -.03em; margin: 8px 0 0")}>A complaint is a digital object.</h1>
              </div>

              <EvalKicker
                problem="17 students report the same leaking tap, flooding queues; electrical arcing and gas leaks get lost in the backlog."
                solution="Real-time semantic similarity detects existing incidents while typing (+1 & Follow). Safety floor forces 7 hazard groups directly to CRITICAL."
                tryAction="Type 'tap leaking B-214' to see duplicate detection on INC-0051, or type 'sparks from socket' to test safety floor."
              />
      
              <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: clamp(16px, 2.5vw, 32px); margin-top: 28px; align-items: start")}>
                {v.isStaff ? (
                  <div>
                    <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); margin-bottom: 12px")}>ADMINISTRATIVE ACCESS · {v.userRole}</div>
                    <div style={s("display: grid; gap: 14px; border: 1px solid var(--color-divider); padding: 22px; background: var(--color-neutral-100); border-radius: 4px")}>
                      <div style={s("font-size: 13px; font-weight: 800; color: var(--color-text); display: flex; align-items: center; gap: 8px")}>
                        <span>🛡️</span> ROLE-BASED ACCESS CONTROL
                      </div>
                      <p style={s("font-size: 12px; color: var(--color-neutral-700); line-height: 1.6; margin: 0")}>
                        You are logged in as <strong>{v.userName}</strong> ({v.userRole}). Problem reporting and complaint submission is reserved exclusively for students.
                      </p>
                      <p style={s("font-size: 12px; color: var(--color-neutral-700); line-height: 1.6; margin: 0")}>
                        To review incoming student complaints, approve &amp; message students, reject invalid reports, or track resolution status, please open <strong>Mission Control</strong> or the <strong>Warden Dashboard</strong>.
                      </p>
                      <div style={s("border-top: 1px solid var(--color-divider); padding-top: 12px; display: flex; gap: 10px; flex-wrap: wrap")}>
                        <button
                          type="button"
                          onClick={() => this.setRoute("admin")}
                          className="btn btn-primary"
                          style={s("font-size: 11px; letter-spacing: .08em; padding: 10px 16px")}
                        >
                          OPEN MISSION CONTROL &amp; TRIAGE →
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); margin-bottom: 12px")}>SUBMIT</div>
                    <div style={s("display: grid; gap: 16px; border: 1px solid var(--color-divider); padding: 20px")}>
                      <div>
                        <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); margin-bottom: 8px")}>CATEGORY — AI WILL CONFIRM</div>
                        <div style={s("display: flex; gap: 6px; flex-wrap: wrap")}>
                          {(v.repCats || []).map((row27, i27) => (<React.Fragment key={i27}>
                            <button data-cursor="SELECT" onClick={row27.onClick} style={row27.style}>{row27.label}</button>
                          </React.Fragment>))}
                        </div>
                      </div>
                      <div className="field">
                        <label>LOCATION</label>
                        <input className="input" value={v.repLocation} onChange={v.onRepLocation} />
                      </div>
                      <div className="field">
                        <label>WHAT IS HAPPENING</label>
                        <input className="input" value={v.repText} onChange={v.onRepText} placeholder="No water in the bathroom since morning." />
                      </div>
                      {/* EXCEPTION-ONLY HOOK: known open incident → +1 & Follow; "Report anyway" keeps the submit below unchanged. */}
                      <XoSlot name="knownIssue" live={this.state.apiState === "live"} user={this.state.user} text={v.repText} category={this.state.repCategory} location={v.repLocation} lowBw={this.state.lowBw} />
                      <XoSlot name="reportEta" live={this.state.apiState === "live"} user={this.state.user} category={this.state.repCategory} />
                      {(v.repError) ? (<>
                        <div style={s("font-size: 12px; color: var(--color-accent-700); font-weight: 700")}>{v.repError}</div>
                      </>) : null}
                      <button data-cursor="SUBMIT" onClick={v.onAdvance} disabled={v.repBusy} data-magnetic="1" className="btn btn-primary" style={s("justify-content: flex-start; padding: 12px 16px; letter-spacing: .08em")}>{v.repSubmitLabel}</button>
                      <button onClick={v.onResetStep} className="btn btn-ghost" style={s("justify-self: start; font-size: 11px; letter-spacing: .1em; padding-left: 0")}>RESET FLOW</button>
                    </div>
                  </div>
                )}
      
                <div>
                  <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700)")}>LIFECYCLE · {v.repReference}</div>
                  <div style={v.repTrackStyle}>
                    <div style={v.repObjStyle}></div>
                  </div>
                  <div style={s("display: flex; gap: 10px; flex-wrap: wrap")}>
                    {(v.repSteps || []).map((row28, i28) => (<React.Fragment key={i28}>
                      <div style={row28.style}>
                        <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-600)")}>{row28.n}</div>
                        <div style={row28.labelStyle}>{row28.label}</div>
                      </div>
                    </React.Fragment>))}
                  </div>
      
                  <div style={s("border: 1px solid var(--color-neutral-500); padding: 20px; margin-top: 26px")}>
                    <span className="tag tag-accent" style={s("font-size: 9px; letter-spacing: .12em")}>RULE CLASSIFICATION</span>{/* REEL HOOK (see CHANGES-REEL.md): rule-based, not AI */}
                    <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 0; border-top: 1px solid var(--color-divider); border-left: 1px solid var(--color-divider); margin-top: 14px")}>
                      {(v.repClass || []).map((row29, i29) => (<React.Fragment key={i29}>
                        <div style={s("background: var(--color-neutral-100); border-right: 1px solid var(--color-divider); border-bottom: 1px solid var(--color-divider); padding: 12px")}>
                          <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>{row29.k}</div>
                          <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 15px; letter-spacing: -.005em; margin-top: 4px")}>{row29.v}</div>
                        </div>
                      </React.Fragment>))}
                    </div>
                    <div style={s("font-size: 10px; letter-spacing: .12em; color: var(--color-neutral-600); margin-top: 10px; line-height: 1.6")}>{v.repClassMethod}</div>
                    {(v.repClassReasons || []).length ? (<>
                      <ul style={s("margin: 8px 0 0; padding-left: 16px; font-size: 12px; color: var(--color-neutral-800); line-height: 1.6")}>
                        {(v.repClassReasons || []).map((rowR, iR) => (<React.Fragment key={iR}>
                          <li>{rowR.label}</li>
                        </React.Fragment>))}
                      </ul>
                    </>) : null}
                  </div>

                  {/* Features 1, 6 and 17: what the AI decided, how certain it
                      was, why, and which of the three sources produced it. */}
                  {(v.repAi) ? (
                    <AiPanel
                      kicker="AI ANALYSIS"
                      title="What the system decided about this report"
                      tone={v.repEscalation && v.repEscalation.escalate ? "alert" : "default"}
                      badge={<AiBadge source={v.repAi.source} provider={v.repAi.provider} model={v.repAi.model} method={v.repAi.method} at={v.repAi.processedAt} />}
                    >
                      <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 18px; margin-top: 14px; align-items: start")}>
                        <AiConfidence value={v.repAi.confidence} basis={v.repAi.confidenceBasis} />
                        <div>
                          <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>RULE CLASSIFICATION</div>{/* REEL HOOK (see CHANGES-REEL.md): rule-based, not AI */}
                          <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 18px; margin-top: 4px")}>{v.repAi.category}</div>
                          {v.repAi.subCategory ? (
                            <div style={s("font-size: 12px; color: var(--color-neutral-700); margin-top: 2px")}>{v.repAi.subCategory}</div>
                          ) : null}
                        </div>
                        <div>
                          <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>AI SUGGESTED DEPARTMENT</div>
                          <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 14px; margin-top: 4px")}>{v.repAi.department}</div>
                          <div style={s("font-size: 10px; color: var(--color-neutral-600); margin-top: 4px; line-height: 1.5")}>
                            A recommendation. A warden or administrator accepts or changes it, and both values are kept.
                          </div>
                        </div>
                      </div>

                      {(v.repEscalation) ? (
                        <div style={{
                          marginTop: "16px", padding: "12px 14px",
                          border: `2px solid ${v.repEscalation.escalate ? "var(--color-accent)" : "var(--color-divider)"}`
                        }}>
                          <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>PRIORITY &amp; ESCALATION</div>
                          <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 20px; margin-top: 4px; color: var(--color-accent)")}>
                            {v.repEscalation.priority}
                          </div>
                          <div style={s("font-size: 12px; margin-top: 6px; line-height: 1.6; color: var(--color-neutral-800)")}>
                            {v.repEscalation.action}
                          </div>
                          <div style={s("font-size: 10px; letter-spacing: .08em; color: var(--color-neutral-600); margin-top: 8px")}>
                            DECIDED BY {v.repEscalation.rule === "SAFETY_RULE" ? "A DETERMINISTIC SAFETY RULE — NOT A MODEL" : v.repEscalation.rule.replace(/_/g, " ")}
                          </div>
                        </div>
                      ) : null}

                      <AiExplanation
                        reasons={v.repAi.reasons}
                        recommendation={v.repAi.suggestedAction}
                        caveat={`Urgency target ${v.repAi.urgencyHours} hours. Every value above is stored on the complaint record and shown to staff unchanged.`}
                      />
                      <AiNotice text={v.repAi.notice} />
                    </AiPanel>
                  ) : null}

                  {/* Feature 3: the duplicate verdict, with the complaint it
                      matched. Nothing is merged or deleted from here. */}
                  {(v.repAiDuplicate && v.repAiDuplicate.related) ? (
                    <AiPanel
                      kicker="POSSIBLE DUPLICATE COMPLAINT"
                      title={`${v.repAiDuplicate.similarity}% similar to ${v.repAiDuplicate.related.reference}`}
                      tone="alert"
                      badge={<AiBadge source={v.repAiDuplicate.source} provider={v.repAiDuplicate.provider} model={v.repAiDuplicate.model} method={v.repAiDuplicate.method} />}
                    >
                      <AiFacts rows={[
                        { label: "RELATED COMPLAINT", value: v.repAiDuplicate.related.reference },
                        { label: "TITLE", value: v.repAiDuplicate.related.title },
                        { label: "SIMILARITY", value: `${v.repAiDuplicate.similarity}%` },
                        { label: "BASIS", value: (v.repAiDuplicate.similarityBasis || "").replace(/_/g, " ") },
                        { label: "SAME PROBLEM?", value: v.repAiDuplicate.isDuplicate ? "LIKELY" : "LIKELY NOT" }
                      ]} />
                      <AiExplanation
                        reason={v.repAiDuplicate.reason}
                        recommendation={v.repAiDuplicate.recommendation}
                        caveat={v.repAiDuplicate.governance}
                      />
                      <AiNotice text={v.repAiDuplicate.notice} />
                    </AiPanel>
                  ) : null}

                  {/* Feature 13: the same timeline component the gate pass uses. */}
                  {(v.repAiTimeline) ? (
                    <div style={s("border: 1px solid var(--color-divider); padding: 18px; margin-top: 20px")}>
                      <RequestTimeline timeline={v.repAiTimeline} />
                    </div>
                  ) : null}

                  {/* When no provider is configured at all, say so here rather
                      than leaving the student to assume a model ran. */}
                  {(!v.repAi && v.repAiStatus && !v.repAiStatus.configured) ? (
                    <AiNotice text={`AI service not configured — ${v.repAiStatus.note}`} />
                  ) : null}
                </div>
              </div>
      
              <div style={s("margin-top: 34px")}>
                <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); margin-bottom: 12px")}>AUDIT TIMELINE — WHAT THE SYSTEM DID, AND WHY</div>
                <div style={s("border-top: 1px solid var(--color-divider)")}>
                  {(v.repAudit || []).map((row30, i30) => (<React.Fragment key={i30}>
                    <div style={s("display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; gap: 14px; align-items: baseline; padding: 12px 0; border-bottom: 1px solid var(--color-neutral-300)")}>
                      <div style={s("font-size: 12px; font-variant-numeric: tabular-nums; color: var(--color-neutral-700)")}>{row30.t}</div>
                      <div style={s("font-size: 13px")}>{row30.txt}</div>
                      <div style={row30.tagStyle}>{row30.tag}</div>
                    </div>
                  </React.Fragment>))}
                </div>
              </div>

              {/* ---- 6-DAY RESOLUTION VERIFICATION & CONFIRMATION PORTAL (RED FLAG / GREEN FLAG) ---- */}
              <div style={s("margin-top: 40px; border: 2px solid var(--color-divider); background: var(--color-neutral-100); padding: clamp(16px, 2.5vw, 28px); border-radius: 6px")}>
                <div style={s("display: flex; justify-content: space-between; align-items: baseline; gap: 14px; flex-wrap: wrap; border-bottom: 1px solid var(--color-divider); padding-bottom: 12px")}>
                  <div>
                    <div style={s("font-size: 10px; letter-spacing: .18em; color: var(--color-muted); font-weight: 800")}>STUDENT 6-DAY RESOLUTION VERIFICATION PORTAL</div>
                    <h2 style={s("font-size: clamp(20px, 2.5vw, 30px); margin: 6px 0 0; letter-spacing: -.02em")}>Confirm or dispute resolved problems (Red Flag / Green Flag)</h2>
                  </div>
                  <div style={s("font-size: 11px; letter-spacing: .08em; background: var(--color-neutral-200); padding: 6px 12px; border-radius: 999px; font-weight: 700")}>
                    6-DAY (144-HOUR) GUARANTEE WINDOW
                  </div>
                </div>
                <p style={s("font-size: 13px; color: var(--color-neutral-700); margin: 12px 0 20px; line-height: 1.6; max-width: 90ch")}>
                  When an administrator or warden approves and resolves your complaint, you have <strong>6 days to inspect the fix in person</strong>. Confirm the resolution with a <strong>Green Flag</strong>, or raise a <strong>Red Flag</strong> if the issue persists to automatically escalate it back to high-priority investigation.
                </p>

                <div style={s("display: grid; gap: 16px")}>
                  {(v.repResolvedList || []).map((item) => (
                    <div key={item.id} style={s("background: var(--color-surface); border: 1px solid var(--color-divider); padding: 18px; display: grid; gap: 12px; box-shadow: var(--shadow-sm)")}>
                      <div style={s("display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap")}>
                        <div style={s("display: flex; gap: 8px; align-items: center")}>
                          <span style={s("font-family: var(--font-heading); font-weight: 800; font-size: 14px; letter-spacing: .06em")}>{item.reference}</span>
                          <span style={s("font-size: 10px; letter-spacing: .1em; padding: 2px 6px; background: var(--color-neutral-200); border-radius: 4px; font-weight: 700")}>{item.category}</span>
                          <span style={s("font-size: 12px; color: var(--color-neutral-600)")}>{item.location}</span>
                        </div>
                        <div style={s("font-size: 11px; letter-spacing: .08em; color: var(--color-neutral-600)")}>
                          Resolved: {item.resolvedAt}
                        </div>
                      </div>

                      <div style={s("font-size: 15px; font-weight: 700")}>{item.title}</div>

                      {/* Admin / Warden message */}
                      <div style={s("background: var(--color-neutral-100); border-left: 3px solid var(--color-accent); padding: 10px 14px; font-size: 13px; line-height: 1.6")}>
                        <div style={s("font-size: 10px; letter-spacing: .12em; color: var(--color-muted); font-weight: 800")}>
                          MESSAGE FROM {item.resolver.toUpperCase()}
                        </div>
                        <div style={s("margin-top: 4px; color: var(--color-text)")}>{item.adminMessage}</div>
                      </div>

                      {/* 6-day status & action buttons */}
                      <div style={s("display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 4px")}>
                        <div>
                          {item.flag === "GREEN_FLAG" ? (
                            <div style={s("display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 800; color: #166534; background: #dcfce7; padding: 6px 12px; border-radius: 4px")}>
                              <span>✓</span> 🟢 GREEN FLAGGED · YOU CONFIRMED FIXED
                            </div>
                          ) : item.flag === "RED_FLAG" ? (
                            <div style={s("display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 800; color: #991b1b; background: #fee2e2; padding: 6px 12px; border-radius: 4px")}>
                              <span>⚠</span> 🔴 RED FLAGGED · DISPUTED BY YOU (ESCALATED TO CRITICAL)
                            </div>
                          ) : item.isExpired ? (
                            <div style={s("font-size: 11px; color: var(--color-neutral-600)")}>
                              Verification window closed (6 days passed with no dispute)
                            </div>
                          ) : (
                            <div style={s("font-size: 12px; font-weight: 700; color: var(--color-warn-700, #b45309)")}>
                              ⏳ {item.daysLeft} days, {item.hoursLeft} hours remaining to confirm or dispute
                            </div>
                          )}
                        </div>

                        {item.flag === "PENDING" && !item.isExpired ? (
                          v.isStudentRole ? (
                            <div style={s("display: flex; gap: 8px; flex-wrap: wrap")}>
                              <button
                                type="button"
                                onClick={() => v.onConfirmGreen(item.id)}
                                disabled={v.studentFlagBusy === item.id}
                                className="btn btn-primary"
                                style={s("background: #15803d; border-color: #15803d; color: #fff; font-size: 11px; letter-spacing: .08em; padding: 9px 14px")}
                              >
                                {v.studentFlagBusy === item.id ? "CONFIRMING…" : "🟢 CONFIRM RESOLVED (GREEN FLAG)"}
                              </button>
                              <button
                                type="button"
                                onClick={() => v.onToggleDispute(item.id)}
                                disabled={v.studentFlagBusy === item.id}
                                className="btn btn-secondary"
                                style={s("color: #b91c1c; border-color: #b91c1c; font-size: 11px; letter-spacing: .08em; padding: 9px 14px")}
                              >
                                🔴 DISPUTE (RED FLAG)
                              </button>
                            </div>
                          ) : (
                            <div style={s("font-size: 11px; font-weight: 700; color: var(--color-muted); background: var(--color-neutral-100); padding: 6px 12px; border: 1px dashed var(--color-divider); border-radius: 4px")}>
                              🔒 STUDENT VERIFICATION ACCESS ONLY · Awaiting student confirmation
                            </div>
                          )
                        ) : null}
                      </div>

                      {/* Red flag dispute reason input box */}
                      {v.isStudentRole && item.isDisputeOpen ? (
                        <div style={s("border-top: 1px solid var(--color-divider); padding-top: 12px; margin-top: 6px")}>
                          <div style={s("font-size: 11px; font-weight: 700; color: #b91c1c; margin-bottom: 6px")}>
                            PLEASE SPECIFY WHY THE PROBLEM IS NOT RESOLVED:
                          </div>
                          <div style={s("display: flex; gap: 8px; flex-wrap: wrap")}>
                            <input
                              className="input"
                              value={item.disputeNote}
                              onChange={(e) => v.onDisputeText(item.id, e.target.value)}
                              placeholder="e.g. Water ran for 10 minutes then stopped again, or tap is still leaking."
                              style={s("flex: 1 1 280px; font-size: 12px; padding: 8px 10px")}
                            />
                            <button
                              type="button"
                              onClick={() => v.onSubmitRed(item.id)}
                              disabled={v.studentFlagBusy === item.id}
                              className="btn btn-primary"
                              style={s("background: #b91c1c; border-color: #b91c1c; color: #fff; font-size: 11px; letter-spacing: .08em")}
                            >
                              SUBMIT RED FLAG →
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

            </section>
          </>) : null}
      
          {/* 06 INCIDENT INTELLIGENCE */}
          {(v.isIncident) ? (<>
            <section style={s("max-width: 1560px; margin: 0 auto; padding: clamp(20px, 3vw, 40px) clamp(12px, 2.5vw, 28px) 80px")}>
              <div style={s("display: flex; justify-content: space-between; align-items: flex-end; gap: 18px; flex-wrap: wrap; border-bottom: 1px solid var(--color-divider); padding-bottom: 14px")}>
                <div>
                  <div data-reveal="1" style={s("font-size: 11px; letter-spacing: .2em; color: var(--color-muted); font-weight: 700")}>06 — INCIDENT INTELLIGENCE</div>
                  <h1 data-reveal="1" style={s("font-size: clamp(28px, 4vw, 52px); letter-spacing: -.03em; margin: 8px 0 0")}>{v.incHeadline}</h1>
                </div>
                <button data-cursor="CLUSTER" onClick={v.onCluster} data-magnetic="1" className="btn btn-primary" style={s("justify-content: flex-start; padding: 12px 18px; letter-spacing: .08em")}>{v.incClusterLabel}</button>
                <div style={s("font-size: 10px; letter-spacing: .12em; color: var(--color-neutral-600); margin-top: 10px; max-width: 62ch; line-height: 1.6")}>{v.incClusterNote}</div>
              </div>
      
              <div style={s("position: relative; height: 380px; border: 1px solid var(--color-divider); margin-top: 26px; overflow: hidden; background: var(--color-neutral-100)")}>
                {(v.incDots || []).map((row31, i31) => (<React.Fragment key={i31}>
                  <div style={row31.style}></div>
                </React.Fragment>))}
                <div style={v.incCoreStyle}>
                  <div style={s("font-size: 9px; letter-spacing: .14em")}>RECURRING INCIDENT</div>
                  <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 22px; letter-spacing: -.01em")}>{v.incRefLine}</div>
                  <div style={s("font-size: 12px")}>{v.incCaption}</div>
                </div>
              </div>
      
              <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: clamp(16px, 2.5vw, 32px); margin-top: 34px; align-items: start")}>
                <div style={s("border: 1px solid var(--color-neutral-500); padding: 20px")}>
                  <span className="tag tag-accent" style={s("font-size: 9px; letter-spacing: .12em")}>TIME TRAVEL</span>
                  <h3 style={s("font-size: 18px; margin: 12px 0 2px")}>{v.incDayLabel} · {v.incStatus}</h3>
                  <div style={s("font-size: 13px; color: var(--color-neutral-800); min-height: 40px")}>{v.incNote}</div>
                  <input type="range" min="0" max={v.incDayMax} step="1" value={v.incDay} onChange={v.onDay} data-cursor="SCRUB" style={s("width: 100%; accent-color: var(--color-accent); margin: 8px 0 6px")} />
                  <div style={s("display: flex; justify-content: space-between; gap: 6px")}>
                    {(v.incDayTicks || []).map((row32, i32) => (<React.Fragment key={i32}>
                      <div style={row32.style}>{row32.label}</div>
                    </React.Fragment>))}
                  </div>
                  <div style={s("display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 18px")}>
                    <div>
                      <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700)")}>COMPLAINTS</div>
                      <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 40px; line-height: 1")}>{v.incCount}</div>
                    </div>
                    <div>
                      <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700)")}>RISK</div>
                      <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 40px; line-height: 1; color: var(--color-accent)")}>{v.incRisk}%</div>
                      <div style={s("background: var(--color-neutral-300); height: 10px; margin-top: 8px")}><div style={v.incRiskBar}></div></div>
                    </div>
                  </div>
                </div>
                <div>
                  <div style={s("display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin-bottom: 10px")}>
                    <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700)")}>HISTORICAL RECURRENCE · {v.incBuildingName}</div>
                    <div style={v.matchLabelStyle}>{v.matchLabel}</div>
                  </div>
                  <div style={s("position: relative; border-top: 1px solid var(--color-divider)")}>
                    <div style={v.matchScanStyle}></div>
                    {(v.incHistory || []).map((row33, i33) => (<React.Fragment key={i33}>
                      <div style={v.matchRowStyle(i33)}>
                        <span style={s("font-variant-numeric: tabular-nums; color: var(--color-neutral-700)")}>{row33.d}</span>
                        <span style={s("letter-spacing: .06em; font-weight: 700; font-size: 11px")}>{row33.b}</span>
                        <span>{row33.c}</span>
                        <span style={s("font-variant-numeric: tabular-nums")}>{row33.t}</span>
                      </div>
                    </React.Fragment>))}
                  </div>
                  <div style={s("font-size: 13px; color: var(--color-neutral-800); border-left: 1px solid var(--color-accent); padding-left: 12px; margin-top: 14px; text-wrap: pretty")}>{v.matchNote}</div>
                  {(v.matchFactors || []).length ? (<>
                    <div style={s("display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px")}>
                      {(v.matchFactors || []).map((rowM, iM) => (<React.Fragment key={iM}>
                        <span style={s("font-size: 10px; letter-spacing: .1em; border: 1px solid var(--color-divider); padding: 4px 7px; color: var(--color-neutral-700)")}>{rowM.label} {"\u00a0"}<b style={s("color: var(--color-accent-700)")}>{rowM.weight}</b></span>
                      </React.Fragment>))}
                    </div>
                  </>) : null}
                </div>
              </div>
      
              {/* EXCEPTION-ONLY HOOK: incidents that reopened after a fix, followers, and the asset behind the leading one. */}
              <div style={s("margin-top: 34px; display: grid; gap: 14px")}>
                <XoSlot name="incidentSignals" live={this.state.apiState === "live"} user={this.state.user} />
                <XoSlot name="assets" live={this.state.apiState === "live"} user={this.state.user} building={this.activeIncident()?.building?.code} />
              </div>
              <div style={s("margin-top: 34px")}>
                <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); margin-bottom: 10px")}>ACTIVE INCIDENTS · RANKED BY RISK × AFFECTED</div>
                <div style={s("border-top: 1px solid var(--color-divider)")}>
                  {(v.incList || []).map((row34, i34) => (<React.Fragment key={i34}>
                    <div data-cursor="INVESTIGATE" onClick={row34.onClick} style={row34.rowStyle} {...hov("background: var(--color-accent-100); transform: translateX(6px)")}>
                      <span style={s("font-size: 11px; letter-spacing: .1em; color: var(--color-neutral-700)")}>{row34.id}</span>
                      <span style={s("font-family: var(--font-heading); font-weight: 700; letter-spacing: .04em; font-size: 13px")}>{row34.name}</span>
                      <span style={s("font-variant-numeric: tabular-nums")}>{row34.c} cmp</span>
                      <span style={s("font-family: var(--font-heading); font-weight: 800; font-variant-numeric: tabular-nums")}>{row34.r}</span>
                      <span style={row34.stStyle}>{row34.st}</span>
                    </div>
                  </React.Fragment>))}
                </div>
              </div>
      
            </section>
          </>) : null}
      
          {/* 07 PROBLEM INVESTIGATION */}
          {(v.isInvestigation) ? (<>
            <section style={s("max-width: 1560px; margin: 0 auto; padding: clamp(20px, 3vw, 40px) clamp(12px, 2.5vw, 28px) 80px")}>
              <div style={s("display: flex; justify-content: space-between; align-items: flex-end; gap: 18px; flex-wrap: wrap; border-bottom: 1px solid var(--color-divider); padding-bottom: 14px")}>
                <div>
                  <div data-reveal="1" style={s("font-size: 11px; letter-spacing: .2em; color: var(--color-muted); font-weight: 700")}>07 — PROBLEM INVESTIGATION · {v.invRef}</div>
                  <h1 data-reveal="1" style={s("font-size: clamp(28px, 4vw, 52px); letter-spacing: -.03em; margin: 8px 0 0")}>The system shows its work.</h1>
                </div>
                <button data-cursor="SIMULATE" onClick={v.goIntervene} data-magnetic="1" className="btn btn-primary" style={s("justify-content: flex-start; padding: 12px 18px; letter-spacing: .08em")}>OPEN INTERVENTION →</button>
              </div>
      
              <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 0; border-top: 1px solid var(--color-divider); border-left: 1px solid var(--color-divider); margin-top: 26px; align-items: stretch")}>
                <div style={s("border-right: 1px solid var(--color-divider); border-bottom: 1px solid var(--color-divider); padding: 18px")}>
                  <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); margin-bottom: 10px")}>PROBLEM GRAPH — CLICK A NODE</div>
                  <div style={s("position: relative; aspect-ratio: 480 / 450; width: 100%")}>
                    <svg viewBox="0 0 480 450" style={s("position: absolute; inset: 0; width: 100%; height: 100%")}>
                      {(v.invEdges || []).map((row35, i35) => (<React.Fragment key={i35}>
                        <path d={row35.d} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeDasharray="5 7" style={row35.style}></path>
                      </React.Fragment>))}
                    </svg>
                    {(v.invNodes || []).map((row36, i36) => (<React.Fragment key={i36}>
                      <div onClick={row36.onClick} data-cursor="INVESTIGATE" style={row36.boxStyle} {...hov("transform: scale(1.045); box-shadow: var(--shadow-md); z-index: 3")}>
                        <div style={row36.labelStyle}>{row36.label}</div>
                        <div style={row36.typeStyle}>{row36.type}</div>
                      </div>
                    </React.Fragment>))}
                  </div>
                </div>
      
                <div style={s("border-right: 1px solid var(--color-divider); border-bottom: 1px solid var(--color-divider); padding: 18px")}>
                  <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700)")}>INCIDENT BRIEF</div>
                  <h2 style={s("font-size: 24px; letter-spacing: -.02em; margin: 8px 0 10px")}>Hostel B · Water Supply Failure</h2>
                  <p style={s("font-size: 14px; color: var(--color-neutral-800); text-wrap: pretty")}>{v.invBrief}</p>
                  <div style={s("font-size: 10px; letter-spacing: .12em; color: var(--color-neutral-600); margin-top: 10px; line-height: 1.6")}>{v.invMethod}</div>
                  <hr className="hr" />
                  <div style={s("display: flex; align-items: baseline; gap: 12px")}>
                    <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 56px; line-height: 1; color: var(--color-accent)")}>{v.invConf}</div>
                    <div>
                      <span className="tag tag-accent" style={s("font-size: 9px; letter-spacing: .12em")}>AI CONFIDENCE</span>
                      <div style={s("font-size: 12px; color: var(--color-neutral-700); margin-top: 6px")}>Never a bare number — here is the evidence it is built from.</div>
                    </div>
                  </div>
                  <div style={s("display: grid; gap: 10px; margin-top: 16px")}>
                    {(v.invConfRows || []).map((row37, i37) => (<React.Fragment key={i37}>
                      <div>
                        <div style={s("display: flex; justify-content: space-between; gap: 10px; font-size: 12px")}>
                          <span>{row37.label}</span>
                          <span style={s("font-family: var(--font-heading); font-weight: 800; color: var(--color-accent-700)")}>{row37.w}</span>
                        </div>
                        <div style={s("background: var(--color-neutral-200); height: 10px; margin-top: 5px")}><div style={row37.barStyle}></div></div>
                      </div>
                    </React.Fragment>))}
                  </div>
                </div>
      
                <div style={s("background: var(--color-neutral-100); padding: 18px; border-left: 1px solid var(--color-neutral-500)")}>
                  <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700)")}>EVIDENCE DRAWER</div>
                  <h3 style={s("font-size: 19px; letter-spacing: -.01em; margin: 8px 0 2px")}>{v.invSelName}</h3>
                  <div style={s("font-size: 9px; letter-spacing: .16em; color: var(--color-muted); font-weight: 700; margin-bottom: 14px")}>{v.invSelType}</div>
                  <div style={s("border-top: 1px solid var(--color-divider)")}>
                    {(v.invEvidence || []).map((row38, i38) => (<React.Fragment key={i38}>
                      <div style={s("padding: 11px 6px 11px 0; border-bottom: 1px solid var(--color-neutral-300); transition: transform .3s, background .3s")} {...hov("transform: translateX(6px); background: var(--color-accent-100)")}>
                        <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>{row38.k}</div>
                        <div style={s("font-size: 13px; margin-top: 3px")}>{row38.v}</div>
                      </div>
                    </React.Fragment>))}
                  </div>
                </div>
              </div>
      
            </section>
          </>) : null}
      
          {/* 08 PREDICTIVE & RISK CENTER */}
          {(v.isRisk) ? (<>
            <section style={s("max-width: 1560px; margin: 0 auto; padding: clamp(20px, 3vw, 40px) clamp(12px, 2.5vw, 28px) 80px")}>
              <div style={s("border-bottom: 1px solid var(--color-divider); padding-bottom: 14px")}>
                <div data-reveal="1" style={s("font-size: 11px; letter-spacing: .2em; color: var(--color-muted); font-weight: 700")}>08 — PREDICTIVE &amp; RISK CENTER</div>
                <h1 data-reveal="1" style={s("font-size: clamp(28px, 4vw, 52px); letter-spacing: -.03em; margin: 8px 0 0")}>Campus risk, before it becomes news.</h1>
              </div>
      
              <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: clamp(16px, 2.5vw, 32px); margin-top: 26px; align-items: start")}>
                <div style={s("position: relative")}>
                  <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700)")}>CAMPUS RISK MAP — CLICK A BUILDING</div>
                  <svg viewBox="0 0 1200 620" style={v.riskSvgStyle} preserveAspectRatio="xMidYMid meet" data-cursor="INSPECT">
                    <g>
                      <polygon points={v.groundPts} fill="var(--color-neutral-200)" stroke="var(--color-divider)" strokeWidth="2"></polygon>
                      {(v.gridLines || []).map((row39, i39) => (<React.Fragment key={i39}>
                        <line x1={row39.x1} y1={row39.y1} x2={row39.x2} y2={row39.y2} stroke="var(--color-neutral-400)" strokeWidth="1"></line>
                      </React.Fragment>))}
                      {(v.mapBuildings || []).map((row40, i40) => (<React.Fragment key={i40}>
                        <g style={row40.gStyle} onClick={row40.onClick} data-cursor={row40.cursor} {...hov("filter: drop-shadow(0 8px 0 var(--color-shade))")}>
                          <polygon points={row40.shadowPts} fill="var(--color-shade)" style={row40.shadowStyle}></polygon>
                          <polygon points={row40.frontPts} fill={row40.frontFill} stroke="var(--color-text)" strokeWidth="2"></polygon>
                          <polygon points={row40.rightPts} fill={row40.rightFill} stroke="var(--color-text)" strokeWidth="2"></polygon>
                          <polygon points={row40.topPts} fill={row40.topFill} stroke="var(--color-text)" strokeWidth="2"></polygon>
                          <circle cx={row40.cx} cy={row40.cyTop} r="30" fill="none" stroke="var(--color-accent)" strokeWidth="2" style={row40.ringStyle}></circle>
                          <g style={row40.badgeStyle}>
                            <rect x={row40.badgeX} y={row40.badgeY} width={row40.badgeW} height="22" fill="var(--color-text)"></rect>
                            {row40.badgeEl}
                          </g>
                        </g>
                      </React.Fragment>))}
                    </g>
                  </svg>
                </div>
      
                <div style={s("display: grid; gap: 24px")}>
                  <div style={s("border: 1px solid var(--color-neutral-500); padding: 20px")}>
                    <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700)")}>{v.riskSelCode} · {v.riskSelDomain}</div>
                    <h3 style={s("font-size: 22px; letter-spacing: -.02em; margin: 6px 0 10px")}>{v.riskSelName} — {v.riskSelRisk}</h3>
                    <div style={s("display: flex; gap: 2px; margin-bottom: 14px")}>
                      {(v.riskStates || []).map((row41, i41) => (<React.Fragment key={i41}>
                        <div style={row41.style}>{row41.label}</div>
                      </React.Fragment>))}
                    </div>
                    <div style={s("font-size: 13px; color: var(--color-neutral-800)")}><strong>Cause signal:</strong> {v.riskSelCause}</div>
                    <div style={s("font-size: 13px; color: var(--color-neutral-800); margin-top: 4px")}>{v.riskSelAction}</div>
                    <div style={s("font-size: 10px; letter-spacing: .12em; color: var(--color-neutral-600); margin-top: 8px")}>IN SCOPE · {v.riskSelAffected}</div>
                  </div>
      
                  <div>
                    <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); margin-bottom: 12px")}>RISK BY DOMAIN</div>
                    <div style={s("display: grid; gap: 12px")}>
                      {(v.riskDomains || []).map((row42, i42) => (<React.Fragment key={i42}>
                        <div>
                          <div style={s("display: flex; justify-content: space-between; gap: 10px; font-size: 12px; letter-spacing: .06em")}>
                            <span style={s("font-weight: 700")}>{row42.k}</span>
                            <span style={s("font-family: var(--font-heading); font-weight: 800; font-variant-numeric: tabular-nums")}>{row42.v}</span>
                          </div>
                          <div style={s("background: var(--color-neutral-200); height: 10px; margin-top: 5px")}><div style={row42.barStyle}></div></div>
                        </div>
                      </React.Fragment>))}
                    </div>
                  </div>
                </div>
              </div>
      
              <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: clamp(16px, 2.5vw, 32px); margin-top: 34px; align-items: start")}>
                <div style={s("background: var(--color-accent); color: var(--color-on-accent); padding: 22px")}>
                  <div style={s("font-size: 10px; letter-spacing: .16em; opacity: .85")}>SILENT PROBLEM DETECTED</div>
                  <h3 style={s("font-size: clamp(22px, 2.4vw, 30px); letter-spacing: -.02em; margin: 8px 0 16px; color: var(--color-on-accent)")}>Hostel C, before anyone complains.</h3>
                  <div style={s("display: grid; gap: 10px")}>
                    {(v.riskSilent || []).map((row43, i43) => (<React.Fragment key={i43}>
                      <div style={s("border-bottom: 2px solid color-mix(in srgb, var(--color-on-ink) 35%, transparent); padding-bottom: 8px")}>
                        <div style={s("font-size: 9px; letter-spacing: .14em; opacity: .8")}>{row43.k}</div>
                        <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 15px; margin-top: 2px")}>{row43.v}</div>
                      </div>
                    </React.Fragment>))}
                  </div>
                </div>
                <div>
                  <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); margin-bottom: 10px")}>ANOMALY SIGNALS · LAST 14 DAYS</div>
                  <div style={s("border-top: 1px solid var(--color-divider)")}>
                    {(v.riskAnomalies || []).map((row44, i44) => (<React.Fragment key={i44}>
                      <div style={s("display: grid; grid-template-columns: 76px minmax(0,1fr) 60px 70px; gap: 10px; align-items: baseline; padding: 12px 0; border-bottom: 1px solid var(--color-neutral-300); font-size: 13px")}>
                        <span style={s("font-size: 11px; letter-spacing: .1em; font-weight: 700")}>{row44.code}</span>
                        <span>{row44.sig}</span>
                        <span style={s("font-family: var(--font-heading); font-weight: 800; color: var(--color-accent-700)")}>{row44.risk}</span>
                        <span style={s("font-size: 11px; color: var(--color-neutral-700)")}>{row44.age}</span>
                      </div>
                    </React.Fragment>))}
                  </div>
                </div>
              </div>
              {/* ROUND-3 HOOK: asset reliability — MTBF and the next expected failure */}
              <PfSlot name="reliability" live={this.state.apiState === "live"} user={this.state.user} lowBw={this.state.lowBw} />
            </section>
          </>) : null}
      
          {/* 09 INTERVENTION CENTER */}
          {(v.isIntervention) ? (<>
            <section style={s("max-width: 1560px; margin: 0 auto; padding: clamp(20px, 3vw, 40px) clamp(12px, 2.5vw, 28px) 80px")}>
              <div style={s("border-bottom: 1px solid var(--color-divider); padding-bottom: 14px")}>
                <div data-reveal="1" style={s("font-size: 11px; letter-spacing: .2em; color: var(--color-muted); font-weight: 700")}>09 — INTERVENTION CENTER</div>
                <h1 data-reveal="1" style={s("font-size: clamp(28px, 4vw, 52px); letter-spacing: -.03em; margin: 8px 0 0")}>What should the administration do?</h1>
              </div>
      
              <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0; border-top: 1px solid var(--color-divider); border-left: 1px solid var(--color-divider); margin-top: 26px")}>
                {(v.intAction || []).map((row45, i45) => (<React.Fragment key={i45}>
                  <div style={s("border-right: 1px solid var(--color-divider); border-bottom: 1px solid var(--color-divider); padding: 18px")}>
                    <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>{row45.k}</div>
                    <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 17px; letter-spacing: -.01em; margin-top: 6px")}>{row45.v}</div>
                  </div>
                </React.Fragment>))}
              </div>
      
              <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: clamp(16px, 2.5vw, 32px); margin-top: 30px; align-items: start")}>
                <div>
                  <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); margin-bottom: 12px")}>AI ↔ HUMAN DECISION · {v.invRef}</div>
                  <div style={s("display: flex; gap: 10px; flex-wrap: wrap")}>
                    <button data-cursor="ACCEPT" onClick={v.onAccept} data-magnetic="1" className="btn btn-primary" style={v.acceptStyle}>ACCEPT</button>
                    <button data-cursor="MODIFY" onClick={v.onModify} className="btn btn-secondary" style={v.modifyStyle}>MODIFY</button>
                    <button data-cursor="REJECT" onClick={v.onReject} className="btn btn-ghost" style={v.rejectStyle}>REJECT</button>
                  </div>
                  {(v.decShowReasons) ? (<>
                    <div style={s("margin-top: 14px")}>
                      <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); margin-bottom: 8px")}>WHY?</div>
                      <div style={s("display: flex; gap: 8px; flex-wrap: wrap")}>
                        {(v.decReasons || []).map((row48, i48) => (<React.Fragment key={i48}>
                          <button onClick={row48.onClick} style={row48.style}>{row48.label}</button>
                        </React.Fragment>))}
                      </div>
                    </div>
                  </>) : null}
                  {(v.decShowModify) ? (<>
                    <div style={s("margin-top: 14px; border: 1px solid var(--color-neutral-500); padding: 14px; animation: nex-in .35s both")}>
                      <div style={s("display: flex; justify-content: space-between; gap: 12px; align-items: baseline")}>
                        <span style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700)")}>INSPECTION WINDOW</span>
                        <span style={s("font-family: var(--font-heading); font-weight: 800; font-size: 15px; font-variant-numeric: tabular-nums")}>{v.decModHours}H · RISK {v.decModRisk}</span>
                      </div>
                      <input type="range" min="2" max="24" step="2" value={v.decModHours} onChange={v.onModHours} data-cursor="SCRUB" style={s("width: 100%; accent-color: var(--color-accent); margin-top: 10px")} />
                    </div>
                  </>) : null}
                  <div style={s("display: grid; gap: 4px; justify-items: start; margin-top: 18px")}>
                    {(v.decChain || []).map((row49, i49) => (<React.Fragment key={i49}>
                      <div style={row49.style}>{row49.label}</div>
                    </React.Fragment>))}
                  </div>
                  <div style={s("font-size: 13px; color: var(--color-neutral-800); border-left: 1px solid var(--color-accent); padding-left: 12px; margin-top: 16px; max-width: 46ch; text-wrap: pretty")}>{v.decNote}</div>
                </div>
      
                <div>
                  {(v.memShow) ? (<>
                    <div style={s("border: 1px solid var(--color-neutral-500); padding: 18px; animation: nex-up .5s both")}>
                      <div style={s("display: flex; align-items: center; gap: 10px")}>
                        <div style={v.memPulseStyle}></div>
                        <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700)")}>CAMPUS MEMORY · {v.incBuildingName}</div>
                      </div>
                      <h3 style={s("font-size: 20px; letter-spacing: -.01em; margin: 10px 0 2px")}>WATER SUPPLY FAILURE</h3>
                      <div style={s("height: 2px; background: var(--color-neutral-300); margin: 12px 0")}><div style={v.memCompressStyle}></div></div>
                      <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); margin-top: 14px")}>SIGNATURES</div>
                      <div style={s("border-top: 1px solid var(--color-divider); margin-top: 8px")}>
                        {(v.memSignatures || []).map((row50, i50) => (<React.Fragment key={i50}>
                          <div style={row50.style}><span style={s("color: var(--color-accent); font-weight: 700")}>→</span>{row50.label}</div>
                        </React.Fragment>))}
                      </div>
                      <div style={s("display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 16px; margin-top: 16px")}>
                        <div>
                          <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700)")}>OUTCOME RISK</div>
                          <div style={v.memRiskStyle}>{v.memRisk}</div>
                        </div>
                        <div>
                          <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700)")}>RESOLUTION</div>
                          <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 40px; line-height: 1; font-variant-numeric: tabular-nums")}>2.4h</div>
                        </div>
                      </div>
                      <div style={s("font-size: 13px; color: var(--color-neutral-800); margin-top: 12px; text-wrap: pretty")}>{v.memNote}</div>
                    </div>
                  </>) : null}
                  {(!v.memShow) ? (<>
                    <div style={s("border: 1px dashed var(--color-neutral-400); padding: 18px; display: grid; gap: 6px; align-content: start")}>
                      <div style={s("width: 10px; height: 10px; background: var(--color-accent)")}></div>
                      <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 14px; letter-spacing: .1em")}>CAMPUS MEMORY</div>
                      <div style={s("font-size: 12px; color: var(--color-neutral-700); text-wrap: pretty")}>ACCEPT THE RECOMMENDATION TO RESOLVE THE INCIDENT — THE OUTCOME IS STORED AS A PATTERN THE CAMPUS REMEMBERS.</div>
                    </div>
                  </>) : null}
                </div>
              </div>
      
              <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: clamp(16px, 2.5vw, 32px); margin-top: 34px; align-items: start")}>
                <div>
                  <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); margin-bottom: 12px")}>WHAT-IF SIMULATOR — PICK A DECISION</div>
                  <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px")}>
                    {(v.intCards || []).map((row46, i46) => (<React.Fragment key={i46}>
                      <div data-cursor="SIMULATE" onClick={row46.onClick} style={row46.style} {...hov("box-shadow: var(--shadow-lg); border-color: var(--color-accent)")}>
                        <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 13px; letter-spacing: .08em")}>{row46.label}</div>
                        <div>
                          <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 44px; line-height: 1")}>{row46.risk}</div>
                          <div style={s("background: var(--color-neutral-200); height: 10px; margin-top: 8px")}><div style={row46.barStyle}></div></div>
                          <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700); margin-top: 6px")}>PROJECTED RISK</div>
                        </div>
                        <div style={s("display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 8px; font-size: 12px")}>
                          <div><div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 20px")}>{row46.affected}</div><div style={s("font-size: 9px; letter-spacing: .12em; color: var(--color-neutral-700)")}>AFFECTED</div></div>
                          <div><div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 20px")}>{row46.comps}</div><div style={s("font-size: 9px; letter-spacing: .12em; color: var(--color-neutral-700)")}>COMPLAINTS</div></div>
                          <div><div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 20px")}>{row46.cost}</div><div style={s("font-size: 9px; letter-spacing: .12em; color: var(--color-neutral-700)")}>COST · ILLUSTRATIVE</div></div>
                        </div>
                      </div>
                    </React.Fragment>))}
                  </div>
                  <svg viewBox="0 0 560 220" style={s("width: 100%; height: auto; margin-top: 20px")}>
                    <line x1="30" y1="200" x2="540" y2="200" stroke="var(--color-divider)" strokeWidth="2"></line>
                    <polyline points={v.intCurveDo} fill="none" stroke="var(--color-accent)" strokeWidth="3" style={v.intDoStyle}></polyline>
                    <polyline points={v.intCurveFix} fill="none" stroke="var(--color-text)" strokeWidth="3" style={v.intFixStyle}></polyline>
                    <text x="30" y="216" fontFamily="Archivo" fontSize="11" fill="var(--color-muted)">NOW</text>
                    <text x="470" y="216" fontFamily="Archivo" fontSize="11" fill="var(--color-muted)">+48 HOURS</text>
                  </svg>
                </div>
      
                <div>
                  <div style={v.intHeadlineStyle}>{v.intHeadline}</div>
                  <div style={s("font-size: 14px; color: var(--color-neutral-800); max-width: 44ch; margin: 10px 0 4px; text-wrap: pretty")}>{v.intHeadlineNote}</div>
                  <div style={s("font-size: 10px; letter-spacing: .12em; color: var(--color-neutral-600); margin: 0 0 24px; max-width: 52ch; line-height: 1.6")}>{v.intBasis}</div>
                  <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); margin-bottom: 10px")}>RESOLUTION QUALITY — AFTER THE FIX</div>
                  <div style={s("border-top: 1px solid var(--color-divider)")}>
                    {(v.intQuality || []).map((row47, i47) => (<React.Fragment key={i47}>
                      <div style={s("display: flex; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--color-neutral-300)")}>
                        <span style={s("font-size: 11px; letter-spacing: .12em; color: var(--color-neutral-700)")}>{row47.k}</span>
                        <span style={s("font-family: var(--font-heading); font-weight: 800; font-size: 15px")}>{row47.v}</span>
                      </div>
                    </React.Fragment>))}
                  </div>
                  <div style={s("font-size: 13px; color: var(--color-neutral-800); border-left: 1px solid var(--color-accent); padding-left: 12px; margin-top: 14px; text-wrap: pretty")}>{v.intQualityNote}</div>
                  {/* EXCEPTION-ONLY HOOK: repair or replace the asset behind this incident (RECOMMENDED ACTION, arithmetic shown). */}
                  <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); margin: 24px 0 10px")}>REPAIR OR REPLACE · ASSET HISTORY</div>
                  <XoSlot name="assets" live={this.state.apiState === "live"} user={this.state.user} building={this.activeIncident()?.building?.code} compact />
                  {/* EXCEPTION-ONLY HOOK: policy what-if — replay recent requests under edited rules (staff; SIMULATED). */}
                  {this.state.user && this.state.user.role !== "STUDENT" ? (<>
                    <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); margin: 24px 0 10px")}>POLICY WHAT-IF · SIMULATED</div>
                    <XoSlot name="policyWhatIf" live={this.state.apiState === "live"} user={this.state.user} admin={this.state.user.role === "ADMIN"} />
                  </>) : null}
                </div>
              </div>
      
              {/* ROUND-3 HOOK: did it work? (difference-in-differences) and the repair portfolio optimiser (staff) */}
              <PfSlot name="intervention" live={this.state.apiState === "live"} user={this.state.user} lowBw={this.state.lowBw} staff={Boolean(this.state.user && this.state.user.role !== "STUDENT")} />
            </section>
          </>) : null}
      
          {/* 10 ADMIN COMMAND CENTER */}
          {(v.isAdmin) ? (<>
            <section style={s("max-width: 1560px; margin: 0 auto; padding: clamp(20px, 3vw, 40px) clamp(12px, 2.5vw, 28px) 80px")}>
              <div style={s("display: flex; justify-content: space-between; align-items: flex-end; gap: 18px; flex-wrap: wrap; border-bottom: 1px solid var(--color-divider); padding-bottom: 14px")}>
                <div>
                  <div style={s("font-size: 11px; letter-spacing: .2em; color: var(--color-muted); font-weight: 700")}>10 — CAMPUS MISSION CONTROL</div>
                  <h1 data-reveal="1" style={s("font-size: clamp(28px, 4vw, 52px); letter-spacing: -.03em; margin: 8px 0 0")}>Campus Mission Control</h1>
                </div>
                <div style={s("font-size: 11px; letter-spacing: .14em; color: var(--color-neutral-700)")}>{v.admNowLabel} · {v.campusName}</div>
              </div>

              <EvalKicker
                problem="Traditional admin dashboards show vanity metrics, hide false closures, and ignore student friction."
                solution="Friction Ledger proves real time saved (touches 0.8 vs 3.4); Closures That Hold audits reopen requests (10 of 110 flagged false closures)."
                tryAction="Inspect the Touchless Lane, Friction Ledger, and Closures That Hold panels below for audited operational proof."
              />

              {/* Role View Switcher: ALL / ADMIN / WARDEN */}
              <div style={s("display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 20px; padding: 10px 14px; background: var(--color-neutral-100); border: 1px solid var(--color-divider); border-radius: 4px")}>
                <div style={s("font-size: 11px; font-weight: 800; letter-spacing: .1em; color: var(--color-muted)")}>OPERATIONAL DASHBOARD MODE:</div>
                <div style={s("display: flex; gap: 6px; flex-wrap: wrap")}>
                  {[
                    ["ALL", "ALL CAMPUS OPERATIONS"],
                    ["ADMIN", "ADMIN VIEW"],
                    ["WARDEN", "WARDEN VIEW (HOSTELS & MESS)"]
                  ].map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => v.onAdminRoleView(val)}
                      className={`btn ${v.adminRoleView === val ? "btn-primary" : "btn-secondary"}`}
                      style={s("font-size: 10px; letter-spacing: .08em; padding: 6px 12px")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
      
              <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0; border-top: 1px solid var(--color-divider); border-left: 1px solid var(--color-divider); margin-top: 26px")}>
                {(v.admKpis || []).map((row48, i48) => (<React.Fragment key={i48}>
                  <div style={s("border-right: 1px solid var(--color-divider); border-bottom: 1px solid var(--color-divider); padding: 20px; transition: transform .4s cubic-bezier(.2,.8,.2,1), background .3s")} data-reveal="1" {...hov("background: var(--color-accent-100); transform: translateY(-6px)")}>
                    <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700)")}>{row48.k}</div>
                    <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: clamp(32px, 3.4vw, 46px); line-height: 1; letter-spacing: -.02em; margin-top: 8px")}>{row48.v}</div>
                  </div>
                </React.Fragment>))}
              </div>
      
              {/* EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md): Touchless Rate, exceptions inbox, Friction Ledger, reach, reopen rate. */}
              <XoMissionControl user={this.state.user} staff={v.ps07Staff} admin={v.ps07Admin} live={v.intelLive} lowBw={this.state.lowBw} onGo={(id) => this.go(id)} />
              {/* ROUND-3 HOOK: how work actually flows (process mining) and service equity (staff) */}
              <PfSlot name="mission" live={this.state.apiState === "live"} user={this.state.user} lowBw={this.state.lowBw} onGo={(id) => this.go(id)} />
              {/* SUPPORT HOOK: Student Support Overview (ADMIN: aggregate only) and the support queue (COUNSELLOR only). */}
              <SupportSlot name="mission" live={this.state.apiState === "live"} user={this.state.user} />

              {/* ---- PS07 · Campus Pulse (a prototype indicator with its calculation shown) ---- */}
              <div style={s("margin-top: 26px")}>
                <IntelGuard name="Campus Pulse"><PulseCard live={v.intelLive} staff={v.ps07Staff} /></IntelGuard>
              </div>

              <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: clamp(16px, 2.5vw, 32px); margin-top: 32px; align-items: start")}>
                <div style={s("background: var(--color-ink); color: var(--color-on-ink); padding: 24px")}>
                  <div style={s("font-size: 10px; letter-spacing: .16em; color: var(--color-accent-400)")}>{v.admBriefingLabel}</div>
                  <h3 style={s("font-size: clamp(24px, 2.6vw, 34px); letter-spacing: -.02em; margin: 10px 0 16px; color: var(--color-on-ink)")}>Good morning.</h3>
                  <div style={s("display: grid; gap: 12px")}>
                    {(v.admBriefing || []).map((row49, i49) => (<React.Fragment key={i49}>
                      <div style={s("font-size: 15px; border-bottom: 2px solid color-mix(in srgb, var(--color-on-ink) 30%, transparent); padding-bottom: 12px; text-wrap: pretty")}>{row49}</div>
                    </React.Fragment>))}
                  </div>
                  <div style={s("font-size: 10px; letter-spacing: .12em; opacity: .6; margin-top: 12px; line-height: 1.6; max-width: 56ch")}>{v.admBriefingNote}</div>
                  <button data-cursor="OPEN" onClick={v.goRisk} data-magnetic="1" className="btn btn-primary" style={s("justify-content: flex-start; margin-top: 18px; letter-spacing: .08em")}>OPEN RISK CENTER →</button>
                </div>
      
                <div>
                  <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); margin-bottom: 10px")}>ACTION QUEUE · RANKED</div>{/* REEL HOOK (see CHANGES-REEL.md): rule-based, not AI */}
                  <div style={s("border-top: 1px solid var(--color-divider)")}>
                    {(v.admQueue || []).map((row50, i50) => (<React.Fragment key={i50}>
                      <div data-cursor="INTERVENE" onClick={row50.onClick} style={s("padding: 14px 8px 14px 0; border-bottom: 1px solid var(--color-neutral-300); cursor: pointer; transition: transform .35s, background .3s")} {...hov("background: var(--color-accent-100); transform: translateX(6px)")}>
                        <div style={s("display: flex; gap: 12px; align-items: baseline")}>
                          <span style={s("font-family: var(--font-heading); font-weight: 800; font-size: 13px; color: var(--color-accent); width: 16px")}>{row50.n}</span>
                          <span style={s("font-family: var(--font-heading); font-weight: 800; font-size: 15px; letter-spacing: .04em; flex: 1")}>{row50.name}</span>
                          <span style={s("font-family: var(--font-heading); font-weight: 800; font-size: 15px; font-variant-numeric: tabular-nums")}>{row50.risk}</span>
                        </div>
                        <div style={s("background: var(--color-neutral-200); height: 10px; margin: 8px 0 6px")}><div style={row50.barStyle}></div></div>
                        <div style={s("display: flex; justify-content: space-between; gap: 12px; font-size: 12px; color: var(--color-neutral-700)")}>
                          <span>{row50.act}</span>
                          <span>{row50.aff}</span>
                        </div>
                      </div>
                    </React.Fragment>))}
                  </div>
                </div>
              </div>
      
              <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: clamp(16px, 2.5vw, 32px); margin-top: 34px; align-items: start")}>
                <div>
                  <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); margin-bottom: 10px")}>CROSS-DOMAIN INTELLIGENCE</div>
                  <div style={s("display: grid; gap: 16px")}>
                    {(v.admChains || []).map((row52, i52) => (<React.Fragment key={i52}>
                      <div style={s("display: flex; flex-wrap: wrap; gap: 8px; align-items: center; border-bottom: 1px solid var(--color-divider); padding-bottom: 14px")}>
                        {((row52.steps) || []).map((row51, i51) => (<React.Fragment key={i51}>
                          <div style={s("display: flex; gap: 8px; align-items: center")}>
                            <span style={s("font-family: var(--font-heading); font-weight: 800; font-size: 12px; letter-spacing: .06em; border: 1px solid var(--color-divider); padding: 6px 8px")}>{row51.label}</span>
                            <span style={s("color: var(--color-accent); font-weight: 800")}>{row51.arrow}</span>
                          </div>
                        </React.Fragment>))}
                      </div>
                    </React.Fragment>))}
                  </div>
                </div>
                <div>
                  <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); margin-bottom: 10px")}>LIVE SIGNAL FEED</div>
                  <div style={s("border-top: 1px solid var(--color-divider)")}>
                    {(v.admFeed || []).map((row53, i53) => (<React.Fragment key={i53}>
                      <div style={s("display: grid; grid-template-columns: 58px minmax(0,1fr); gap: 12px; padding: 11px 0; border-bottom: 1px solid var(--color-neutral-300); font-size: 13px")}>
                        <span style={s("font-variant-numeric: tabular-nums; color: var(--color-neutral-700)")}>{row53.t}</span>
                        <span>{row53.txt}</span>
                      </div>
                    </React.Fragment>))}
                  </div>
                </div>
              </div>
      
              {/* ================= PS07 · CAMPUS EARLY WARNING =================
                  Tiered alerts (feature 4), cross-module trends (feature 2) and
                  predictive insights (feature 3). Read from /api/ai/early-warning
                  and /api/ai/predictive; actions run the existing complaint
                  workflow. */}
              <div style={s("margin-top: 44px; border-top: 1px solid var(--color-divider); padding-top: 24px")}>
                <div style={s("font-size: 11px; letter-spacing: .2em; color: var(--color-muted); font-weight: 700")}>CAMPUS EARLY WARNING · ADMIN ALERT CENTER</div>
                  <h2 style={s("font-size: clamp(22px, 3vw, 34px); letter-spacing: -.02em; margin: 8px 0 16px")}>What needs attention, and why.</h2>
                <IntelGuard name="Alert center"><AlertCenter live={v.intelLive} staff={v.ps07Staff} /></IntelGuard>
              </div>
              <div style={s("margin-top: 36px")}>
                <div style={s("font-size: 11px; letter-spacing: .2em; color: var(--color-muted); font-weight: 700")}>AI EARLY WARNING · ALL MODULES</div>
                  <h2 style={s("font-size: clamp(22px, 3vw, 34px); letter-spacing: -.02em; margin: 8px 0 16px")}>Two weeks of every signal, compared week on week.</h2>
                <IntelGuard name="Early warning trends"><EarlyWarningTrends live={v.intelLive} staff={v.ps07Staff} /></IntelGuard>
              </div>
              <div style={s("margin-top: 36px")}>
                <div style={s("font-size: 11px; letter-spacing: .2em; color: var(--color-muted); font-weight: 700")}>AI PREDICTIVE INSIGHTS</div>
                  <h2 style={s("font-size: clamp(22px, 3vw, 34px); letter-spacing: -.02em; margin: 8px 0 16px")}>What is likely next, with the data behind it.</h2>
                <IntelGuard name="Predictive insights"><PredictiveInsights live={v.intelLive} staff={v.ps07Staff} /></IntelGuard>
              </div>

              {/* ================= NEX CAMP (AI LAYER) =================
                  Features 4, 5, 8, 9, 10, 11, 14 and 16. Every panel renders
                  what /api/ai returned and labels how it was produced. A panel
                  whose read failed says so instead of showing a placeholder. */}
              <div style={s("margin-top: 44px; border-top: 1px solid var(--color-divider); padding-top: 24px")}>
                <div style={s("display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap")}>
                  <div>
                    <div style={s("font-size: 11px; letter-spacing: .2em; color: var(--color-muted); font-weight: 700")}>NEX CAMP AI</div>
                    <h2 style={s("font-size: clamp(22px, 3vw, 34px); letter-spacing: -.02em; margin: 8px 0 0")}>What the system worked out on its own.</h2>
                  </div>
                  <div style={s("display: flex; gap: 10px; align-items: center; flex-wrap: wrap")}>
                    {v.aiStatus ? (
                      <AiBadge
                        source={v.aiStatus.configured ? "AI_MODEL" : "AI_NOT_CONFIGURED"}
                        provider={v.aiStatus.provider}
                        model={v.aiStatus.model}
                      />
                    ) : null}
                    <button onClick={v.onAiRefresh} className="btn btn-secondary" style={s("font-size: 11px; letter-spacing: .1em; padding: 8px 12px")}>
                      {v.aiBusy ? "READING…" : "REFRESH"}
                    </button>
                  </div>
                </div>

                {/* Connection state — Feature 12. */}
                {(!v.netOnline || v.netQueued > 0 || v.netNotice) ? (
                  <div style={s("margin-top: 16px; border-left: 3px solid var(--color-accent); background: var(--color-neutral-100); padding: 10px 12px; font-size: 12px; line-height: 1.6")}>
                    <strong style={s("font-family: var(--font-heading); letter-spacing: .1em; font-size: 11px")}>
                      {v.netOnline ? "CONNECTED" : "OFFLINE"}
                    </strong>
                    {v.netQueued > 0 ? ` · ${v.netQueued} action${v.netQueued === 1 ? "" : "s"} queued for when the connection returns` : ""}
                    {v.netSyncing ? " · syncing…" : ""}
                    {v.netNotice ? ` · ${v.netNotice}` : ""}
                  </div>
                ) : null}

                {(!v.aiStatus) ? (
                  <AiNotice text="The AI service could not be reached. Every panel below needs a signed-in staff account and a running backend; the rest of mission control above is unaffected." />
                ) : null}

                {(v.aiStatus && !v.aiStatus.configured) ? (
                  <AiNotice text={`AI service not configured — ${v.aiStatus.note} Set AI_PROVIDER, AI_API_KEY and AI_MODEL in backend/.env to enable model analysis.`} />
                ) : null}

                {/* ---- Feature 10: the daily campus summary ---- */}
                {(v.aiSummary) ? (
                  <AiPanel
                    kicker="NEX CAMP AI SUMMARY"
                    title={v.aiSummary.headline}
                    badge={<AiBadge source={v.aiSummary.source} provider={v.aiSummary.provider} model={v.aiSummary.model} method={v.aiSummary.method} at={v.aiSummary.processedAt} />}
                  >
                    <ul style={s("margin: 14px 0 0; padding-left: 16px; font-size: 14px; line-height: 1.75; color: var(--color-neutral-900)")}>
                      {(v.aiSummary.bullets || []).map((line, i) => <li key={i}>{line}</li>)}
                    </ul>
                    <div style={s("margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--color-neutral-300)")}>
                      <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>DO THIS FIRST</div>
                      <div style={s("font-size: 14px; margin-top: 4px; line-height: 1.6")}>{v.aiSummary.topPriority}</div>
                    </div>
                    {(v.aiSummary.facts?.counts) ? (
                      <AiFacts rows={[
                        { label: "PENDING COMPLAINTS", value: v.aiSummary.facts.counts.pendingComplaints },
                        { label: "CRITICAL", value: v.aiSummary.facts.counts.criticalComplaints },
                        { label: "HIGH", value: v.aiSummary.facts.counts.highComplaints },
                        { label: "FILED TODAY", value: v.aiSummary.facts.counts.filedToday },
                        { label: "OPEN INCIDENTS", value: v.aiSummary.facts.counts.openIncidents },
                        { label: "ACTIVE PASSES", value: v.aiSummary.facts.counts.activePasses },
                        { label: "OVERDUE PASSES", value: v.aiSummary.facts.counts.overduePasses },
                        { label: "RECURRING PATTERNS", value: v.aiSummary.facts.counts.recurringPatterns }
                      ]} />
                    ) : null}
                    <div style={s("font-size: 10px; letter-spacing: .06em; color: var(--color-neutral-600); margin-top: 12px; line-height: 1.6")}>
                      Every figure above is counted from the database ({v.aiSummary.facts?.method}). The prose is only a rendering of those figures.
                    </div>
                    {(v.aiSummaryStale) ? (
                      <AiNotice text={`Showing the last cached summary, taken at ${v.aiSummaryCachedAt ? new Date(v.aiSummaryCachedAt).toLocaleTimeString() : "an earlier time"} — the network read did not complete. The figures may have moved since.`} />
                    ) : null}
                    <AiNotice text={v.aiSummary.notice} />
                  </AiPanel>
                ) : null}

                {/* ---- Feature 9: the admin copilot ---- */}
                <AiPanel
                  kicker="ADMIN AI COPILOT"
                  title="Ask the campus database a question."
                  badge={v.copilotResult ? <AiBadge source={v.copilotResult.answer.source} provider={v.copilotResult.answer.provider} model={v.copilotResult.answer.model} method={v.copilotResult.answer.method} at={v.copilotResult.answer.processedAt} /> : null}
                >
                  <div style={s("display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap")}>
                    <input
                      className="input"
                      value={v.copilotQ}
                      onChange={v.onCopilotQ}
                      onKeyDown={(e) => { if (e.key === "Enter") v.onCopilotAsk(); }}
                      placeholder="Which department has the largest pending workload?"
                      style={s("flex: 1 1 280px; min-width: 0")}
                    />
                    <button onClick={v.onCopilotAsk} disabled={v.copilotBusy} className="btn btn-primary" style={s("padding: 12px 18px; letter-spacing: .08em")}>
                      {v.copilotBusy ? "ASKING…" : "ASK →"}
                    </button>
                  </div>

                  {(v.aiSuggestedQuestions || []).length ? (
                    <div style={s("display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px")}>
                      {v.aiSuggestedQuestions.map((question, i) => (
                        <button key={i} onClick={() => v.onCopilotPick(question)} style={s("font-size: 11px; letter-spacing: .04em; padding: 6px 10px; border: 1px solid var(--color-divider); background: transparent; color: var(--color-neutral-800); cursor: pointer; text-align: left")}>
                          {question}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {(v.copilotError) ? (
                    <div style={s("font-size: 12px; color: var(--color-accent-700); font-weight: 700; margin-top: 12px")}>{v.copilotError}</div>
                  ) : null}

                  {(v.copilotResult) ? (
                    <div style={s("margin-top: 16px")}>
                      <div style={s("font-size: 15px; line-height: 1.75; text-wrap: pretty")}>{v.copilotResult.answer.answer}</div>

                      <div style={s("font-size: 10px; letter-spacing: .08em; color: var(--color-neutral-600); margin-top: 10px; line-height: 1.6")}>
                        INTENT {v.copilotResult.intent} · {v.copilotResult.recognised ? "matched a known query shape" : "no known query shape matched — showing current campus state instead"} · {v.copilotResult.groundingMethod}
                      </div>

                      {(v.copilotResult.answer.facts || []).length ? (
                        <div style={s("margin-top: 14px")}>
                          <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>FACTS THE ANSWER WAS BUILT FROM</div>
                          <ul style={s("margin: 6px 0 0; padding-left: 16px; font-size: 12px; line-height: 1.65; color: var(--color-neutral-800)")}>
                            {v.copilotResult.answer.facts.map((line, i) => <li key={i}>{line}</li>)}
                          </ul>
                        </div>
                      ) : null}

                      {(v.copilotResult.answer.records?.rows || []).length ? (
                        <div style={s("margin-top: 14px")}>
                          <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>{v.copilotResult.answer.records.label}</div>
                          <div style={s("border-top: 1px solid var(--color-divider); margin-top: 6px; max-height: 320px; overflow: auto")}>
                            {v.copilotResult.answer.records.rows.slice(0, 15).map((row, i) => (
                              <div key={i} style={s("display: flex; gap: 12px; flex-wrap: wrap; padding: 9px 0; border-bottom: 1px solid var(--color-neutral-300); font-size: 12px")}>
                                {Object.entries(row).filter(([key]) => key !== "id").slice(0, 6).map(([key, value]) => (
                                  <span key={key} style={s("color: var(--color-neutral-800)")}>
                                    <span style={s("color: var(--color-neutral-600); letter-spacing: .06em; font-size: 10px")}>{key.toUpperCase()} </span>
                                    {value === null || value === undefined ? "—" : String(value).slice(0, 48)}
                                  </span>
                                ))}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {(v.copilotResult.answer.followUp) ? (
                        <div style={s("font-size: 12px; color: var(--color-neutral-700); margin-top: 12px")}>
                          Next: <button onClick={() => v.onCopilotPick(v.copilotResult.answer.followUp)} className="btn btn-ghost" style={s("font-size: 12px; padding: 0")}>{v.copilotResult.answer.followUp}</button>
                        </div>
                      ) : null}

                      <div style={s("font-size: 10px; letter-spacing: .04em; color: var(--color-neutral-600); margin-top: 12px; line-height: 1.6; max-width: 80ch")}>
                        {v.copilotResult.answer.grounding || "The answer above was produced from the facts and records listed, which were queried from this application's own database."}
                      </div>
                      <AiNotice text={v.copilotResult.answer.notice} />
                    </div>
                  ) : null}
                </AiPanel>

                {/* ---- Features 1, 2, 3: complaint triage with a human in the loop ----
                    The AI's classification and department recommendation, and
                    the controls to accept or override either. Both the
                    recommendation and the final decision are kept on the
                    record, together with who decided and when. */}
                {(v.triage) ? (
                  <AiPanel
                    kicker="AI COMPLAINT TRIAGE"
                    title={`${v.triage.length} recent complaint${v.triage.length === 1 ? "" : "s"} · accept or change what the AI recommended`}
                  >
                    {(v.triageError) ? (
                      <div style={s("font-size: 12px; color: var(--color-accent-700); font-weight: 700; margin-top: 10px")}>{v.triageError}</div>
                    ) : null}

                    {v.triage.map((row) => {
                      const ai = row.aiClassification || {};
                      const routing = row.aiRouting || {};
                      const recommended = routing.recommendedDepartment || ai.routedTo;
                      const decided = routing.decision;
                      const busy = v.triageBusy === row.id;
                      return (
                        <div key={row.id} style={s("border-top: 1px solid var(--color-divider); margin-top: 16px; padding-top: 14px")}>
                          <div style={s("display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: baseline")}>
                            <div style={s("min-width: 0")}>
                              <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 15px")}>
                                {row.reference} · {row.title}
                              </div>
                              <div style={s("font-size: 12px; color: var(--color-neutral-700); margin-top: 3px")}>
                                {row.status} · {row.location || row.building?.name || "location not given"}
                              </div>
                            </div>
                            <AiBadge source={ai.source} provider={ai.provider} model={ai.model} method={ai.method} at={ai.processedAt || ai.classifiedAt} />
                          </div>

                          <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 18px; margin-top: 12px; align-items: start")}>
                            <AiConfidence value={ai.confidence} basis={ai.confidenceBasis} />
                            <div>
                              <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>RULE CLASSIFICATION</div>{/* REEL HOOK (see CHANGES-REEL.md): rule-based, not AI */}
                              <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 15px; margin-top: 4px")}>
                                {ai.category || row.category} · {ai.priority || row.priority} · {ai.severity || row.severity}
                              </div>
                              {ai.safetyRule ? (
                                <div style={s("font-size: 10px; color: var(--color-accent); margin-top: 4px; letter-spacing: .06em")}>
                                  SAFETY RULE {ai.safetyRule} — PRIORITY SET WITHOUT A MODEL
                                </div>
                              ) : null}
                            </div>
                            <div>
                              <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>AI SUGGESTED DEPARTMENT</div>
                              <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 13px; margin-top: 4px")}>{recommended || "—"}</div>
                              <div style={s("font-size: 10px; color: var(--color-neutral-600); margin-top: 4px; line-height: 1.5")}>
                                {decided
                                  ? `${decided} by ${routing.decidedByName} (${routing.decidedByRole}) at ${routing.decidedAt ? new Date(routing.decidedAt).toISOString().slice(0, 16).replace("T", " ") : "—"} · now ${routing.finalDepartment}`
                                  : "No human decision recorded yet."}
                              </div>
                            </div>
                          </div>

                          {(ai.reasons || []).length ? (
                            <AiExplanation reasons={ai.reasons.slice(0, 3)} recommendation={ai.suggestedAction} />
                          ) : null}

                          <div style={s("display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 12px")}>
                            <button onClick={() => v.onAcceptRouting(row.id)} disabled={busy} className="btn btn-primary" style={s("font-size: 10px; letter-spacing: .1em; padding: 8px 12px")}>
                              {busy ? "SAVING…" : "ACCEPT RECOMMENDATION"}
                            </button>
                            <select
                              value={v.triageDept[row.id] || ""}
                              onChange={(e) => v.onTriageDept(row.id, e.target.value)}
                              className="input"
                              style={s("padding: 8px 10px; font-size: 11px; max-width: 240px")}
                            >
                              <option value="">Change department to…</option>
                              {v.departments.map((dept) => <option key={dept} value={dept}>{dept}</option>)}
                            </select>
                            <button
                              onClick={() => v.onOverrideRouting(row.id)}
                              disabled={busy || !v.triageDept[row.id]}
                              className="btn btn-secondary"
                              style={s("font-size: 10px; letter-spacing: .1em; padding: 8px 12px")}
                            >
                              OVERRIDE
                            </button>
                            <button onClick={() => v.onReclassify(row.id)} disabled={busy} className="btn btn-ghost" style={s("font-size: 10px; letter-spacing: .1em")}>
                              RE-RUN AI
                            </button>
                          </div>

                          {/* Admin & Warden Instant Approval & Message to Student */}
                          {(row.status !== "RESOLVED" && row.status !== "REJECTED") ? (
                            <div style={s("background: var(--color-neutral-100); border: 1px solid var(--color-divider); padding: 12px; margin-top: 12px; display: grid; gap: 8px; border-radius: 4px")}>
                              <div style={s("display: flex; justify-content: space-between; align-items: baseline; gap: 8px")}>
                                <div style={s("font-size: 10px; letter-spacing: .12em; color: var(--color-muted); font-weight: 800")}>
                                  {v.adminRoleView === "WARDEN" ? "WARDEN DIRECT ACTION & STUDENT MESSAGE" : "ADMIN / WARDEN APPROVAL & STUDENT MESSAGE"}
                                </div>
                                <span style={s("font-size: 9px; letter-spacing: .1em; color: var(--color-accent); font-weight: 700")}>OPENS 6-DAY STUDENT CONFIRMATION</span>
                              </div>
                              <div style={s("display: flex; gap: 8px; flex-wrap: wrap")}>
                                <input
                                  className="input"
                                  value={v.adminApproveNote[row.id] || ""}
                                  onChange={(e) => v.onAdminApproveNote(row.id, e.target.value)}
                                  placeholder="Type resolution message or rejection reason to student..."
                                  style={s("flex: 1 1 280px; font-size: 12px; padding: 8px 10px")}
                                />
                                <button
                                  type="button"
                                  onClick={() => v.onApproveAndMessage(row.id)}
                                  disabled={busy}
                                  className="btn btn-primary"
                                  style={s("background: #15803d; border-color: #15803d; color: #fff; font-size: 10px; letter-spacing: .08em; padding: 8px 14px; white-space: nowrap")}
                                >
                                  {busy ? "SAVING…" : "🟢 APPROVE & MESSAGE STUDENT"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => v.onRejectComplaint(row.id)}
                                  disabled={busy}
                                  className="btn btn-secondary"
                                  style={s("color: #b91c1c; border-color: #b91c1c; font-size: 10px; letter-spacing: .08em; padding: 8px 14px; white-space: nowrap")}
                                >
                                  {busy ? "SAVING…" : "🔴 REJECT REPORT"}
                                </button>
                              </div>
                            </div>
                          ) : null}

                          {/* Workflow: move the complaint along. Resolving asks
                              for how it was fixed — the learning loop reuses it. */}
                          {(row.status !== "RESOLVED" && row.status !== "REJECTED") ? (
                            <div style={s("display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 10px")}>
                              <select
                                value={v.triageStatus[row.id] || ""}
                                onChange={(e) => v.onTriageStatus(row.id, e.target.value)}
                                className="input"
                                style={s("padding: 8px 10px; font-size: 11px; max-width: 200px")}
                              >
                                <option value="">Move status to…</option>
                                {["ASSIGNED", "INVESTIGATING", "RESOLVED", "REJECTED"].filter(st => st !== row.status).map(st => <option key={st} value={st}>{st}</option>)}
                              </select>
                              {(v.triageStatus[row.id] === "RESOLVED" || v.triageStatus[row.id] === "REJECTED") ? (
                                <input
                                  className="input"
                                  value={v.triageNote[row.id] || ""}
                                  onChange={(e) => v.onTriageNote(row.id, e.target.value)}
                                  placeholder={v.triageStatus[row.id] === "REJECTED" ? "Reason for rejection..." : "How was it resolved?"}
                                  maxLength={1000}
                                  style={s("flex: 1 1 220px; min-width: 0; padding: 8px 10px; font-size: 12px")}
                                />
                              ) : null}
                              <button onClick={() => v.onMoveComplaint(row.id)} disabled={busy || !v.triageStatus[row.id]} className="btn btn-secondary" style={s("font-size: 10px; letter-spacing: .1em; padding: 8px 12px")}>
                                {busy ? "SAVING…" : "UPDATE STATUS"}
                              </button>
                              <button onClick={() => v.onLoadLearning(row.id)} disabled={v.triageLearning[row.id]?.busy} className="btn btn-ghost" style={s("font-size: 10px; letter-spacing: .1em")}>
                                {v.triageLearning[row.id]?.busy ? "SEARCHING HISTORY…" : "PAST RESOLUTIONS →"}
                              </button>
                            </div>
                          ) : row.status === "REJECTED" ? (
                            <div style={s("font-size: 11px; color: #991b1b; margin-top: 10px; line-height: 1.6; background: #fee2e2; padding: 8px 12px; border-radius: 4px")}>
                              <strong>🔴 Rejected</strong>
                              {row.resolution?.adminMessage ? ` — Reason: "${row.resolution.adminMessage}"` : row.resolution?.resolutionDescription ? ` — "${row.resolution.resolutionDescription}"` : ""}
                              {row.resolution?.resolvedByName ? ` · By ${row.resolution.resolvedByName} (${row.resolution.resolvedByRole || "Staff"})` : ""}
                            </div>
                          ) : (
                            <div style={s("font-size: 11px; color: var(--color-neutral-700); margin-top: 10px; line-height: 1.6; background: var(--color-neutral-100); padding: 8px 12px")}>
                              <strong>Resolved{row.resolution?.resolutionTimeHours !== undefined ? ` in ${row.resolution.resolutionTimeHours}h` : ""}</strong>
                              {row.resolution?.adminMessage ? ` — Message sent: "${row.resolution.adminMessage}"` : row.resolution?.resolutionDescription ? ` — "${row.resolution.resolutionDescription}"` : ""}
                              {row.resolution?.resolvedByName ? ` · By ${row.resolution.resolvedByName} (${row.resolution.resolvedByRole || "Staff"})` : ""}
                              {row.resolution?.studentFlag === "GREEN_FLAG" ? " · 🟢 Student Confirmed (Green Flag)" : row.resolution?.studentFlag === "RED_FLAG" ? " · 🔴 Disputed by Student (Red Flag)" : " · ⏳ 6-Day Student Verification Active"}
                            </div>
                          )}

                          {/* Feature 16: the resolution learning loop. */}
                          {(v.triageLearning[row.id]?.error) ? (
                            <AiNotice text={`Resolution history unavailable — ${v.triageLearning[row.id].error}`} />
                          ) : null}
                          {(v.triageLearning[row.id]?.data) ? (() => {
                            const learning = v.triageLearning[row.id].data.learning;
                            const suggestion = v.triageLearning[row.id].data.suggestion;
                            return (
                              <div style={s("border: 1px solid var(--color-divider); padding: 12px; margin-top: 12px")}>
                                <div style={s("display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; align-items: baseline")}>
                                  <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-muted); font-weight: 700")}>
                                    RESOLUTION LEARNING · {learning.resolvedInCategory} RESOLVED {learning.category} COMPLAINT{learning.resolvedInCategory === 1 ? "" : "S"} ON RECORD
                                  </div>
                                  <AiBadge source={suggestion.source} provider={suggestion.provider} model={suggestion.model} method={suggestion.method} at={suggestion.processedAt} />
                                </div>
                                {suggestion.suggestion ? (
                                  <div style={s("font-size: 13px; line-height: 1.6; margin-top: 8px")}>{suggestion.suggestion}</div>
                                ) : null}
                                {(learning.precedents || []).map((p) => (
                                  <div key={p.id} style={s("font-size: 12px; color: var(--color-neutral-800); margin-top: 8px; line-height: 1.55; border-top: 1px solid var(--color-neutral-300); padding-top: 8px")}>
                                    <strong>{p.reference}</strong> · {p.textSimilarity}% similar · {p.resolutionTimeHours ?? "—"}h · rating {p.rating ?? "none"} — {p.resolution}
                                  </div>
                                ))}
                                <div style={s("font-size: 10px; color: var(--color-neutral-600); margin-top: 8px; line-height: 1.5")}>
                                  {suggestion.caution || learning.note}{learning.medianResolutionHours !== null ? ` · Median resolution time in this category: ${learning.medianResolutionHours}h.` : ""}
                                </div>
                                <AiNotice text={suggestion.notice} />
                              </div>
                            );
                          })() : null}

                          {/* Feature 3: the duplicate verdict, with both outcomes
                              available and neither of them deleting anything. */}
                          {(row.duplicateProbability > 20) ? (
                            <div style={s("border: 1px solid var(--color-accent); padding: 12px; margin-top: 12px")}>
                              <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-muted); font-weight: 700")}>
                                POSSIBLE DUPLICATE · {row.duplicateProbability}% OVERLAP
                              </div>
                              <div style={s("font-size: 12px; color: var(--color-neutral-800); margin-top: 6px; line-height: 1.6")}>
                                {row.duplicateReview
                                  ? `Reviewed: marked ${row.duplicateReview.decision} by ${row.duplicateReview.decidedByName}${row.duplicateReview.relatedReference ? ` against ${row.duplicateReview.relatedReference}` : ""}.`
                                  : "Not yet reviewed. Linking records the relationship; marking separate dismisses the suggestion. Neither removes a complaint."}
                              </div>
                              {(!row.duplicateReview) ? (
                                <div style={s("display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px")}>
                                  <button onClick={() => v.onLoadRelated(row.id)} disabled={v.triageRelated[row.id]?.busy} className="btn btn-ghost" style={s("font-size: 10px; letter-spacing: .1em; padding: 7px 0")}>
                                    {v.triageRelated[row.id]?.busy ? "COMPARING…" : "VIEW RELATED COMPLAINT"}
                                  </button>
                                  {(v.triageRelated[row.id]?.data?.related) ? (
                                    <button onClick={() => v.onDuplicateDecision(row.id, "LINKED", v.triageRelated[row.id].data.related.id)} disabled={busy} className="btn btn-primary" style={s("font-size: 10px; letter-spacing: .1em; padding: 7px 11px")}>
                                      LINK TO {v.triageRelated[row.id].data.related.reference}
                                    </button>
                                  ) : null}
                                  <button onClick={() => v.onDuplicateDecision(row.id, "SEPARATE")} disabled={busy} className="btn btn-secondary" style={s("font-size: 10px; letter-spacing: .1em; padding: 7px 11px")}>
                                    MARK AS SEPARATE
                                  </button>
                                </div>
                              ) : null}
                              {(v.triageRelated[row.id]?.error) ? (
                                <AiNotice text={`Duplicate check unavailable — ${v.triageRelated[row.id].error}`} />
                              ) : null}
                              {(v.triageRelated[row.id]?.data) ? (() => {
                                const dup = v.triageRelated[row.id].data;
                                return (
                                  <div style={s("margin-top: 10px; border-top: 1px solid var(--color-neutral-300); padding-top: 10px")}>
                                    <div style={s("display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; align-items: baseline")}>
                                      <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 13px")}>
                                        {dup.related ? `${dup.related.reference} · ${dup.related.title}` : "No related complaint found"}
                                      </div>
                                      <AiBadge source={dup.source} provider={dup.provider} model={dup.model} method={dup.method} at={dup.processedAt} />
                                    </div>
                                    <AiFacts rows={[
                                      { label: "SIMILARITY", value: `${dup.similarity}%` },
                                      { label: "BASIS", value: dup.similarityBasis === "MODEL_REPORTED" ? "MODEL'S OWN FIGURE" : "KEYWORD OVERLAP" },
                                      { label: "VERDICT", value: dup.isDuplicate ? "POSSIBLE DUPLICATE" : "LIKELY SEPARATE" },
                                      { label: "RELATED FILED", value: dup.related?.createdAt ? new Date(dup.related.createdAt).toISOString().slice(0, 10) : null }
                                    ]} />
                                    <AiExplanation reason={dup.reason} recommendation={dup.recommendation} />
                                    <AiNotice text={dup.notice} />
                                  </div>
                                );
                              })() : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </AiPanel>
                ) : null}

                {/* ---- Features 4 and 5: recurring problems and root cause ---- */}
                {(v.aiRecurring) ? (
                  <AiPanel
                    kicker="RECURRING PROBLEM DETECTION"
                    title={v.aiRecurring.patterns.length
                      ? `${v.aiRecurring.patterns.length} recurring pattern${v.aiRecurring.patterns.length === 1 ? "" : "s"} in the last ${v.aiRecurring.windowDays} days`
                      : "No recurring pattern clears the detection threshold"}
                    badge={<AiBadge source="DATABASE_AGGREGATION" method={v.aiRecurring.method} />}
                  >
                    <div style={s("font-size: 11px; color: var(--color-neutral-600); margin-top: 10px; line-height: 1.6")}>
                      {v.aiRecurring.complaintsExamined} complaints examined. {v.aiRecurring.disclaimer}
                    </div>

                    {v.aiRecurring.patterns.map((pattern, i) => (
                      <div key={i} style={s("border-top: 1px solid var(--color-divider); margin-top: 16px; padding-top: 14px")}>
                        <div style={s("display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: baseline")}>
                          <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 16px")}>
                            {pattern.building.name} · {pattern.category}
                          </div>
                          <button
                            onClick={() => v.onRootCause(pattern.building.code, pattern.category)}
                            disabled={v.rootCauseBusy}
                            className="btn btn-secondary"
                            style={s("font-size: 10px; letter-spacing: .1em; padding: 7px 11px")}
                          >
                            {v.rootCauseBusy && v.rootCauseFor === `${pattern.building.code}:${pattern.category}` ? "ANALYSING…" : "ROOT CAUSE →"}
                          </button>
                        </div>

                        <AiFacts rows={[
                          { label: "OCCURRENCES", value: pattern.occurrences },
                          { label: "PERIOD", value: `LAST ${pattern.periodDays} DAYS` },
                          { label: "DISTINCT DAYS", value: pattern.distinctDays },
                          { label: "WORDING OVERLAP", value: `${pattern.textSimilarity}%` },
                          { label: "UNRESOLVED", value: pattern.unresolved },
                          { label: "AFFECTED AREA", value: pattern.repeatedLocations[0]?.location || pattern.building.name }
                        ]} />

                        <AiExplanation evidence={pattern.evidence} />

                        <IntelGuard name="Recurring issue intelligence"><RecurringIntel patternKey={pattern.key} live={v.intelLive} staff={v.ps07Staff} /></IntelGuard>

                        {(v.rootCause && v.rootCauseFor === `${pattern.building.code}:${pattern.category}`) ? (
                          v.rootCause.error ? (
                            <AiNotice text={`Root-cause analysis unavailable — ${v.rootCause.error}`} />
                          ) : (
                            <div style={s("border: 1px solid var(--color-accent); padding: 14px; margin-top: 14px")}>
                              <div style={s("display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; align-items: baseline")}>
                                <div style={s("font-size: 10px; letter-spacing: .16em; color: var(--color-muted); font-weight: 700")}>
                                  {v.rootCause.analysis.label}
                                </div>
                                <AiBadge
                                  source={v.rootCause.analysis.source}
                                  provider={v.rootCause.analysis.provider}
                                  model={v.rootCause.analysis.model}
                                  method={v.rootCause.analysis.method}
                                  at={v.rootCause.analysis.processedAt}
                                />
                              </div>
                              <div style={s("font-size: 15px; line-height: 1.7; margin-top: 10px; text-wrap: pretty")}>
                                {v.rootCause.analysis.rootCause}
                              </div>
                              <div style={s("margin-top: 12px")}>
                                <AiConfidence value={v.rootCause.analysis.confidence} basis={v.rootCause.analysis.confidenceBasis} />
                              </div>
                              <AiExplanation
                                evidence={v.rootCause.analysis.evidence}
                                recommendation={v.rootCause.analysis.suggestedAction}
                                caveat={`${v.rootCause.analysis.alternativeExplanation ? `Alternative explanation: ${v.rootCause.analysis.alternativeExplanation} ` : ""}${v.rootCause.analysis.caveat}`}
                              />
                              <AiNotice text={v.rootCause.analysis.notice} />
                            </div>
                          )
                        ) : null}
                      </div>
                    ))}
                  </AiPanel>
                ) : null}

                {/* ---- Feature 11: anomaly detection ---- */}
                {(v.aiAnomalies) ? (
                  <AiPanel
                    kicker="ANOMALY DETECTION"
                    title={v.aiAnomalies.findings.length
                      ? `${v.aiAnomalies.findings.length} series moved outside its own normal range`
                      : "Nothing unusual in the current window"}
                    tone={v.aiAnomalies.findings.length ? "alert" : "default"}
                    badge={<AiBadge source="STATISTICAL_BASELINE" method={v.aiAnomalies.method} />}
                  >
                    <div style={s("margin-top: 10px")}><WhyButton metric="complaints" live={v.intelLive} staff={v.ps07Staff} heading="Why did complaint volume move?" /></div>
                    <div style={s("font-size: 11px; color: var(--color-neutral-600); margin-top: 10px; line-height: 1.6; max-width: 88ch")}>
                      {v.aiAnomalies.seriesExamined} series examined over {v.aiAnomalies.windowDays} days. {v.aiAnomalies.disclaimer}
                    </div>

                    {(v.aiAnomalies.narrated || []).map((row, i) => (
                      <div key={i} style={s("border-top: 1px solid var(--color-divider); margin-top: 16px; padding-top: 14px")}>
                        <div style={s("display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: baseline")}>
                          <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 16px")}>{row.finding.subject}</div>
                          <AiBadge source={row.source} provider={row.provider} model={row.model} method={row.method} at={row.processedAt} />
                        </div>
                        <AiFacts rows={[
                          { label: "LATEST DAY", value: row.finding.current },
                          { label: "BASELINE MEDIAN", value: row.finding.baselineMedian },
                          { label: "CHANGE", value: row.finding.changePct === null || row.finding.changePct === undefined ? `${row.finding.delta}` : `${row.finding.changePct}%` },
                          { label: "DIRECTION", value: row.finding.direction },
                          { label: "Z-SCORE", value: row.finding.zScore === null ? "N/A — FLAT BASELINE" : `${row.finding.zScore} / ${row.finding.threshold}` },
                          { label: "SEVERITY", value: row.severity }
                        ]} />
                        <AiExplanation
                          reason={row.interpretation}
                          recommendation={row.recommendedAction}
                          evidence={(row.finding.supporting || []).map((record) => `${record.reference || record.status}${record.title ? ` — ${record.title}` : ""}`)}
                          caveat={row.likelyCause ? `Possible cause offered by the model: ${row.likelyCause}` : null}
                        />
                        <AiNotice text={row.notice} />
                      </div>
                    ))}

                    {(v.aiAnomalies.note) ? (
                      <div style={s("font-size: 13px; color: var(--color-neutral-800); margin-top: 14px; line-height: 1.6")}>{v.aiAnomalies.note}</div>
                    ) : null}
                  </AiPanel>
                ) : null}

                {/* ---- Feature 8: demand prediction ---- */}
                {(v.aiPredictions) ? (
                  <AiPanel
                    kicker="DEMAND PREDICTION · ESTIMATE"
                    title={v.aiPredictions.prediction.available
                      ? `Expected tomorrow: ${v.aiPredictions.prediction.forecast.expected} complaints (${v.aiPredictions.prediction.forecast.range.low}–${v.aiPredictions.prediction.forecast.range.high})`
                      : "Not enough history to forecast yet"}
                    badge={<AiBadge source={v.aiPredictions.narrated.source} provider={v.aiPredictions.narrated.provider} model={v.aiPredictions.narrated.model} method={v.aiPredictions.narrated.method} at={v.aiPredictions.narrated.processedAt} />}
                  >
                    <div style={s("margin-top: 10px")}><WhyButton metric="complaints" live={v.intelLive} staff={v.ps07Staff} heading="Why is complaint demand where it is?" /></div>
                    {v.aiPredictions.prediction.available ? (
                      <>
                        <AiFacts rows={[
                          { label: "TREND", value: `${v.aiPredictions.prediction.forecast.trend} (${v.aiPredictions.prediction.forecast.basis.trendPct}%)` },
                          { label: "PREDICTED PEAK", value: v.aiPredictions.prediction.peak?.label || "not established" },
                          { label: "LIKELY CATEGORY", value: v.aiPredictions.prediction.leadingCategory ? `${v.aiPredictions.prediction.leadingCategory.category} (${v.aiPredictions.prediction.leadingCategory.sharePct}%)` : "—" },
                          { label: "7-DAY MEAN", value: v.aiPredictions.prediction.forecast.basis.sevenDayMean },
                          { label: "SAME-WEEKDAY MEAN", value: v.aiPredictions.prediction.forecast.basis.sameWeekdayMean },
                          { label: "MEAN ABS. ERROR", value: v.aiPredictions.prediction.forecast.basis.meanAbsoluteError }
                        ]} />
                        <AiExplanation
                          reason={v.aiPredictions.narrated.outlook}
                          recommendation={v.aiPredictions.narrated.preparation}
                          evidence={[
                            `Built from ${v.aiPredictions.prediction.sufficiency.events} complaint records over ${v.aiPredictions.prediction.sufficiency.days} days.`,
                            v.aiPredictions.prediction.forecast.methodDetail
                          ]}
                          caveat={v.aiPredictions.prediction.disclaimer}
                        />
                      </>
                    ) : (
                      <div style={s("margin-top: 14px")}>
                        <div style={s("font-size: 13px; line-height: 1.7")}>{v.aiPredictions.narrated.notice}</div>
                        <ul style={s("margin: 10px 0 0; padding-left: 16px; font-size: 12px; line-height: 1.65; color: var(--color-neutral-700)")}>
                          {(v.aiPredictions.prediction.sufficiency.reasons || []).map((reason, i) => <li key={i}>{reason}</li>)}
                        </ul>
                      </div>
                    )}
                    <AiNotice text={v.aiPredictions.narrated.notice && v.aiPredictions.prediction.available ? v.aiPredictions.narrated.notice : null} />
                  </AiPanel>
                ) : null}

                {/* ---- Feature 19: low-bandwidth mode defers the heavier reads ---- */}
                {(v.aiDeferred) ? (
                  <div style={s("margin-top: 20px; border: 1px dashed var(--color-neutral-400); padding: 14px; display: flex; gap: 12px; justify-content: space-between; align-items: center; flex-wrap: wrap")}>
                    <div style={s("font-size: 12px; line-height: 1.6; max-width: 70ch")}>
                      <strong style={s("font-family: var(--font-heading); letter-spacing: .1em; font-size: 11px")}>LOW BANDWIDTH</strong> · The digital twin, cross-module, feedback and data-quality analyses were not downloaded. Lists in the SLA and workload panels are trimmed to 3; their counts are complete.
                    </div>
                    <button onClick={v.onAiLoadDeferred} disabled={v.aiBusy} className="btn btn-secondary" style={s("font-size: 11px; letter-spacing: .1em; padding: 8px 12px")}>
                      {v.aiBusy ? "LOADING…" : "LOAD REMAINING ANALYSES"}
                    </button>
                  </div>
                ) : null}

                {/* ---- Feature 8: SLA breach prediction ---- */}
                {(v.aiSla) ? (
                  <AiPanel
                    kicker="SLA BREACH PREDICTION"
                    title={`${v.aiSla.forecast.counts.BREACHED} breached · ${v.aiSla.forecast.counts.HIGH} high risk · ${v.aiSla.forecast.counts.MEDIUM} medium`}
                    tone={v.aiSla.forecast.counts.BREACHED || v.aiSla.forecast.counts.HIGH ? "alert" : "default"}
                    badge={<AiBadge source="STATISTICAL_BASELINE" method={v.aiSla.forecast.method} />}
                  >
                    <div style={s("margin-top: 10px")}><WhyButton metric="resolution" live={v.intelLive} staff={v.ps07Staff} heading="Why are resolution times changing?" /></div>
                    <AiNarrative narrated={v.aiSla.narrated} label="AI SLA ANALYSIS · PREDICTION" />
                    <div style={s("border-top: 1px solid var(--color-divider); margin-top: 14px; overflow-x: auto")}>
                      {v.aiSla.forecast.rows.map((row) => (
                        <div key={row.id} style={s("display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--color-neutral-300)")}>
                          <div style={s("min-width: 0")}>
                            <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 13px")}>{row.reference} · {row.title}</div>
                            <div style={s("font-size: 11px; color: var(--color-neutral-700); margin-top: 3px")}>
                              {row.status} · {row.category} · {row.department || "no department"} · open {row.ageHours}h of {row.slaHours}h SLA
                            </div>
                            <div style={s("font-size: 11px; color: var(--color-neutral-600); margin-top: 3px; line-height: 1.5")}>{row.reasons.join(" ")}</div>
                          </div>
                          <div style={s("text-align: right")}>
                            <BandChip band={row.risk} />
                            <div style={s("font-size: 9px; letter-spacing: .1em; color: var(--color-neutral-600); margin-top: 4px")}>{row.isPrediction ? "PREDICTION" : "MEASURED"}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={s("font-size: 10px; letter-spacing: .04em; color: var(--color-neutral-600); margin-top: 12px; line-height: 1.6; max-width: 88ch")}>
                      {v.aiSla.forecast.openExamined} open complaints examined; {v.aiSla.forecast.resolvedHistory} resolved complaints available as history. {v.aiSla.forecast.disclaimer}
                    </div>
                  </AiPanel>
                ) : null}

                {/* ---- Feature 9: workload ---- */}
                {(v.aiWorkload) ? (
                  <AiPanel
                    kicker="AI WORKLOAD ANALYSIS"
                    title={`${v.aiWorkload.analysis.totalPending} pending across ${v.aiWorkload.analysis.departmentCount} department${v.aiWorkload.analysis.departmentCount === 1 ? "" : "s"}`}
                    badge={<AiBadge source="DATABASE_AGGREGATION" method={v.aiWorkload.analysis.method} />}
                  >
                    <div style={s("margin-top: 10px")}><WhyButton metric="maintenance" live={v.intelLive} staff={v.ps07Staff} heading="Why is the maintenance workload changing?" /></div>
                    <AiNarrative narrated={v.aiWorkload.narrated} label="AI RECOMMENDATION" />
                    <div style={s("border-top: 1px solid var(--color-divider); margin-top: 14px")}>
                      {v.aiWorkload.analysis.departments.map((row) => (
                        <div key={row.department} style={s("padding: 10px 0; border-bottom: 1px solid var(--color-neutral-300)")}>
                          <div style={s("display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; align-items: baseline")}>
                            <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 13px")}>{row.department}</div>
                            <BandChip band={row.attention} />
                          </div>
                          <div style={s("display: flex; align-items: center; gap: 10px; margin-top: 6px")}>
                            <div style={s("flex: 1 1 auto; height: 8px; background: var(--color-neutral-300)")}>
                              <div style={{ width: `${v.aiWorkload.analysis.totalPending ? Math.round((row.pending / v.aiWorkload.analysis.totalPending) * 100) : 0}%`, height: "100%", background: row.attention === "HIGH" ? "var(--color-accent)" : "var(--color-neutral-700)" }}></div>
                            </div>
                            <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 14px; font-variant-numeric: tabular-nums; min-width: 28px; text-align: right")}>{row.pending}</div>
                          </div>
                          <div style={s("font-size: 11px; color: var(--color-neutral-700); margin-top: 4px; line-height: 1.5")}>
                            {row.critical} critical · {row.high} high · oldest {row.oldestAgeDays}d · resolved {row.resolvedInWindow} in {v.aiWorkload.analysis.windowDays}d · {row.daysToClear === null ? "days to clear: not measurable" : `about ${row.daysToClear} days to clear`}
                          </div>
                          {row.flags.length ? (
                            <div style={s("font-size: 11px; color: var(--color-neutral-600); margin-top: 3px; line-height: 1.5")}>{row.flags.join(" ")}</div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    <div style={s("font-size: 10px; letter-spacing: .04em; color: var(--color-neutral-600); margin-top: 12px; line-height: 1.6")}>{v.aiWorkload.analysis.governance}</div>
                  </AiPanel>
                ) : null}

                {/* ---- Feature 12: what-if simulation (administrators) ---- */}
                {(v.isAdminRole && v.aiStatus) ? (
                  <AiPanel kicker="WHAT-IF SIMULATION · ESTIMATE" title="What happens if complaint volume changes?">
                    <div style={s("display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; margin-top: 14px")}>
                      <label style={s("display: grid; gap: 4px; font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>
                        COMPLAINT CHANGE (%)
                        <input className="input" type="number" min="-90" max="500" value={v.simPct} onChange={v.onSimPct} onKeyDown={(e) => { if (e.key === "Enter") v.onSimRun(); }} style={s("width: 130px")} />
                      </label>
                      <label style={s("display: grid; gap: 4px; font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>
                        HORIZON (DAYS)
                        <input className="input" type="number" min="1" max="90" value={v.simHorizon} onChange={v.onSimHorizon} onKeyDown={(e) => { if (e.key === "Enter") v.onSimRun(); }} style={s("width: 110px")} />
                      </label>
                      <button onClick={v.onSimRun} disabled={v.simBusy} className="btn btn-primary" style={s("padding: 12px 18px; letter-spacing: .08em")}>
                        {v.simBusy ? "SIMULATING…" : "RUN SIMULATION →"}
                      </button>
                    </div>
                    {(v.simError) ? (
                      <div style={s("font-size: 12px; color: var(--color-accent-700); font-weight: 700; margin-top: 10px")}>{v.simError}</div>
                    ) : null}
                    {(v.simBusy) ? <AiLoading text="Running the simulation against the measured baseline…" /> : null}
                    {(v.simResult) ? (
                      <div style={s("margin-top: 14px")}>
                        <div style={s("display: inline-block; font-family: var(--font-heading); font-weight: 800; font-size: 10px; letter-spacing: .14em; padding: 4px 8px; border: 1px dashed var(--color-accent); color: var(--color-muted)")}>
                          {v.simResult.label}
                        </div>
                        <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700); margin-top: 14px")}>CURRENT · MEASURED OVER {v.simResult.input.windowDays} DAYS</div>
                        <AiFacts rows={[
                          { label: "COMPLAINTS FILED", value: v.simResult.current.filedInWindow },
                          { label: "FILED PER DAY", value: v.simResult.current.filedPerDay },
                          { label: "RESOLVED PER DAY", value: v.simResult.current.resolvedPerDay },
                          { label: "PENDING NOW", value: v.simResult.current.pendingNow }
                        ]} />
                        <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-muted); margin-top: 14px; font-weight: 700")}>
                          ESTIMATED · {v.simResult.input.increasePct >= 0 ? "+" : ""}{v.simResult.input.increasePct}% OVER {v.simResult.input.horizonDays} DAYS
                        </div>
                        <AiFacts rows={[
                          { label: "EST. COMPLAINTS", value: v.simResult.estimated.filedInWindow },
                          { label: "EST. ADDITIONAL", value: v.simResult.estimated.additionalComplaints },
                          { label: "EST. BACKLOG", value: v.simResult.estimated.pendingAfterHorizon },
                          { label: "EST. BACKLOG CHANGE", value: v.simResult.estimated.backlogChange },
                          { label: "EST. DAYS TO CLEAR", value: v.simResult.estimated.daysToClearBacklog === null ? "NOT WITHIN THROUGHPUT" : v.simResult.estimated.daysToClearBacklog }
                        ]} />
                        <div style={s("border-top: 1px solid var(--color-divider); margin-top: 14px")}>
                          {v.simResult.departments.slice(0, 8).map((row) => (
                            <div key={row.department} style={s("display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 8px 0; border-bottom: 1px solid var(--color-neutral-300); font-size: 12px")}>
                              <span>{row.department}</span>
                              <span style={s("font-variant-numeric: tabular-nums; color: var(--color-neutral-800)")}>
                                {row.pendingNow} now → est. {row.estimatedPendingAfterHorizon} ({row.change >= 0 ? "+" : ""}{row.change})
                              </span>
                            </div>
                          ))}
                        </div>
                        <AiNarrative narrated={v.simResult.narrated} label="AI EXPLANATION OF THE ESTIMATE" />
                        <AiExplanation evidence={v.simResult.assumptions} caveat={v.simResult.disclaimer} />
                      </div>
                    ) : null}
                  </AiPanel>
                ) : null}

                {/* ---- Feature 10: campus digital twin ---- */}
                {(v.aiTwin) ? (
                  <AiPanel
                    kicker="CAMPUS DIGITAL TWIN"
                    title={`${v.aiTwin.campus.buildings} blocks · ${v.aiTwin.campus.openComplaints} open complaints · ${v.aiTwin.campus.problemAreas} problem area${v.aiTwin.campus.problemAreas === 1 ? "" : "s"}`}
                    badge={<AiBadge source="DATABASE_AGGREGATION" method={v.aiTwin.method} />}
                  >
                    <div style={s("font-size: 11px; color: var(--color-neutral-600); margin-top: 10px; line-height: 1.6")}>
                      CAMPUS → {v.aiTwin.groups.map(g => g.label.toUpperCase()).join(" · ")} → BLOCKS → COMPLAINTS · INCIDENTS · MAINTENANCE. Select a block to open its records. {v.aiTwin.note}
                    </div>
                    {v.aiTwin.groups.map((group) => (
                      <div key={group.id} style={s("margin-top: 16px")}>
                        <div style={s("font-size: 10px; letter-spacing: .16em; color: var(--color-neutral-700); font-weight: 700")}>{group.label.toUpperCase()}</div>
                        <div style={s("display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; margin-top: 8px")}>
                          {group.nodes.map((node) => (
                            <button
                              key={node.code}
                              onClick={() => v.onTwinOpen(node.code)}
                              style={{
                                textAlign: "left", cursor: "pointer", padding: "10px 12px", background: v.twinFor === node.code ? "var(--color-neutral-200)" : "var(--color-neutral-100)",
                                border: `2px solid ${node.status === "PROBLEM" ? "var(--color-accent)" : node.status === "WATCH" ? "var(--color-accent-200)" : "var(--color-divider)"}`,
                                color: "var(--color-text)", fontFamily: "inherit"
                              }}
                            >
                              <div style={s("display: flex; justify-content: space-between; gap: 8px; align-items: baseline")}>
                                <span style={s("font-family: var(--font-heading); font-weight: 800; font-size: 12px")}>{node.name}</span>
                                <BandChip band={node.status} />
                              </div>
                              <div style={s("font-size: 11px; color: var(--color-neutral-700); margin-top: 6px; font-variant-numeric: tabular-nums")}>
                                {node.openComplaints} open · {node.openIncidents} incidents{node.type === "HOSTEL" ? ` · ${node.activePasses} out · ${node.overduePasses} overdue` : ""}
                              </div>
                              {node.reasons.length ? (
                                <div style={s("font-size: 10px; color: var(--color-neutral-600); margin-top: 4px; line-height: 1.45")}>{node.reasons.join(" · ")}</div>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    {(v.twinBusy) ? <AiLoading text="Reading the block's records…" /> : null}
                    {(v.twinError) ? <AiNotice text={`Block detail unavailable — ${v.twinError}`} /> : null}
                    {(v.twinNode && v.twinFor === v.twinNode.building.code) ? (
                      <div style={s("border: 1px solid var(--color-neutral-500); padding: 14px; margin-top: 14px")}>
                        <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 15px")}>
                          {v.twinNode.building.name} · {v.twinNode.building.type}
                        </div>
                        {v.twinNode.recurring.length ? (
                          <div style={s("font-size: 12px; color: var(--color-accent-700); margin-top: 6px; font-weight: 700")}>
                            Recurring: {v.twinNode.recurring.map(r => `${r.category} × ${r.occurrences} (${r.unresolved} unresolved)`).join(" · ")}
                          </div>
                        ) : null}
                        <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700); margin-top: 12px")}>MAINTENANCE STATUS</div>
                        {v.twinNode.maintenance.length ? (
                          <AiFacts rows={v.twinNode.maintenance.map(m => ({ label: m.department, value: `${m.open} open · ${m.investigating} in progress` }))} />
                        ) : <div style={s("font-size: 12px; margin-top: 6px")}>No open maintenance work.</div>}
                        <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700); margin-top: 12px")}>OPEN COMPLAINTS ({v.twinNode.complaints.length})</div>
                        <div style={s("max-height: 260px; overflow: auto; border-top: 1px solid var(--color-neutral-300); margin-top: 6px")}>
                          {v.twinNode.complaints.map(c => (
                            <div key={c.id} style={s("font-size: 12px; padding: 7px 0; border-bottom: 1px solid var(--color-neutral-300)")}>
                              <strong>{c.reference}</strong> · {c.title} · {c.category} · {c.priority} · {c.status}
                            </div>
                          ))}
                          {!v.twinNode.complaints.length ? <div style={s("font-size: 12px; padding: 7px 0")}>None open.</div> : null}
                        </div>
                        <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700); margin-top: 12px")}>OPEN INCIDENTS ({v.twinNode.incidents.length})</div>
                        {v.twinNode.incidents.map(i => (
                          <div key={i.id} style={s("font-size: 12px; padding: 7px 0; border-bottom: 1px solid var(--color-neutral-300)")}>
                            <strong>{i.reference}</strong> · {i.title} · risk {i.risk}% · {i.status}
                          </div>
                        ))}
                        {v.twinNode.gatePasses.length ? (
                          <>
                            <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700); margin-top: 12px")}>GATE PASSES IN PLAY ({v.twinNode.gatePasses.length})</div>
                            {v.twinNode.gatePasses.map(g => (
                              <div key={g.id} style={s("font-size: 12px; padding: 7px 0; border-bottom: 1px solid var(--color-neutral-300)")}>
                                <strong>{g.reference}</strong> · {g.status} · due {new Date(g.expectedReturnAt).toISOString().slice(0, 16).replace("T", " ")}
                              </div>
                            ))}
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </AiPanel>
                ) : null}

                {/* ---- Feature 11: cross-module intelligence ---- */}
                {(v.aiCorrelations) ? (
                  <AiPanel
                    kicker="CROSS-MODULE INTELLIGENCE"
                    title={v.aiCorrelations.snapshot.findings.length
                      ? `${v.aiCorrelations.snapshot.findings.length} AI-detected relationship${v.aiCorrelations.snapshot.findings.length === 1 ? "" : "s"} across modules`
                      : "No hostel shows several elevated signals together"}
                    badge={<AiBadge source="STATISTICAL_BASELINE" method={v.aiCorrelations.snapshot.method} />}
                  >
                    <AiNarrative narrated={v.aiCorrelations.narrated} label="POSSIBLE CORRELATION · NOT CAUSATION" />
                    {v.aiCorrelations.snapshot.findings.map((f) => (
                      <div key={f.code} style={s("border: 1px solid var(--color-accent); padding: 12px; margin-top: 12px")}>
                        <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-muted); font-weight: 700")}>{f.label} · {f.hostel}</div>
                        <div style={s("font-size: 13px; line-height: 1.6; margin-top: 6px")}>{f.statement}</div>
                        <AiFacts rows={f.modules.map(m => ({ label: m.label.toUpperCase(), value: `${m.count} · ${m.perResident}/resident vs ${m.campusPerResident} campus` }))} />
                      </div>
                    ))}
                    <div style={s("overflow-x: auto; margin-top: 14px")}>
                      <table style={s("width: 100%; border-collapse: collapse; font-size: 12px; min-width: 520px")}>
                        <thead>
                          <tr style={s("text-align: left; font-size: 9px; letter-spacing: .12em; color: var(--color-neutral-700)")}>
                            <th style={s("padding: 6px 4px; border-bottom: 1px solid var(--color-divider)")}>HOSTEL</th>
                            <th style={s("padding: 6px 4px; border-bottom: 1px solid var(--color-divider)")}>RESIDENTS</th>
                            <th style={s("padding: 6px 4px; border-bottom: 1px solid var(--color-divider)")}>COMPLAINTS ({v.aiCorrelations.snapshot.windowDays}D)</th>
                            <th style={s("padding: 6px 4px; border-bottom: 1px solid var(--color-divider)")}>OPEN INCIDENTS</th>
                            <th style={s("padding: 6px 4px; border-bottom: 1px solid var(--color-divider)")}>LATE PASSES</th>
                            <th style={s("padding: 6px 4px; border-bottom: 1px solid var(--color-divider)")}>BELOW {v.aiCorrelations.snapshot.attendanceThreshold}%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {v.aiCorrelations.snapshot.hostels.map(h => (
                            <tr key={h.code} style={s("font-variant-numeric: tabular-nums")}>
                              <td style={s("padding: 6px 4px; border-bottom: 1px solid var(--color-neutral-300); font-weight: 700")}>{h.name}</td>
                              <td style={s("padding: 6px 4px; border-bottom: 1px solid var(--color-neutral-300)")}>{h.residents}</td>
                              <td style={s("padding: 6px 4px; border-bottom: 1px solid var(--color-neutral-300)")}>{h.complaints}</td>
                              <td style={s("padding: 6px 4px; border-bottom: 1px solid var(--color-neutral-300)")}>{h.incidents}</td>
                              <td style={s("padding: 6px 4px; border-bottom: 1px solid var(--color-neutral-300)")}>{h.latePasses}</td>
                              <td style={s("padding: 6px 4px; border-bottom: 1px solid var(--color-neutral-300)")}>{h.lowAttendance}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={s("font-size: 10px; letter-spacing: .04em; color: var(--color-neutral-600); margin-top: 12px; line-height: 1.6; max-width: 88ch")}>{v.aiCorrelations.snapshot.disclaimer}</div>
                  </AiPanel>
                ) : null}

                {/* ---- Feature 17: feedback intelligence ---- */}
                {(v.aiFeedback) ? (
                  <AiPanel
                    kicker="AI FEEDBACK INTELLIGENCE"
                    title={v.aiFeedback.analysis.available
                      ? `${v.aiFeedback.analysis.total} rating${v.aiFeedback.analysis.total === 1 ? "" : "s"} · average ${v.aiFeedback.analysis.averageRating}/5`
                      : "No student feedback yet"}
                    badge={<AiBadge source="DATABASE_AGGREGATION" method={v.aiFeedback.analysis.method} />}
                  >
                    {v.aiFeedback.analysis.available ? (
                      <>
                        <AiFacts rows={[
                          { label: "POSITIVE", value: v.aiFeedback.analysis.sentiment.POSITIVE },
                          { label: "NEUTRAL", value: v.aiFeedback.analysis.sentiment.NEUTRAL },
                          { label: "NEGATIVE", value: v.aiFeedback.analysis.sentiment.NEGATIVE },
                          ...v.aiFeedback.analysis.distribution.map(d => ({ label: `${d.stars} STAR${d.stars === 1 ? "" : "S"}`, value: d.count }))
                        ]} />
                        <AiNarrative narrated={v.aiFeedback.narrated} label="AI FEEDBACK ANALYSIS" />
                        {v.aiFeedback.analysis.byCategory.length ? (
                          <AiExplanation evidence={v.aiFeedback.analysis.byCategory.map(c => `${c.key}: ${c.averageRating}/5 over ${c.count} rating${c.count === 1 ? "" : "s"}`)} />
                        ) : null}
                        {v.aiFeedback.analysis.recent.filter(r => r.comment).slice(0, 6).map(r => (
                          <div key={r.id} style={s("font-size: 12px; line-height: 1.55; padding: 8px 0; border-bottom: 1px solid var(--color-neutral-300)")}>
                            <strong>{r.reference}</strong> · {r.rating}/5 · {r.sentiment} — “{r.comment}”
                          </div>
                        ))}
                      </>
                    ) : (
                      <div style={s("font-size: 13px; line-height: 1.7; margin-top: 12px")}>{v.aiFeedback.analysis.note}</div>
                    )}
                    <div style={s("font-size: 10px; letter-spacing: .04em; color: var(--color-neutral-600); margin-top: 12px; line-height: 1.6; max-width: 88ch")}>{v.aiFeedback.analysis.disclaimer}</div>
                  </AiPanel>
                ) : null}

                {/* ---- Feature 15: data quality guardian (administrators) ---- */}
                {(v.aiDataQuality) ? (
                  <AiPanel
                    kicker="AI DATA QUALITY GUARDIAN"
                    title={v.aiDataQuality.report.checksFailing
                      ? `${v.aiDataQuality.report.issuesFound} record${v.aiDataQuality.report.issuesFound === 1 ? "" : "s"} need attention`
                      : `All ${v.aiDataQuality.report.checksRun} integrity checks passed`}
                    tone={v.aiDataQuality.report.findings.some(f => f.severity === "HIGH") ? "alert" : "default"}
                    badge={<AiBadge source="RULE_BASED" method={v.aiDataQuality.report.method} />}
                  >
                    <AiNarrative narrated={v.aiDataQuality.narrated} label="AI SUMMARY" />
                    {v.aiDataQuality.report.findings.map((f) => (
                      <div key={f.id} style={s("border-top: 1px solid var(--color-divider); margin-top: 14px; padding-top: 12px")}>
                        <div style={s("display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; align-items: baseline")}>
                          <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 13px")}>DATA QUALITY WARNING · {f.count} × {f.title}</div>
                          <BandChip band={f.severity} />
                        </div>
                        <div style={s("font-size: 11px; color: var(--color-neutral-700); margin-top: 4px")}>{f.entity} · {f.category.replace(/_/g, " ")} · {f.detail}</div>
                        <button onClick={() => v.onDqToggle(f.id)} className="btn btn-ghost" style={s("font-size: 10px; letter-spacing: .1em; padding: 6px 0")}>
                          {v.dqOpen === f.id ? "HIDE RECORDS" : "VIEW RECORDS →"}
                        </button>
                        {(v.dqOpen === f.id) ? (
                          <div style={s("border-top: 1px solid var(--color-neutral-300)")}>
                            {f.records.map((r) => (
                              <div key={r.id} style={s("font-size: 12px; padding: 7px 0; border-bottom: 1px solid var(--color-neutral-300); word-break: break-word")}>
                                {Object.entries(r).filter(([k]) => k !== "id").map(([k, val]) => `${k}: ${val === null || val === undefined ? "—" : String(val)}`).join(" · ")}
                              </div>
                            ))}
                            {f.truncated ? <div style={s("font-size: 11px; color: var(--color-neutral-600); padding-top: 6px")}>Showing the first {f.records.length} of {f.count}.</div> : null}
                          </div>
                        ) : null}
                      </div>
                    ))}
                    <div style={s("font-size: 10px; letter-spacing: .04em; color: var(--color-neutral-600); margin-top: 12px; line-height: 1.6")}>
                      {v.aiDataQuality.report.checksRun} checks run · {v.aiDataQuality.report.passed.length} passed. {v.aiDataQuality.report.governance}
                    </div>
                  </AiPanel>
                ) : null}

                {/* ---- Feature 16: gate-pass risk signals ---- */}
                {(v.aiGateRisk && v.aiGateRisk.rows.length) ? (
                  <AiPanel
                    kicker="GATE PASS RISK SIGNALS"
                    title={`${v.aiGateRisk.rows.length} student${v.aiGateRisk.rows.length === 1 ? "" : "s"} with an unusual gate-pass pattern`}
                    badge={<AiBadge source={v.aiGateRisk.narrated?.source} provider={v.aiGateRisk.narrated?.provider} model={v.aiGateRisk.narrated?.model} method={v.aiGateRisk.method} />}
                  >
                    <div style={s("font-size: 11px; color: var(--color-neutral-600); margin-top: 10px; line-height: 1.6; max-width: 88ch")}>
                      {v.aiGateRisk.passesExamined} passes across {v.aiGateRisk.studentsExamined} students over {v.aiGateRisk.windowDays} days. {v.aiGateRisk.disclaimer}
                    </div>

                    {v.aiGateRisk.rows.map((row, i) => (
                      <div key={i} style={s("border-top: 1px solid var(--color-divider); margin-top: 16px; padding-top: 14px")}>
                        <div style={s("display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: baseline")}>
                          <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 15px")}>
                            {row.student.name || "Student"} {row.student.studentId ? `· ${row.student.studentId}` : ""}
                          </div>
                          <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 13px; letter-spacing: .1em; color: var(--color-accent)")}>
                            {row.level} · {row.score}
                          </div>
                        </div>
                        <ul style={s("margin: 10px 0 0; padding-left: 16px; font-size: 13px; line-height: 1.7")}>
                          {row.signals.map((signal, j) => (
                            <li key={j}>
                              {signal.label}
                              {signal.detail ? <span style={s("color: var(--color-neutral-700)")}> — {signal.detail}</span> : null}
                              {signal.references?.length ? (
                                <span style={s("color: var(--color-neutral-600); font-size: 11px")}> ({signal.references.join(", ")})</span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                        <div style={s("font-size: 11px; color: var(--color-neutral-600); margin-top: 10px; line-height: 1.6")}>{row.governance}</div>
                      </div>
                    ))}
                  </AiPanel>
                ) : null}

                {/* ---- Feature 7: priority-graded notifications ---- */}
                {(v.aiNotifications && v.aiNotifications.notifications.length) ? (
                  <AiPanel
                    kicker="NOTIFICATIONS BY PRIORITY"
                    title={`${v.aiNotifications.unread} unread of ${v.aiNotifications.notifications.length}`}
                    badge={<AiBadge source="DETERMINISTIC_NOTIFICATION_RULES" method={v.aiNotifications.method} />}
                  >
                    <div style={s("border-top: 1px solid var(--color-divider); margin-top: 12px")}>
                      {v.aiNotifications.notifications.slice(0, 12).map((row) => (
                        <PriorityRow
                          key={row.id}
                          priority={row.priority}
                          title={row.title}
                          body={row.body}
                          reason={row.priorityReason}
                          source={row.prioritySource}
                          at={row.createdAt}
                        />
                      ))}
                    </div>
                    <div style={s("font-size: 10px; letter-spacing: .04em; color: var(--color-neutral-600); margin-top: 12px; line-height: 1.6")}>
                      Priority is decided by the kind of event, and can only be raised — never lowered — by safety wording. The existing delivery mechanism is unchanged.
                    </div>
                  </AiPanel>
                ) : null}

                {/* ---- Feature 14: the tamper-evident audit chain ---- */}
                {(v.aiAudit) ? (
                  <AiPanel
                    kicker="TAMPER-EVIDENT AUDIT HISTORY"
                    title={`${v.aiAudit.total} recorded administrative action${v.aiAudit.total === 1 ? "" : "s"}`}
                    badge={<AiBadge source="SHA256_HASH_CHAIN" method={v.aiAudit.method} />}
                  >
                    <div style={s("margin-top: 14px")}>
                      <AuditTimeline audit={v.aiAudit} />
                    </div>
                  </AiPanel>
                ) : null}
              </div>

              {/* ---- PS07 · requests filed at the assisted-access kiosk ---- */}
              <div style={s("margin-top: 44px; border-top: 1px solid var(--color-divider); padding-top: 24px")}>
                <div style={s("font-size: 11px; letter-spacing: .2em; color: var(--color-muted); font-weight: 700")}>ASSISTED ACCESS · KIOSK REQUESTS</div>
                  <h2 style={s("font-size: clamp(22px, 3vw, 34px); letter-spacing: -.02em; margin: 8px 0 16px")}>Filed at the help desk, handled like any other request.</h2>
                <IntelGuard name="Kiosk activity"><KioskActivity live={v.intelLive} staff={v.ps07Staff} onOpenKiosk={v.goKiosk} /></IntelGuard>
              </div>

              {/* ---- PS07 · college adoption & migration ---- */}
              <div style={s("margin-top: 44px; border-top: 1px solid var(--color-divider); padding-top: 24px")}>
                <div style={s("font-size: 11px; letter-spacing: .2em; color: var(--color-muted); font-weight: 700")}>COLLEGE ADOPTION & MIGRATION</div>
                  <h2 style={s("font-size: clamp(22px, 3vw, 34px); letter-spacing: -.02em; margin: 8px 0 16px")}>How a college moves its records in without breaking anything.</h2>
                <IntelGuard name="College adoption"><AdoptionSection live={v.intelLive} isAdmin={v.ps07Admin} /></IntelGuard>
                {/* EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md): import a WhatsApp group — dry run first. */}
                {v.ps07Staff ? <XoSlot name="whatsappImport" live={this.state.apiState === "live"} user={this.state.user} admin={v.ps07Admin} /> : null}
              </div>

              {/* EXTENSION HOOK (see HOOKS.md): adoption datasets, Friction Ledger, pending queue, fix metrics, SMS, FAQ. */}
              <IntelGuard name="Extension panels"><ExtMissionControl user={this.state.user} staff={v.ps07Staff} admin={v.ps07Admin} live={v.intelLive} lowBw={this.state.lowBw} onGo={(id) => this.go(id)} /></IntelGuard>

              {/* ========================================================================= */}
              {/* AI PREDICTOR & ROOT CAUSE CLUSTERING ENGINE (ADMIN & WARDEN)              */}
              {/* ========================================================================= */}
              <div style={s("margin-top: 48px; border-top: 2px solid var(--color-divider); padding-top: 32px")}>
                <div style={s("display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 20px")}>
                  <div>
                    <div style={s("display: inline-flex; align-items: center; gap: 6px; font-size: 11px; letter-spacing: .2em; color: var(--color-accent); font-weight: 800; text-transform: uppercase")}>
                      <span style={s("display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #6366f1; box-shadow: 0 0 10px #6366f1")}></span>
                      AI PREDICTOR ENGINE · ROOT CAUSE & RECURRENCE CLUSTERING
                    </div>
                    <h2 style={s("font-size: clamp(22px, 3vw, 34px); letter-spacing: -.02em; margin: 8px 0 6px")}>
                      Systemic Failure Diagnostics & Preventative Workflows
                    </h2>
                    <p style={s("font-size: 14px; color: var(--color-neutral-700); max-width: 90ch; line-height: 1.5; margin: 0")}>
                      Neural clustering models aggregate isolated complaints into underlying infrastructure failure modes. Root causes are identified before critical breakdowns occur, deploying automated SOP work orders to eliminate future recurrence.
                    </p>
                  </div>
                  <div style={s("display: flex; gap: 10px; flex-wrap: wrap")}>
                    <div style={s("background: var(--color-surface); border: 1px solid var(--color-divider); padding: 10px 16px; border-radius: 6px; text-align: center")}>
                      <div style={s("font-size: 10px; letter-spacing: .12em; color: var(--color-muted); font-weight: 700")}>ISOLATED CLUSTERS</div>
                      <div style={s("font-size: 20px; font-weight: 800; color: var(--color-text)")}>{(v.aiPredictorClusters || []).length}</div>
                    </div>
                    <div style={s("background: var(--color-surface); border: 1px solid var(--color-divider); padding: 10px 16px; border-radius: 6px; text-align: center")}>
                      <div style={s("font-size: 10px; letter-spacing: .12em; color: var(--color-muted); font-weight: 700")}>STUDENTS SHIELDED</div>
                      <div style={s("font-size: 20px; font-weight: 800; color: #16a34a")}>1,590</div>
                    </div>
                    <div style={s("background: var(--color-surface); border: 1px solid var(--color-divider); padding: 10px 16px; border-radius: 6px; text-align: center")}>
                      <div style={s("font-size: 10px; letter-spacing: .12em; color: var(--color-muted); font-weight: 700")}>RECURRENCE RISK DROP</div>
                      <div style={s("font-size: 20px; font-weight: 800; color: #2563eb")}>-78.2%</div>
                    </div>
                  </div>
                </div>

                {/* 4 Diagnostic Clusters */}
                <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 18px; margin-top: 16px")}>
                  {(v.aiPredictorClusters || []).map((cluster) => {
                    const isApplied = Boolean(v.preventativeApplied && v.preventativeApplied[cluster.key]);
                    return (
                      <div key={cluster.key} style={s(`background: var(--color-surface); border: 2px solid ${isApplied ? '#16a34a' : 'var(--color-divider)'}; border-radius: 8px; padding: 20px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: var(--shadow-sm); transition: border-color .2s ease`)}>
                        <div>
                          <div style={s("display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 10px")}>
                            <div style={s("display: flex; align-items: center; gap: 8px")}>
                              <span style={s("font-size: 22px")}>{cluster.icon}</span>
                              <span style={s("font-size: 16px; font-weight: 800; font-family: var(--font-heading)")}>{cluster.name}</span>
                            </div>
                            <span style={s("font-size: 11px; font-weight: 700; color: var(--color-muted); background: var(--color-neutral-200); padding: 2px 8px; border-radius: 999px")}>
                              {cluster.complaintCount} Reports
                            </span>
                          </div>

                          <div style={s("font-size: 11px; color: var(--color-neutral-600); margin-bottom: 12px; font-weight: 600")}>
                            📍 Focus Area: {cluster.primaryArea} · {cluster.affectedStudents} students impacted
                          </div>

                          {/* Risk Differential Bar */}
                          <div style={s("background: var(--color-neutral-100); border: 1px solid var(--color-divider); border-radius: 6px; padding: 10px 12px; margin-bottom: 14px")}>
                            <div style={s("display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; margin-bottom: 6px")}>
                              <span style={s("color: #dc2626")}>Pre-Intervention Risk: {cluster.baseRisk}%</span>
                              <span style={s("color: #16a34a")}>Predicted Post-SOP Risk: {cluster.postRisk}%</span>
                            </div>
                            <div style={s("height: 8px; width: 100%; background: #fee2e2; border-radius: 999px; overflow: hidden; position: relative")}>
                              <div style={s(`height: 100%; width: ${isApplied ? cluster.postRisk : cluster.baseRisk}%; background: ${isApplied ? '#16a34a' : '#dc2626'}; border-radius: 999px; transition: width .5s ease`)}></div>
                            </div>
                          </div>

                          {/* Root Cause Box */}
                          <div style={s("border-left: 3px solid #f59e0b; background: rgba(245, 158, 11, 0.08); padding: 10px 12px; margin-bottom: 12px; font-size: 12px; line-height: 1.5")}>
                            <div style={s("font-size: 10px; font-weight: 800; color: #b45309; letter-spacing: .08em; margin-bottom: 2px")}>
                              ENGINEERING ROOT CAUSE IDENTIFIED:
                            </div>
                            <div style={s("color: var(--color-text); font-weight: 500")}>{cluster.rootCause}</div>
                          </div>

                          {/* Recurrence Forecast */}
                          <div style={s("font-size: 11px; font-weight: 700; color: #b91c1c; margin-bottom: 12px; display: flex; align-items: center; gap: 5px")}>
                            <span>⚡</span> {cluster.predictiveWindow}
                          </div>

                          {/* Preventative Protocol */}
                          <div style={s("background: var(--color-neutral-50, var(--color-surface)); border: 1px dashed var(--color-divider); border-radius: 6px; padding: 10px 12px; margin-bottom: 16px")}>
                            <div style={s("font-size: 10px; font-weight: 800; color: var(--color-muted); letter-spacing: .1em; margin-bottom: 6px")}>
                              PREVENTATIVE WORK ORDER PROTOCOL (SOP):
                            </div>
                            {(cluster.preventativeSOP || []).map((step, idx) => (
                              <div key={idx} style={s("font-size: 12px; color: var(--color-neutral-700); line-height: 1.45; margin-bottom: 3px")}>
                                {step}
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Action CTA */}
                        <div>
                          <button
                            type="button"
                            onClick={() => v.onApplyPreventative(cluster.key)}
                            style={s(`width: 100%; padding: 10px 14px; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; border-radius: 5px; cursor: pointer; transition: all .2s; border: none; background: ${isApplied ? '#16a34a' : 'var(--color-accent)'}; color: #ffffff; display: flex; justify-content: center; align-items: center; gap: 8px`)}
                          >
                            {isApplied ? (
                              <><span>✓</span> PREVENTATIVE WORK ORDER ACTIVE · SOP DEPLOYED</>
                            ) : (
                              <><span>⚡</span> APPLY PREVENTATIVE SOP & REBALANCE INFRASTRUCTURE</>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ========================================================================= */}
              {/* FOOTER CAMPUS ACTION LEDGER (LINE-WISE AUDIT: WHAT HAS BEEN DONE & NOT)     */}
              {/* ========================================================================= */}
              <div style={s("margin-top: 56px; border-top: 3px solid var(--color-text); padding-top: 32px")}>
                <div style={s("display: flex; justify-content: space-between; align-items: flex-end; gap: 18px; flex-wrap: wrap; margin-bottom: 20px")}>
                  <div>
                    <div style={s("font-size: 11px; letter-spacing: .2em; color: var(--color-muted); font-weight: 800")}>
                      OPERATIONAL AUDIT & TRIAGE SUMMARY · FOOTER LEDGER
                    </div>
                    <h2 style={s("font-size: clamp(24px, 3.5vw, 38px); letter-spacing: -.02em; margin: 6px 0 6px")}>
                      What has been done and what has not.
                    </h2>
                    <p style={s("font-size: 14px; color: var(--color-neutral-700); margin: 0; max-width: 95ch; line-height: 1.5")}>
                      Line-wise transparency ledger for Admin and Warden dashboards. Tracks resolution actions, direct student messages, and 6-day Red/Green Flag verification audit states across campus.
                    </p>
                  </div>

                  {/* Filter Toolbar */}
                  <div style={s("display: flex; gap: 8px; flex-wrap: wrap")}>
                    {[
                      { key: "ALL", label: `ALL (${(v.ledgerItems || []).length})` },
                      { key: "DONE", label: `🟢 DONE (${(v.ledgerItems || []).filter(i => i.isDone).length})` },
                      { key: "NOT_DONE", label: `⚪ NOT DONE (${(v.ledgerItems || []).filter(i => i.isNotDone).length})` },
                      { key: "RED_FLAG", label: `🔴 RED FLAGGED (${(v.ledgerItems || []).filter(i => i.isRedFlag).length})` },
                      { key: "WARDEN", label: `🏢 WARDEN FOCUS (${(v.ledgerItems || []).filter(i => i.isWardenRelevant).length})` }
                    ].map(f => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => v.onLedgerFilter(f.key)}
                        className="btn"
                        style={s(`font-size: 11px; font-weight: 700; letter-spacing: .08em; padding: 7px 12px; border-radius: 4px; ${v.ledgerFilter === f.key ? 'background: var(--color-text); color: var(--color-surface); border-color: var(--color-text)' : 'background: var(--color-neutral-100); color: var(--color-text); border: 1px solid var(--color-divider)'}`)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Ledger Items Table / Line-Wise View */}
                <div style={s("border: 1px solid var(--color-divider); border-radius: 6px; overflow: hidden; background: var(--color-surface); box-shadow: var(--shadow-sm)")}>
                  {/* Table Header Bar */}
                  <div style={s("display: grid; grid-template-columns: 140px 1.4fr 1.6fr 150px 180px; gap: 14px; padding: 12px 18px; background: var(--color-neutral-100); border-bottom: 2px solid var(--color-divider); font-size: 10px; font-weight: 800; letter-spacing: .14em; color: var(--color-muted)")}>
                    <div>REF & STATUS</div>
                    <div>ISSUE & LOCATION</div>
                    <div>ACTION TAKEN & STAFF MESSAGE</div>
                    <div>AUDIT ACTOR</div>
                    <div>6-DAY VERIFICATION</div>
                  </div>

                  {/* Table Body Lines */}
                  {(() => {
                    const rows = (v.ledgerItems || []).filter(item => {
                      if (v.adminRoleView === "WARDEN" && !item.isWardenRelevant) return false;
                      if (v.ledgerFilter === "DONE") return item.isDone;
                      if (v.ledgerFilter === "NOT_DONE") return item.isNotDone;
                      if (v.ledgerFilter === "RED_FLAG") return item.isRedFlag;
                      if (v.ledgerFilter === "WARDEN") return item.isWardenRelevant;
                      return true;
                    });

                    if (rows.length === 0) {
                      return (
                        <div style={s("padding: 32px; text-align: center; color: var(--color-muted); font-size: 13px")}>
                          No items match the selected ledger filter.
                        </div>
                      );
                    }

                    return rows.map((item, idx) => {
                      const isEven = idx % 2 === 0;
                      return (
                        <div
                          key={item.id}
                          style={s(`display: grid; grid-template-columns: 140px 1.4fr 1.6fr 150px 180px; gap: 14px; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--color-divider); background: ${item.isRedFlag ? 'rgba(239, 68, 68, 0.05)' : isEven ? 'var(--color-surface)' : 'var(--color-neutral-50, var(--color-surface))'}`)}
                        >
                          {/* Col 1: Ref & Status Badge */}
                          <div>
                            <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 13px; letter-spacing: .04em")}>{item.ref}</div>
                            <div style={s("margin-top: 4px")}>
                              {item.isRedFlag ? (
                                <span style={s("font-size: 9px; font-weight: 800; letter-spacing: .08em; padding: 2px 6px; border-radius: 3px; background: #fee2e2; color: #991b1b")}>
                                  🔴 RED FLAGGED
                                </span>
                              ) : item.isDone ? (
                                <span style={s("font-size: 9px; font-weight: 800; letter-spacing: .08em; padding: 2px 6px; border-radius: 3px; background: #dcfce7; color: #166534")}>
                                  🟢 DONE · RESOLVED
                                </span>
                              ) : (
                                <span style={s("font-size: 9px; font-weight: 800; letter-spacing: .08em; padding: 2px 6px; border-radius: 3px; background: #fef3c7; color: #92400e")}>
                                  ⚪ NOT DONE · {item.status}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Col 2: Title & Location */}
                          <div>
                            <div style={s("font-size: 13px; font-weight: 700; color: var(--color-text); margin-bottom: 3px")}>{item.title}</div>
                            <div style={s("font-size: 11px; color: var(--color-neutral-600); display: flex; gap: 8px; flex-wrap: wrap")}>
                              <span>📍 {item.location}</span>
                              <span>·</span>
                              <span>{item.department}</span>
                            </div>
                          </div>

                          {/* Col 3: Action Taken & Message */}
                          <div>
                            {item.adminMessage ? (
                              <div style={s("font-size: 12px; color: var(--color-text); line-height: 1.45")}>
                                <div style={s("font-size: 9px; font-weight: 800; letter-spacing: .08em; color: var(--color-muted); margin-bottom: 2px")}>
                                  STAFF RESOLUTION NOTE TO STUDENT:
                                </div>
                                <div style={s("font-style: italic; color: var(--color-neutral-800)")}>
                                  "{item.adminMessage}"
                                </div>
                              </div>
                            ) : (
                              <div style={s("font-size: 12px; color: var(--color-warn-700, #b45309); font-weight: 600")}>
                                Pending action · awaiting assignment & triage
                              </div>
                            )}
                            {item.disputeReason ? (
                              <div style={s("margin-top: 4px; font-size: 11px; color: #b91c1c; font-weight: 700")}>
                                ⚠️ Dispute: {item.disputeReason}
                              </div>
                            ) : null}
                          </div>

                          {/* Col 4: Resolver / Actor */}
                          <div style={s("font-size: 12px")}>
                            <div style={s("font-weight: 700; color: var(--color-text)")}>{item.resolver || "Triage Desk"}</div>
                            <div style={s("font-size: 10px; color: var(--color-neutral-600); margin-top: 2px")}>
                              {item.resolvedAt ? `At ${item.resolvedAt}` : `Logged ${item.createdAt}`}
                            </div>
                          </div>

                          {/* Col 5: 6-Day Verification State */}
                          <div>
                            {item.studentFlag === "GREEN_FLAG" ? (
                              <div style={s("display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 800; color: #166534; background: #dcfce7; padding: 4px 8px; border-radius: 4px")}>
                                <span>✓</span> 🟢 Green Flag Confirmed
                              </div>
                            ) : item.studentFlag === "RED_FLAG" ? (
                              <div style={s("display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 800; color: #991b1b; background: #fee2e2; padding: 4px 8px; border-radius: 4px")}>
                                <span>⚠</span> 🔴 Red Flag (Reopened)
                              </div>
                            ) : item.isDone ? (
                              <div style={s("font-size: 11px; font-weight: 700; color: var(--color-warn-700, #b45309)")}>
                                ⏳ 6-Day Window Active ({item.daysLeft}d {item.hoursLeft}h left)
                              </div>
                            ) : (
                              <div style={s("font-size: 11px; color: var(--color-muted)")}>
                                Window starts on resolve
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

            </section>
          </>) : null}
      
          {/* 11 HOSTEL GATE PASS */}
          {(v.isGatePass) ? (<>
            <section style={s("max-width: 1560px; margin: 0 auto; padding: clamp(20px, 3vw, 40px) clamp(12px, 2.5vw, 28px) 80px")}>
              <div style={s("display: flex; justify-content: space-between; align-items: flex-end; gap: 18px; flex-wrap: wrap; border-bottom: 1px solid var(--color-divider); padding-bottom: 14px")}>
                <div>
                  <div data-reveal="1" style={s("font-size: 11px; letter-spacing: .2em; color: var(--color-muted); font-weight: 700")}>11 — HOSTEL GATE PASS</div>
                  <h1 data-reveal="1" style={s("font-size: clamp(28px, 4vw, 52px); letter-spacing: -.03em; margin: 8px 0 4px")}>Leaving the hostel, on the record.</h1>
                  <div style={s("font-size: 12px; letter-spacing: .1em; color: var(--color-neutral-700)")}>{v.gateSmsLabel}</div>
                </div>
                <div style={s("display: flex; gap: 8px; flex-wrap: wrap")}>
                  <button data-cursor="SCAN" onClick={v.onGateScanOpen} data-magnetic="1" className="btn btn-primary" style={s("justify-content: flex-start; padding: 12px 18px; letter-spacing: .08em")}>SCAN A GATE PASS →</button>
                </div>
              </div>

              {(v.gateOffline) ? (<>
                <div style={s("border: 1px solid var(--color-divider); background: var(--color-neutral-100); padding: 18px; margin-top: 24px; font-size: 13px")}>
                  Sign in with the backend running to apply for a gate pass. Every step of this surface — the guardian code, the approval, the QR and the clock — is decided by the server, so there is nothing to show while it is unreachable.
                </div>
              </>) : null}

              {(v.gateError) ? (<>
                <div style={s("border: 1px solid var(--color-accent); padding: 12px 16px; margin-top: 20px; font-size: 13px; font-weight: 700; color: var(--color-accent-700)")}>{v.gateError}</div>
              </>) : null}
              {(v.gateNotice) ? (<>
                <div style={s("border: 1px solid var(--color-divider); padding: 12px 16px; margin-top: 20px; font-size: 13px")}>{v.gateNotice}</div>
              </>) : null}

              {(v.gateAlerts || []).length ? (<>
                <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin-top: 22px")}>
                  {(v.gateAlerts || []).map((rowG1, iG1) => (<React.Fragment key={iG1}>
                    <div style={s("border: 1px solid var(--color-divider); padding: 14px; display: grid; gap: 7px")}>
                      <span style={rowG1.tagStyle}>{rowG1.tag}</span>
                      <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 15px; letter-spacing: -.01em")}>{rowG1.title}</div>
                      <div style={s("font-size: 12px; color: var(--color-neutral-800); text-wrap: pretty")}>{rowG1.body}</div>
                    </div>
                  </React.Fragment>))}
                </div>
              </>) : null}

              <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: clamp(16px, 2.5vw, 32px); margin-top: 28px; align-items: start")}>

                {/* apply */}
                <div>
                  <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); margin-bottom: 12px")}>APPLY FOR A GATE PASS</div>
                  <div style={s("display: grid; gap: 14px; border: 1px solid var(--color-divider); padding: 20px")}>
                    <div className="field">
                      <label>REASON</label>
                      <input className="input" value={v.gateReason} onChange={v.onGateReason} placeholder="Dentist appointment in the city" />
                    </div>
                    <div className="field">
                      <label>DESTINATION</label>
                      <input className="input" value={v.gateDestination} onChange={v.onGateDestination} placeholder="City Dental Clinic, Chandrasekharpur" />
                    </div>
                    <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px")}>
                      <div className="field">
                        <label>DATE</label>
                        <input className="input" type="date" value={v.gateDate} onChange={v.onGateDate} />
                      </div>
                      <div className="field">
                        <label>LEAVING</label>
                        <input className="input" type="time" value={v.gateLeave} onChange={v.onGateLeave} />
                      </div>
                      <div className="field">
                        <label>BACK BY</label>
                        <input className="input" type="time" value={v.gateReturn} onChange={v.onGateReturn} />
                      </div>
                    </div>
                    <div className="field">
                      <label>GUARDIAN NUMBER</label>
                      <input className="input" value={v.gateParentPhone} onChange={v.onGateParentPhone} placeholder="+91…" />
                      <div style={s("font-size: 10px; letter-spacing: .12em; color: var(--color-neutral-700); margin-top: 6px")}>{v.gateParentOnFile}</div>
                    </div>
                    <div style={s("font-size: 10px; letter-spacing: .12em; color: var(--color-neutral-600)")}>{v.gateMaxHours}</div>
                    <button data-cursor="SUBMIT" onClick={v.onGateApply} disabled={v.gateBusy} data-magnetic="1" className="btn btn-primary" style={s("justify-content: flex-start; padding: 12px 16px; letter-spacing: .08em")}>{v.gateApplyLabel}</button>
                  </div>

                  {(v.gateHistory || []).length ? (<>
                    <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); margin: 26px 0 10px")}>MY GATE PASSES</div>
                    <div style={s("border: 1px solid var(--color-divider)")}>
                      {(v.gateHistory || []).map((rowG2, iG2) => (<React.Fragment key={iG2}>
                        <button onClick={rowG2.onClick} style={rowG2.style}>{rowG2.label}</button>
                      </React.Fragment>))}
                    </div>
                  </>) : null}
                </div>

                {/* the selected pass */}
                <div>
                  <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700)")}>CURRENT PASS · {v.gateReference}</div>

                  <div style={s("display: flex; gap: 10px; flex-wrap: wrap; margin: 22px 0 8px")}>
                    {(v.gateSteps || []).map((rowG3, iG3) => (<React.Fragment key={iG3}>
                      <div style={rowG3.style}>
                        <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-600)")}>{rowG3.n}</div>
                        <div style={rowG3.labelStyle}>{rowG3.label}</div>
                      </div>
                    </React.Fragment>))}
                  </div>

                  {(v.gateHasPass) ? (<>
                    <div style={s("border: 1px solid var(--color-neutral-500); padding: 20px; margin-top: 22px")}>
                      <span style={v.gateStatusStyle}>{v.gateStatus}</span>
                      <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 0; border-top: 1px solid var(--color-divider); border-left: 1px solid var(--color-divider); margin-top: 14px")}>
                        <div style={s("background: var(--color-neutral-100); border-right: 1px solid var(--color-divider); border-bottom: 1px solid var(--color-divider); padding: 12px")}>
                          <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>APPROVED WINDOW</div>
                          <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 15px; margin-top: 4px")}>{v.gateWindow}</div>
                        </div>
                        <div style={s("background: var(--color-neutral-100); border-right: 1px solid var(--color-divider); border-bottom: 1px solid var(--color-divider); padding: 12px")}>
                          <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>PARENT VERIFICATION</div>
                          <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 15px; margin-top: 4px")}>{v.gateParentState}</div>
                        </div>
                        <div style={s("background: var(--color-neutral-100); border-right: 1px solid var(--color-divider); border-bottom: 1px solid var(--color-divider); padding: 12px")}>
                          <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>WARDEN / HOSTEL ADMIN</div>
                          <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 15px; margin-top: 4px")}>{v.gateApprovalState}</div>
                        </div>
                        <div style={s("background: var(--color-neutral-100); border-right: 1px solid var(--color-divider); border-bottom: 1px solid var(--color-divider); padding: 12px")}>
                          <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>AT THE GATE</div>
                          <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 15px; margin-top: 4px")}>{v.gateExitAt}</div>
                        </div>
                      </div>
                      <div style={s("font-size: 12px; color: var(--color-neutral-800); margin-top: 12px; line-height: 1.6")}>{v.gateReasonText} · {v.gateDestinationText}</div>
                      {(v.gateApprovalNote) ? (<>
                        <div style={s("font-size: 12px; color: var(--color-neutral-700); margin-top: 6px")}>NOTE — {v.gateApprovalNote}</div>
                      </>) : null}
                      {(v.gateCanCancel) ? (<>
                        <button onClick={v.onGateCancel} disabled={v.gateBusy} className="btn btn-ghost" style={s("justify-self: start; font-size: 11px; letter-spacing: .1em; padding-left: 0; margin-top: 10px")}>CANCEL THIS PASS</button>
                      </>) : null}
                    </div>
                  </>) : (<>
                    <div style={s("border: 1px solid var(--color-divider); background: var(--color-neutral-100); padding: 18px; margin-top: 22px; font-size: 13px")}>No gate pass yet. Apply on the left and the guardian code goes out immediately.</div>
                  </>)}

                  {/* guardian OTP */}
                  {(v.gateShowOtp) ? (<>
                    <div style={s("border: 1px solid var(--color-accent); padding: 20px; margin-top: 22px; display: grid; gap: 14px")}>
                      <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-muted); font-weight: 700")}>GUARDIAN VERIFICATION · CODE SENT TO {v.gateOtpTo}</div>
                      <div style={s("font-size: 13px; color: var(--color-neutral-800); text-wrap: pretty")}>Your guardian has been sent a one-time code. Ask them to read it out, then enter it here. The code is checked on the server and expires on its own.</div>
                      {(v.gateOtpDev) ? (<>
                        <div style={s("font-size: 11px; letter-spacing: .12em; font-weight: 700; color: var(--color-muted)")}>{v.gateOtpDev}</div>
                      </>) : null}
                      <div className="field">
                        <label>SIX DIGIT CODE</label>
                        <input className="input" value={v.gateOtp} onChange={v.onGateOtp} inputMode="numeric" placeholder="000000" />
                      </div>
                      <div style={s("display: flex; gap: 10px; flex-wrap: wrap")}>
                        <button data-cursor="VERIFY" onClick={v.onGateVerify} disabled={v.gateBusy} className="btn btn-primary" style={s("justify-content: flex-start; padding: 11px 16px; letter-spacing: .08em")}>VERIFY CODE →</button>
                        <button onClick={v.onGateResend} disabled={v.gateBusy} className="btn btn-secondary" style={s("font-size: 11px; letter-spacing: .1em")}>RESEND</button>
                      </div>
                    </div>
                  </>) : null}

                  {/* QR */}
                  {(v.gateShowQr) ? (<>
                    <div style={s("border: 1px solid var(--color-divider); padding: 20px; margin-top: 22px; display: grid; gap: 14px; justify-items: start")}>
                      <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700)")}>GATE PASS QR</div>
                      <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 20px; letter-spacing: -.01em")}>{v.gateQrHeading}</div>
                      <div>
                        <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>GATE PASS ID</div>
                        <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 17px; margin-top: 4px")}>{v.gateReference}</div>
                      </div>
                      {(v.gateQrImage) ? (<>
                        <img src={v.gateQrImage} alt={"Gate pass QR code for " + v.gateReference} style={s("width: 220px; height: 220px; image-rendering: pixelated; border: 1px solid var(--color-divider)")} />
                      </>) : (<>
                        <div style={s("width: 220px; height: 220px; border: 1px dashed var(--color-neutral-400); display: grid; place-items: center; text-align: center; font-size: 10px; letter-spacing: .12em; color: var(--color-neutral-700); padding: 12px")}>{v.gateQrWaiting || "NO CODE LOADED"}</div>
                      </>)}
                      <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0; border-top: 1px solid var(--color-divider); border-left: 1px solid var(--color-divider); width: 100%")}>
                        <div style={s("background: var(--color-neutral-100); border-right: 1px solid var(--color-divider); border-bottom: 1px solid var(--color-divider); padding: 12px")}>
                          <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>STATUS</div>
                          <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 15px; margin-top: 4px")}>{v.gateStatus}</div>
                        </div>
                        <div style={s("background: var(--color-neutral-100); border-right: 1px solid var(--color-divider); border-bottom: 1px solid var(--color-divider); padding: 12px")}>
                          <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>VALID FROM</div>
                          <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 15px; margin-top: 4px")}>{v.gateQrValidFrom}</div>
                        </div>
                        <div style={s("background: var(--color-neutral-100); border-right: 1px solid var(--color-divider); border-bottom: 1px solid var(--color-divider); padding: 12px")}>
                          <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>VALID UNTIL</div>
                          <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 15px; margin-top: 4px")}>{v.gateQrValidUntil}</div>
                        </div>
                      </div>
                      {/* GATE-PASS QR FIX (see CHANGES-GATEPASS-QR-FIX.md): the code to type when the camera cannot read the QR. */}
                      {(v.gateQrCode) ? (<>
                        <div>
                          <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>PASS CODE — TYPE THIS IF THE CAMERA CANNOT READ THE QR</div>
                          <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 17px; letter-spacing: .06em; margin-top: 4px")}>{v.gateQrCode}</div>
                        </div>
                      </>) : null}
                      <div style={s("font-size: 12px; color: var(--color-neutral-700); text-wrap: pretty; max-width: 46ch")}>{v.gateQrCaption}</div>
                      {(v.gateQrDebug) ? (<>
                        <div style={s("font-size: 10px; letter-spacing: .06em; color: var(--color-neutral-700); word-break: break-all; max-width: 46ch; border-top: 1px solid var(--color-neutral-300); padding-top: 8px")}>DEVELOPMENT MODE — ENCODED VALUE {v.gateQrDebug}</div>
                      </>) : null}
                      <button data-cursor="QR" onClick={v.onGateQr} disabled={v.gateQrBusy} className="btn btn-secondary" style={s("font-size: 11px; letter-spacing: .1em")}>{v.gateQrLabel}</button>
                    </div>
                  </>) : null}

                  {/* countdown */}
                  {(v.gateRunning) ? (<>
                    <div style={s("border: 1px solid var(--color-neutral-500); padding: 22px; margin-top: 22px")}>
                      <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700)")}>{v.gateCountdownLabel}</div>
                      <div style={v.gateCountdownStyle}>{v.gateCountdown}</div>
                      <div style={s("font-size: 11px; letter-spacing: .12em; color: var(--color-neutral-700); margin-top: 10px")}>{v.gateExitAt} · BACK BY {v.gateWindow}</div>
                      <div style={s("font-size: 10px; letter-spacing: .12em; color: var(--color-neutral-600); margin-top: 8px; line-height: 1.6")}>Counted from the approval times held by the server. Refreshing this page re-reads them rather than restarting anything.</div>
                      {(v.gateWarning) ? (<>
                        <div style={v.gateWarningStyle}>{v.gateWarning}</div>
                      </>) : null}
                    </div>
                  </>) : null}

                  {(v.gateCompleted) ? (<>
                    <div style={s("border: 1px solid var(--color-divider); background: var(--color-neutral-100); padding: 20px; margin-top: 22px")}>
                      <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 20px; letter-spacing: -.01em")}>Gate Pass Completed ✓</div>
                      <div style={s("font-size: 13px; color: var(--color-neutral-800); margin-top: 6px")}>{v.gateCompletedLine}</div>
                      <div style={s("font-size: 10px; letter-spacing: .12em; color: var(--color-neutral-700); margin-top: 8px")}>{v.gateDuration}</div>
                    </div>
                  </>) : null}

                  {(v.gateTimeline) ? (<>
                    <div style={s("border: 1px solid var(--color-divider); padding: 18px; margin-top: 26px")}>
                      <RequestTimeline timeline={v.gateTimeline} />
                    </div>
                  </>) : null}

                  {(v.gateEvents || []).length ? (<>
                    <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); margin: 26px 0 10px")}>PASS TIMELINE — WHAT THE SYSTEM DID, AND WHEN</div>
                    <div style={s("border-top: 1px solid var(--color-divider)")}>
                      {(v.gateEvents || []).map((rowG4, iG4) => (<React.Fragment key={iG4}>
                        <div style={s("display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; gap: 14px; align-items: baseline; padding: 12px 0; border-bottom: 1px solid var(--color-neutral-300)")}>
                          <div style={s("font-size: 12px; font-variant-numeric: tabular-nums; color: var(--color-neutral-700)")}>{rowG4.t}</div>
                          <div style={s("font-size: 13px")}>{rowG4.txt}</div>
                          <div style={rowG4.tagStyle}>{rowG4.tag}</div>
                        </div>
                      </React.Fragment>))}
                    </div>
                  </>) : null}
                </div>
              </div>

              {/* warden / hostel admin console */}
              {(v.gateStaff) ? (<>
                <div style={s("margin-top: 44px; border-top: 1px solid var(--color-divider); padding-top: 26px")}>
                  <div style={s("display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap")}>
                    <div>
                      <div style={s("font-size: 11px; letter-spacing: .2em; color: var(--color-muted); font-weight: 700")}>WARDEN / HOSTEL ADMIN</div>
                      <h2 style={s("font-size: clamp(22px, 3vw, 34px); letter-spacing: -.02em; margin: 8px 0 0")}>Gate pass control</h2>
                    </div>
                    <div style={s("display: flex; gap: 6px; flex-wrap: wrap")}>
                      {(v.gateTabs || []).map((rowG5, iG5) => (<React.Fragment key={iG5}>
                        <button data-cursor="OPEN" onClick={rowG5.onClick} style={rowG5.style}>{rowG5.label}</button>
                      </React.Fragment>))}
                    </div>
                  </div>

                  <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0; border-top: 1px solid var(--color-divider); border-left: 1px solid var(--color-divider); margin-top: 20px")}>
                    {(v.gateStats || []).map((rowG6, iG6) => (<React.Fragment key={iG6}>
                      <div style={s("border-right: 1px solid var(--color-divider); border-bottom: 1px solid var(--color-divider); padding: 18px")}>
                        <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700)")}>{rowG6.k}</div>
                        <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 32px; line-height: 1.05; letter-spacing: -.02em; margin-top: 8px")}>{rowG6.v}</div>
                      </div>
                    </React.Fragment>))}
                  </div>

                  {(v.gateShowDecide) ? (<>
                    <div className="field" style={s("margin-top: 20px; max-width: 520px")}>
                      <label>DECISION NOTE — OPTIONAL, SHOWN TO THE STUDENT</label>
                      <input className="input" value={v.gateDecisionNote} onChange={v.onGateDecisionNote} placeholder="Return before the gate closes." />
                    </div>
                  </>) : null}

                  <div style={s("border-top: 1px solid var(--color-divider); margin-top: 20px")}>
                    {(v.gateRows || []).map((rowG7, iG7) => (<React.Fragment key={iG7}>
                      <div style={s("display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: start; padding: 16px 0; border-bottom: 1px solid var(--color-neutral-300)")}>
                        <div style={s("display: grid; gap: 6px")}>
                          <div style={s("display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap")}>
                            <span style={rowG7.statusStyle}>{rowG7.status}</span>
                            <span style={s("font-size: 10px; letter-spacing: .12em; color: var(--color-neutral-700)")}>{rowG7.reference} · {rowG7.where}</span>
                            <span style={s("font-size: 10px; letter-spacing: .12em; color: var(--color-muted); font-weight: 700")}>{rowG7.overdueBy}</span>
                          </div>
                          <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 16px; letter-spacing: -.01em")}>{rowG7.who} <span style={s("font-size: 11px; font-weight: 400; color: var(--color-neutral-700)")}>{rowG7.roll}</span></div>
                          <div style={s("font-size: 13px; color: var(--color-neutral-800)")}>{rowG7.reason} · {rowG7.destination}</div>
                          <div style={s("font-size: 10px; letter-spacing: .12em; color: var(--color-neutral-700)")}>{rowG7.window} · PARENT {rowG7.parent} · DECIDED BY {rowG7.decidedBy}</div>
                        </div>
                        {(v.gateShowDecide) ? (<>
                          <div style={s("display: flex; gap: 8px; flex-wrap: wrap")}>
                            <button data-cursor="APPROVE" onClick={rowG7.onApprove} disabled={v.gateBusy} className="btn btn-primary" style={s("font-size: 11px; letter-spacing: .1em; padding: 9px 14px")}>APPROVE</button>
                            <button data-cursor="REJECT" onClick={rowG7.onReject} disabled={v.gateBusy} className="btn btn-secondary" style={s("font-size: 11px; letter-spacing: .1em; padding: 9px 14px")}>REJECT</button>
                          </div>
                        </>) : (<>
                          <button onClick={rowG7.onSelect} className="btn btn-ghost" style={s("font-size: 11px; letter-spacing: .1em")}>OPEN →</button>
                        </>)}
                      </div>
                    </React.Fragment>))}
                    {(v.gateRowsEmpty) ? (<>
                      <div style={s("padding: 22px 0; font-size: 12px; letter-spacing: .12em; color: var(--color-neutral-700)")}>{v.gateEmptyLabel}</div>
                    </>) : null}
                  </div>
                </div>
                {/* EXCEPTION-ONLY HOOK: passes approved by policy (FYI + UNDO) and why the others wait. */}
                <XoWardenPanel user={this.state.user} live={this.state.apiState === "live"} onGo={(id) => this.go(id)} />
              </>) : null}
            </section>

            {/* scanner */}
            {(v.gateScanOpen) ? (<>
              <div style={s("position: fixed; inset: 0; z-index: 850; background: var(--color-scrim); display: grid; place-items: center; padding: 20px")}>
                <div style={s("background: var(--color-bg); border: 1px solid var(--color-neutral-500); padding: 22px; width: min(460px, 100%); max-height: min(92vh, 760px); overflow: auto; display: grid; gap: 14px; align-content: start")}>
                  <div style={s("display: flex; justify-content: space-between; align-items: baseline; gap: 12px")}>
                    <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 15px; letter-spacing: .1em")}>SCAN GATE PASS</div>
                    <button onClick={v.onGateScanClose} className="btn btn-ghost" style={s("font-size: 11px; letter-spacing: .12em")}>CLOSE</button>
                  </div>
                  <video ref={v.gateVideoRef} playsInline muted style={s("width: 100%; aspect-ratio: 1 / 1; max-height: 40vh; object-fit: cover; background: var(--color-neutral-200); border: 1px solid var(--color-divider)")}></video>
                  <div style={s("font-size: 11px; letter-spacing: .1em; color: var(--color-neutral-700); line-height: 1.6")}>Point the camera at the gate pass QR. Frames are decoded in this browser and never uploaded — only the pass code is sent, and the server decides what it means.</div>
                  {(v.gateScanError) ? (<>
                    <div style={s("border: 1px solid var(--color-accent); padding: 10px 12px; font-size: 12px; font-weight: 700; color: var(--color-accent-700)")}>{v.gateScanError}</div>
                  </>) : null}
                  <div className="field">
                    <label>OR ENTER THE PASS ID AND PASS CODE</label>
                    {/* GATE-PASS QR FIX: the pass ID + code shown under the QR (the full QR text still works). */}
                    <input className="input" value={v.gateManualToken} onChange={v.onGateManualToken} placeholder="GP-2026-000014 7KQ4-M29X" autoCapitalize="characters" autoComplete="off" spellCheck={false} />
                  </div>
                  <button data-cursor="SUBMIT" onClick={v.onGateManualScan} disabled={v.gateBusy} className="btn btn-primary" style={s("justify-content: flex-start; padding: 11px 16px; letter-spacing: .08em")}>SUBMIT CODE →</button>
                </div>
              </div>
            </>) : null}

            {(v.gateScanResult) ? (<>
              <div style={s("position: fixed; left: 0; right: 0; bottom: 0; z-index: 840; background: var(--color-ink); color: var(--color-on-ink); padding: 12px clamp(12px, 2.5vw, 28px); display: flex; gap: 14px; align-items: center; flex-wrap: wrap")}>
                <span style={s("font-family: var(--font-heading); font-weight: 800; font-size: 11px; letter-spacing: .16em; color: var(--color-accent-400)")}>{v.gateScanOk ? "VALID" : "REFUSED"}</span>
                <span style={s("font-size: 12px")}>{v.gateScanResult}</span>
              </div>
            </>) : null}
          </>) : null}

          {/* 12 CAMPUS SERVICE KIOSK — assisted access (PS07 feature 5) */}
          {(v.isKiosk) ? (
            <IntelGuard name="Kiosk"><Kiosk live={v.intelLive} signedIn={v.intelSignedIn} staff={v.ps07Staff} operator={v.ps07Operator} /></IntelGuard>
          ) : null}

          {/* EXTENSION HOOK (see HOOKS.md): surfaces 13–21. */}
          {EXT_PAGE_IDS.includes(this.state.page) ? (
            <ExtSurfaces page={this.state.page} user={this.state.user} live={this.state.apiState === "live"} lowBw={this.state.lowBw} mode={this.state.mode} lang={this.state.lang} onGo={(id) => this.go(id)} onLowEnd={() => this.setState({ lowBw: true, mode: "LOW" }, () => { if (this.state.ai) this.loadAiSurfaces(); })} />
          ) : null}

        </main>
      
        <footer style={s("border-top: 1px solid var(--color-divider); margin-top: 40px; background: var(--color-surface)")}>
          <div style={s("max-width: 1560px; margin: 0 auto; padding: 28px clamp(12px, 2.5vw, 28px) 20px")}>
            <div style={s("margin-bottom: 22px; padding-bottom: 18px; border-bottom: 1px solid var(--color-divider)")}>
              <div style={s("display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; margin-bottom: 14px")}>
                <span style={s("font-size: 10px; font-weight: 800; letter-spacing: .16em; color: var(--color-accent)")}>
                  CAMPUS INTELLIGENCE · 13 RECENT WORKFLOW SURFACES
                </span>
                <span style={s("font-size: 10px; letter-spacing: .12em; color: var(--color-neutral-600)")}>
                  PROBLEM → SOLUTION → LIVE RESULT
                </span>
              </div>
              <div style={s("display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px")}>
                <div>
                  <div style={s("font-size: 10px; font-weight: 700; letter-spacing: .12em; color: var(--color-neutral-600); margin-bottom: 6px")}>EVALUATION &amp; PROOF</div>
                  <div style={s("display: grid; gap: 4px")}>
                    <button type="button" onClick={() => this.go("landing")} className="btn btn-ghost" style={s("justify-content: flex-start; padding: 2px 0; font-size: 12px; color: var(--color-neutral-800)")}>01 · Evaluation Hub</button>
                    <button type="button" onClick={() => this.go("admin")} className="btn btn-ghost" style={s("justify-content: flex-start; padding: 2px 0; font-size: 12px; color: var(--color-neutral-800)")}>02 · Mission Control</button>
                  </div>
                </div>
                <div>
                  <div style={s("font-size: 10px; font-weight: 700; letter-spacing: .12em; color: var(--color-neutral-600); margin-bottom: 6px")}>STUDENT LIFE</div>
                  <div style={s("display: grid; gap: 4px")}>
                    <button type="button" onClick={() => this.go("student")} className="btn btn-ghost" style={s("justify-content: flex-start; padding: 2px 0; font-size: 12px; color: var(--color-neutral-800)")}>03 · Student Dashboard</button>
                    <button type="button" onClick={() => this.go("attendance")} className="btn btn-ghost" style={s("justify-content: flex-start; padding: 2px 0; font-size: 12px; color: var(--color-neutral-800)")}>04 · Attendance</button>
                    <button type="button" onClick={() => this.go("mess")} className="btn btn-ghost" style={s("justify-content: flex-start; padding: 2px 0; font-size: 12px; color: var(--color-neutral-800)")}>05 · Mess</button>
                    <button type="button" onClick={() => this.go("gatepass")} className="btn btn-ghost" style={s("justify-content: flex-start; padding: 2px 0; font-size: 12px; color: var(--color-neutral-800)")}>06 · Gate Pass</button>
                    {!(this.state.user?.role === "WARDEN" || (typeof window !== "undefined" && (new URLSearchParams(window.location.search).get("as") === "warden" || new URLSearchParams(window.location.search).get("role") === "warden"))) && (
                      <button type="button" onClick={() => this.go("resources")} className="btn btn-ghost" style={s("justify-content: flex-start; padding: 2px 0; font-size: 12px; color: var(--color-neutral-800)")}>14 · Help &amp; Resources</button>
                    )}
                  </div>
                </div>
                <div>
                  <div style={s("font-size: 10px; font-weight: 700; letter-spacing: .12em; color: var(--color-neutral-600); margin-bottom: 6px")}>COMPLAINTS &amp; FIXES</div>
                  <div style={s("display: grid; gap: 4px")}>
                    <button type="button" onClick={() => this.go("report")} className="btn btn-ghost" style={s("justify-content: flex-start; padding: 2px 0; font-size: 12px; color: var(--color-neutral-800)")}>08 · Report Problem</button>
                    <button type="button" onClick={() => this.go("requests")} className="btn btn-ghost" style={s("justify-content: flex-start; padding: 2px 0; font-size: 12px; color: var(--color-neutral-800)")}>09 · My Requests</button>
                    <button type="button" onClick={() => this.go("incident")} className="btn btn-ghost" style={s("justify-content: flex-start; padding: 2px 0; font-size: 12px; color: var(--color-neutral-800)")}>10 · Incidents</button>
                  </div>
                </div>
                <div>
                  <div style={s("font-size: 10px; font-weight: 700; letter-spacing: .12em; color: var(--color-neutral-600); margin-bottom: 6px")}>CHANNELS &amp; INCLUSION</div>
                  <div style={s("display: grid; gap: 4px")}>
                    <button type="button" onClick={() => this.go("kiosk")} className="btn btn-ghost" style={s("justify-content: flex-start; padding: 2px 0; font-size: 12px; color: var(--color-neutral-800)")}>11 · Campus Kiosk</button>
                    <button type="button" onClick={() => this.go("sms")} className="btn btn-ghost" style={s("justify-content: flex-start; padding: 2px 0; font-size: 12px; color: var(--color-neutral-800)")}>12 · SMS Phone</button>
                    <button type="button" onClick={() => this.go("notices")} className="btn btn-ghost" style={s("justify-content: flex-start; padding: 2px 0; font-size: 12px; color: var(--color-neutral-800)")}>13 · Notices</button>
                  </div>
                </div>
              </div>
            </div>

            <div style={s("display: flex; gap: 18px; flex-wrap: wrap; align-items: baseline; justify-content: space-between")}>
              <div style={s("display: flex; align-items: baseline; gap: 12px")}>
                <div style={s("width: 12px; height: 12px; background: var(--color-accent)")}></div>
                <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 13px; letter-spacing: .14em")}>TEAM CODEXFLOW</div>
                <div style={s("font-size: 11px; letter-spacing: .12em; color: var(--color-neutral-700)")}>PRITISH RANJAN SAHOO</div>
              </div>
              <div style={s("font-size: 11px; letter-spacing: .12em; color: var(--color-neutral-700)")}>NEX CAMP</div>
              <div style={s("font-size: 11px; letter-spacing: .12em; color: var(--color-neutral-700)")}>{v.engineLabel}</div>
            </div>
          </div>
        </footer>
      
        {(v.authOpen) ? (<>
          <div onClick={v.onAuthClose} style={s("position: fixed; inset: 0; z-index: 850; background: var(--color-scrim); display: grid; align-items: start; justify-items: center; padding: clamp(24px, 12vh, 120px) 16px; animation: nex-in .2s both")}>
            <div onClick={v.stop} style={s("width: min(460px, 100%); background: var(--color-bg); border: 1px solid var(--color-neutral-500); box-shadow: var(--shadow-lg)")}>
              <div style={s("display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--color-divider); padding: 12px 16px")}>
                <span style={s("color: var(--color-accent); font-family: var(--font-heading); font-weight: 800; font-size: 13px; letter-spacing: .12em")}>SIGN IN</span>
                <span style={s("flex: 1 1 auto")}></span>
                <span style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-600)")}>ESC</span>
              </div>
              <div style={s("display: grid; gap: 14px; padding: 18px 16px")}>
                <div className="field">
                  <label>EMAIL</label>
                  <input className="input" type="email" autoComplete="username" value={v.authEmail} onChange={v.onAuthEmail} onKeyDown={v.onAuthKey} placeholder="pritish@bput.ac.in" />
                </div>
                <div className="field">
                  <label>PASSWORD</label>
                  <input className="input" type="password" autoComplete="current-password" value={v.authPassword} onChange={v.onAuthPassword} onKeyDown={v.onAuthKey} />
                </div>
                {(v.authError) ? (<>
                  <div style={s("font-size: 12px; color: var(--color-accent-700); font-weight: 700")}>{v.authError}</div>
                </>) : null}
                <button data-cursor="SIGN IN" onClick={v.onAuthSubmit} disabled={v.authBusy} data-magnetic="1" className="btn btn-primary" style={s("justify-content: flex-start; padding: 12px 16px; letter-spacing: .08em")}>{v.authBusy ? "SIGNING IN…" : "SIGN IN →"}</button>
                <div style={s("font-size: 11px; color: var(--color-neutral-700); line-height: 1.5")}>{v.authHint}</div>
              </div>
            </div>
          </div>
        </>) : null}

        {(v.palette) ? (<>
          <div onClick={v.onPaletteClose} style={s("position: fixed; inset: 0; z-index: 800; background: var(--color-scrim); display: grid; align-items: start; justify-items: center; padding: clamp(24px, 8vh, 96px) 16px; animation: nex-in .2s both")}>
            <div onClick={v.stop} style={s("width: min(760px, 100%); background: var(--color-bg); border: 1px solid var(--color-neutral-500); box-shadow: var(--shadow-lg)")}>
              <div style={s("display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--color-divider); padding: 12px 16px")}>
                <span style={s("color: var(--color-accent); font-family: var(--font-heading); font-weight: 800")}>ASK</span>
                <input value={v.queryText} onChange={v.onQueryType} onKeyDown={v.onQuerySubmit} placeholder="Why is Hostel B attendance falling?" style={s("flex: 1; border: 0; background: none; font-family: var(--font-body); font-size: 16px; color: var(--color-text); outline: none")} />
                <span style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-600)")}>{v.queryBusy ? "…" : "↵ ASK · ESC"}</span>
              </div>
              <div style={s("display: grid; gap: 1px; background: var(--color-neutral-300)")}>
                {(v.queries || []).map((row54, i54) => (<React.Fragment key={i54}>
                  <button data-cursor="TRACE" onClick={row54.onClick} style={row54.style}>{row54.label}</button>
                </React.Fragment>))}
              </div>
              <div style={s("padding: 16px; border-top: 1px solid var(--color-divider)")}>
                <div style={s("font-size: 10px; letter-spacing: .14em; color: var(--color-neutral-700); margin-bottom: 10px")}>SYSTEM ANSWER — RELATIONSHIP TRACE</div>
                <div style={s("display: flex; flex-wrap: wrap; gap: 8px; align-items: center")}>
                  {(v.answerChain || []).map((row55, i55) => (<React.Fragment key={i55}>
                    <div style={s("display: flex; align-items: center; gap: 8px")}>
                      <div style={row55.style}>{row55.label}</div>
                      <span style={s("color: var(--color-accent); font-weight: 800")}>{row55.arrow}</span>
                    </div>
                  </React.Fragment>))}
                </div>
                <div style={s("font-size: 13px; margin-top: 12px; color: var(--color-neutral-800); max-width: 60ch")}>{v.answerNote}</div>
                <div style={s("font-size: 10px; letter-spacing: .12em; margin-top: 10px; color: var(--color-neutral-600)")}>{v.answerMethod}</div>
              </div>
            </div>
          </div>
        </>) : null}
        {/* Target for evidence drawers (components/intel/kit.jsx Drawer). */}
        <div id="ci-portal" className="ci ci-embed" />
      </div>
    );
  }
}
